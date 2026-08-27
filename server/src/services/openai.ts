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
