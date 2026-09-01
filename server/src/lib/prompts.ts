import type { Difficulty } from '../types.js';

export interface TranscribeResult {
  text: string;
  /**
   * Word-level timings relative to the START of this clip, in ms. Only set
   * when the provider actually returned per-word timestamps.
   */
  words?: Array<{ word: string; startMs: number; endMs: number }>;
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
