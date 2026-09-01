import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { languageCode } from './lib/languages.js';

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
  transcribeProvider: process.env.TRANSCRIBE_PROVIDER ?? 'auto',
  quizProvider: process.env.QUIZ_PROVIDER ?? 'auto',
  whisperModelPath: process.env.WHISPER_MODEL_PATH ?? path.join(serverRoot, 'models/ggml-large-v3-turbo.bin'),
  whisperServerBin: process.env.WHISPER_SERVER_BIN ?? '/opt/homebrew/bin/whisper-server',
  whisperCliBin: process.env.WHISPER_CLI_BIN ?? 'whisper-cli',
  whisperServerUrl: process.env.WHISPER_SERVER_URL ?? 'http://127.0.0.1:8788',
  /**
   * When WHISPER_SERVER_URL is set explicitly, the server is externally
   * managed (e.g. running natively on the Docker host for Metal speed):
   * don't spawn a binary, don't require a local model file — just use it.
   */
  whisperServerExternal: (process.env.WHISPER_SERVER_URL ?? '').length > 0,
  whisperServerHost: process.env.WHISPER_SERVER_HOST ?? '127.0.0.1',
  whisperServerPort: num(process.env.WHISPER_SERVER_PORT, 8788),
  /**
   * whisper.cpp DTW alignment preset (must match the model). Without it the
   * per-word times are linear interpolation across each segment — useless for
   * karaoke. Set WHISPER_DTW_PRESET="" to disable. Note: DTW forces
   * flash-attention off, costing ~2x inference time (still ~1.5s per 15s clip).
   */
  whisperDtwPreset: process.env.WHISPER_DTW_PRESET ?? 'large.v3.turbo',
  ollamaUrl: process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434',
  ollamaModel: process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct',
  dbPath: path.isAbsolute(dbPath) ? dbPath : path.join(serverRoot, dbPath),
  tmpDir: path.join(serverRoot, 'tmp'),
  captureSeconds: num(process.env.CAPTURE_SECONDS, 60),
  captionChunkSeconds: num(process.env.CAPTION_CHUNK_SECONDS, 15),
  /** Hard ceiling on a capture so a fast stream can't fill the disk. */
  captureMaxBytes: num(process.env.CAPTURE_MAX_BYTES, 6 * 1024 * 1024),
  stationsCacheTtlMs: 6 * 60 * 60 * 1000,
  userAgent: 'language-globe/0.1 (https://github.com/luke-mcevoy/language-globe)',
} as const;

export function targetLanguageCode(language = config.targetLanguage): string | undefined {
  return languageCode(language);
}
