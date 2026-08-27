import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
/** server/ — src/ in dev, dist/ after a build, so climb one level either way. */
export const serverRoot = path.resolve(here, '..');

loadEnv({ path: path.join(serverRoot, '.env'), quiet: true });

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const dbPath = process.env.DB_PATH ?? 'data/language-globe.sqlite';

export const config = {
  port: num(process.env.PORT, 8787),
  host: process.env.HOST ?? '127.0.0.1',
  targetLanguage: (process.env.TARGET_LANGUAGE ?? 'spanish').toLowerCase(),
  openaiApiKey: process.env.OPENAI_API_KEY?.trim() ?? '',
  quizModel: process.env.OPENAI_QUIZ_MODEL ?? 'gpt-4o-mini',
  transcribeModel: process.env.OPENAI_TRANSCRIBE_MODEL ?? 'whisper-1',
  dbPath: path.isAbsolute(dbPath) ? dbPath : path.join(serverRoot, dbPath),
  tmpDir: path.join(serverRoot, 'tmp'),
  captureSeconds: num(process.env.CAPTURE_SECONDS, 60),
  /** Hard ceiling on a capture so a fast stream can't fill the disk. */
  captureMaxBytes: num(process.env.CAPTURE_MAX_BYTES, 6 * 1024 * 1024),
  stationsCacheTtlMs: 6 * 60 * 60 * 1000,
  userAgent: 'language-globe/0.1 (https://github.com/luke-mcevoy/language-globe)',
} as const;

export const quizEnabled = (): boolean => config.openaiApiKey.length > 0;

/**
 * ISO-639-1 hint for the transcription model. Unknown languages simply get no
 * hint, which is a slightly worse transcript rather than an error.
 */
const LANGUAGE_CODES: Record<string, string> = {
  spanish: 'es',
  english: 'en',
  french: 'fr',
  german: 'de',
  italian: 'it',
  portuguese: 'pt',
  dutch: 'nl',
  polish: 'pl',
  russian: 'ru',
  turkish: 'tr',
  arabic: 'ar',
  japanese: 'ja',
  korean: 'ko',
  chinese: 'zh',
  mandarin: 'zh',
  hindi: 'hi',
  greek: 'el',
  swedish: 'sv',
  norwegian: 'no',
  danish: 'da',
  finnish: 'fi',
  czech: 'cs',
  romanian: 'ro',
  hungarian: 'hu',
  ukrainian: 'uk',
  vietnamese: 'vi',
  indonesian: 'id',
  thai: 'th',
  hebrew: 'he',
  catalan: 'ca',
};

export function targetLanguageCode(language = config.targetLanguage): string | undefined {
  return LANGUAGE_CODES[language.toLowerCase()];
}
