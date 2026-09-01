import fs from 'node:fs';
import OpenAI from 'openai';
import { config, targetLanguageCode } from '../config.js';
import { parseGeneratedQuestions } from '../lib/grading.js';
import { cleanTranscript } from '../lib/text.js';
import { normalizeFlatWords } from '../lib/whisperWords.js';
import type { Difficulty, QuizQuestion } from '../types.js';

export interface TranscribeResult {
  text: string;
  /**
   * Word-level timings relative to the START of this clip, in ms. Only set
   * when the provider actually returned per-word timestamps.
   */
  words?: Array<{ word: string; startMs: number; endMs: number }>;
}

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY is not set');
  client ??= new OpenAI({ apiKey: config.openaiApiKey });
  return client;
}

/**
 * Billing and auth failures are account problems the user can actually fix;
 * surfacing them as generic "try again" errors sends them down the wrong
 * path (retrying, blaming the station).
 */
export function describeOpenAiError(error: unknown): { code: string; message: string } | null {
  if (!(error instanceof OpenAI.APIError)) return null;
  if (error.status === 429 && /quota|billing/i.test(error.message)) {
    return {
      code: 'openai_quota',
      message:
        'Your OpenAI account is out of API credits. Add credits at platform.openai.com (Settings → Billing) — API usage is billed separately from ChatGPT.',
    };
  }
  if (error.status === 401) {
    return {
      code: 'openai_auth',
      message: 'OpenAI rejected the API key. Check OPENAI_API_KEY in server/.env and restart the server.',
    };
  }
  if (error.status === 429) {
    return {
      code: 'openai_rate_limit',
      message: 'OpenAI is rate-limiting requests right now. Wait a moment and try again.',
    };
  }
  return null;
}

export async function transcribe(filePath: string, language = config.targetLanguage): Promise<string> {
  return (await transcribeVerbose(filePath, language)).text;
}

export async function transcribeVerbose(
  filePath: string,
  language = config.targetLanguage,
): Promise<TranscribeResult> {
  const code = targetLanguageCode(language);
  const response = await getClient().audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: config.transcribeModel,
    response_format: 'verbose_json',
    // Word-level timings are only returned for whisper-1 with this flag.
    timestamp_granularities: ['word'],
    ...(code ? { language: code } : {}),
    // Nudges the model toward broadcast speech rather than song lyrics.
    prompt: 'Live radio broadcast. Transcribe the speech only.',
  });

  const text = typeof response === 'string' ? response : (response.text ?? '');
  const words = typeof response === 'string' ? null : normalizeFlatWords(response.words);
  return { text: cleanTranscript(text), words: words ?? undefined };
}

export const TRANSLATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['translation', 'note'],
  properties: {
    translation: { type: 'string' },
    note: { type: 'string' },
  },
} as const;

export interface WordTranslation {
  translation: string;
  note: string;
}

export function buildTranslationPrompt(word: string, context: string, language: string): string {
  const languageName = language.charAt(0).toUpperCase() + language.slice(1);
  return [
    `You are a ${languageName}-to-English dictionary for a language learner listening to live radio.`,
    `Translate the ${languageName} word below as it is used in its context.`,
    '',
    'Rules:',
    '- "translation": the English meaning of the WORD ITSELF, in 1-4 words. Never translate the surrounding phrase.',
    '- Use the context only to choose between senses of the word (e.g. "banco" = bench vs bank). If the context is noisy or unhelpful, give the word\'s most common meaning.',
    '- If the word is (part of) a proper name, still translate the word itself if it has an ordinary meaning (e.g. "Dios" → "God") and mention the name in the note.',
    '- "note": one short sentence of grammar help — part of speech, and the dictionary form (lemma/infinitive) if the word is inflected. Mention an idiom only if the context uses one.',
    '- The transcript is automatic and may be garbled; if the word looks garbled, translate the most plausible intended word and say so in the note.',
    '',
    `WORD: ${word}`,
    context ? `CONTEXT: """${context}"""` : 'CONTEXT: (none available)',
  ].join('\n');
}

export function parseWordTranslation(payload: unknown): WordTranslation | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as { translation?: unknown; note?: unknown };
  if (typeof record.translation !== 'string' || record.translation.trim().length === 0) return null;
  return {
    translation: record.translation.trim(),
    note: typeof record.note === 'string' ? record.note.trim() : '',
  };
}

export async function translateWord(word: string, context: string, language = config.targetLanguage): Promise<WordTranslation> {
  const completion = await getClient().chat.completions.create({
    model: config.quizModel,
    temperature: 0.2,
    messages: [
      { role: 'system', content: 'You are a precise bilingual dictionary and reply only with JSON matching the schema.' },
      { role: 'user', content: buildTranslationPrompt(word, context, language) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'word_translation', strict: true, schema: TRANSLATION_SCHEMA },
    },
  });

  const content = completion.choices[0]?.message?.content ?? '';
  let payload: unknown;
  try {
    payload = JSON.parse(content);
  } catch {
    throw new Error('The translation model did not return valid JSON');
  }
  const translation = parseWordTranslation(payload);
  if (!translation) throw new Error('The translation model returned no usable translation');
  return translation;
}

export const SCENE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['prompt'],
  properties: {
    prompt: { type: 'string' },
  },
} as const;

export function buildSceneDescriptionPrompt(transcript: string, language: string): string {
  const languageName = language.charAt(0).toUpperCase() + language.slice(1);
  return [
    'You write prompts for an image generator that draws an ambient illustration of a live radio broadcast.',
    `Below is a noisy automatic transcript of ${languageName} radio from the last minute or two.`,
    '',
    'Rules:',
    '- "prompt": ONE English sentence (max ~35 words) describing a single vivid scene that captures what is being discussed.',
    '- Style it as a stylized atmospheric illustration; end with: "stylized illustration, warm cinematic light, no text".',
    '- Never name or depict a real, identifiable person. Describe roles or scenes instead ("a captain founding a colonial town", not a name).',
    '- Ignore ads, station idents and garbled fragments; draw the main topic.',
    '- If the transcript is mostly unusable, describe a cozy late-night radio studio instead.',
    '',
    'TRANSCRIPT:',
    '"""',
    transcript,
    '"""',
  ].join('\n');
}

export function parseSceneDescription(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as { prompt?: unknown };
  if (typeof record.prompt !== 'string') return null;
  const prompt = record.prompt.trim();
  return prompt.length >= 10 ? prompt : null;
}

export async function describeScene(transcript: string, language = config.targetLanguage): Promise<string> {
  const completion = await getClient().chat.completions.create({
    model: config.quizModel,
    temperature: 0.6,
    messages: [
      { role: 'system', content: 'You write image-generation prompts and reply only with JSON matching the schema.' },
      { role: 'user', content: buildSceneDescriptionPrompt(transcript, language) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'scene_description', strict: true, schema: SCENE_SCHEMA },
    },
  });

  const content = completion.choices[0]?.message?.content ?? '';
  let payload: unknown;
  try {
    payload = JSON.parse(content);
  } catch {
    throw new Error('The scene model did not return valid JSON');
  }
  const prompt = parseSceneDescription(payload);
  if (!prompt) throw new Error('The scene model returned no usable prompt');
  return prompt;
}

export const QUESTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      minItems: 4,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'options', 'correctIndex', 'explanation'],
        properties: {
          question: { type: 'string' },
          options: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string' } },
          correctIndex: { type: 'integer', minimum: 0, maximum: 3 },
          explanation: { type: 'string' },
        },
      },
    },
  },
} as const;

export function buildQuizPrompt(transcript: string, difficulty: Difficulty, language: string): string {
  const languageName = language.charAt(0).toUpperCase() + language.slice(1);
  const wording =
    difficulty === 'beginner'
      ? `Write the questions, the options and the explanations in English, even though the transcript is in ${languageName}. Test whether the listener understood the gist: topic, who is speaking about what, and one or two concrete details.`
      : `Write the questions and the options in ${languageName}, at roughly B1-B2 level. Keep each explanation in ${languageName} too, in one short sentence. Test comprehension of specific details, not just the topic.`;

  return [
    `You are writing a listening-comprehension quiz for someone learning ${languageName}.`,
    `Below is an automatic transcript of about a minute of live ${languageName} radio. It may be noisy, may start and end mid-sentence, and may contain advertising or station idents.`,
    '',
    'Rules:',
    '- Write exactly 4 multiple-choice questions, each with exactly 4 options.',
    '- Every question must be answerable from the transcript alone. Never rely on outside knowledge.',
    '- Ignore garbled fragments; build questions only on parts that clearly make sense.',
    '- Wrong options must be plausible and similar in length to the correct one.',
    '- Vary which index is correct across the four questions.',
    `- ${wording}`,
    '',
    'TRANSCRIPT:',
    '"""',
    transcript,
    '"""',
  ].join('\n');
}

export async function generateQuestions(
  transcript: string,
  difficulty: Difficulty,
  language = config.targetLanguage,
): Promise<QuizQuestion[]> {
  const completion = await getClient().chat.completions.create({
    model: config.quizModel,
    temperature: 0.4,
    messages: [
      {
        role: 'system',
        content: 'You write precise listening-comprehension quizzes and reply only with JSON matching the schema.',
      },
      { role: 'user', content: buildQuizPrompt(transcript, difficulty, language) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'comprehension_quiz', strict: true, schema: QUESTION_SCHEMA },
    },
  });

  const content = completion.choices[0]?.message?.content ?? '';
  let payload: unknown;
  try {
    payload = JSON.parse(content);
  } catch {
    throw new Error('The quiz model did not return valid JSON');
  }

  const questions = parseGeneratedQuestions(payload);
  if (questions.length === 0) throw new Error('The quiz model returned no usable questions');
  return questions;
}
