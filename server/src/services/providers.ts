import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config, targetLanguageCode } from '../config.js';
import { parseGeneratedQuestions } from '../lib/grading.js';
import { cleanTranscript } from '../lib/text.js';
import {
  mergeWhisperCliTokensToWords,
  normalizeFlatWords,
  type WhisperCliSegment,
  type WordTiming,
} from '../lib/whisperWords.js';
import type { Difficulty, QuizQuestion } from '../types.js';
import {
  buildQuizPrompt,
  buildTranslationPrompt,
  parseWordTranslation,
  QUESTION_SCHEMA,
  TRANSLATION_SCHEMA,
  type TranscribeResult,
  type WordTranslation,
} from '../lib/prompts.js';

export type { TranscribeResult } from '../lib/prompts.js';

export type TranscribeProvider = 'local-whisper' | 'unavailable';
export type QuizProvider = 'ollama' | 'unavailable';

type TranscribeMode = 'auto' | 'local';
type QuizMode = 'auto' | 'ollama';

export interface ProviderProbeState {
  localWhisperAvailable: boolean;
  ollamaAvailable: boolean;
}

interface ProviderState {
  transcribeProvider: TranscribeProvider;
  quizProvider: QuizProvider;
  localWhisperAvailable: boolean;
  whisperServerAvailable: boolean;
  ollamaAvailable: boolean;
}

const TRANSCRIBE_MODES = new Set(['auto', 'local']);
const QUIZ_MODES = new Set(['auto', 'ollama']);

let providerState: ProviderState = {
  transcribeProvider: 'unavailable',
  quizProvider: 'unavailable',
  localWhisperAvailable: false,
  whisperServerAvailable: false,
  ollamaAvailable: false,
};

let whisperServer: ChildProcess | null = null;
let whisperServerReady: Promise<void> | null = null;

function transcribeMode(value: string): TranscribeMode {
  return TRANSCRIBE_MODES.has(value) ? (value as TranscribeMode) : 'auto';
}

function quizMode(value: string): QuizMode {
  return QUIZ_MODES.has(value) ? (value as QuizMode) : 'auto';
}

export function resolveTranscribeProvider(mode: string, probes: ProviderProbeState): TranscribeProvider {
  transcribeMode(mode); // unknown values collapse to auto
  return probes.localWhisperAvailable ? 'local-whisper' : 'unavailable';
}

export function resolveQuizProvider(mode: string, probes: ProviderProbeState): QuizProvider {
  quizMode(mode); // unknown values collapse to auto
  return probes.ollamaAvailable ? 'ollama' : 'unavailable';
}

async function commandExists(command: string): Promise<boolean> {
  if (path.isAbsolute(command) || command.includes('/')) return fs.existsSync(command);
  return new Promise<boolean>((resolve) => {
    const child = spawn('which', [command], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

async function probeOllama(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(new URL('/api/tags', config.ollamaUrl), { signal: controller.signal });
    if (!response.ok) return false;
    const payload = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
    return (
      Array.isArray(payload.models) &&
      payload.models.some((model) => model.name === config.ollamaModel || model.model === config.ollamaModel)
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function initializeProviders(): Promise<ProviderState> {
  const whisperModelAvailable = fs.existsSync(config.whisperModelPath);
  const whisperServerAvailable = whisperModelAvailable && fs.existsSync(config.whisperServerBin);
  const whisperCliAvailable = whisperModelAvailable && (await commandExists(config.whisperCliBin));
  const probes: ProviderProbeState = {
    localWhisperAvailable: whisperServerAvailable || whisperCliAvailable,
    ollamaAvailable: await probeOllama(),
  };

  providerState = {
    ...probes,
    whisperServerAvailable,
    transcribeProvider: resolveTranscribeProvider(config.transcribeProvider, probes),
    quizProvider: resolveQuizProvider(config.quizProvider, probes),
  };
  return providerState;
}

export function getProviderStatus(): ProviderState {
  return providerState;
}

export const quizEnabled = (): boolean => providerState.quizProvider !== 'unavailable';

export const captionsEnabled = (): boolean => providerState.transcribeProvider !== 'unavailable';

async function ensureTmpDir(): Promise<void> {
  await fsp.mkdir(config.tmpDir, { recursive: true });
}

async function convertToWhisperWav(inputPath: string): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
  await ensureTmpDir();
  const filePath = path.join(config.tmpDir, `whisper-${randomUUID()}.wav`);
  const args = [
    '-nostdin',
    '-loglevel',
    'error',
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-f',
    'wav',
    '-y',
    filePath,
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    child.on('error', (error) => {
      clearTimeout(killTimer);
      reject(new Error(`ffmpeg failed to start: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(killTimer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 400)}`));
    });
  });

  return {
    filePath,
    cleanup: () => fsp.rm(filePath, { force: true }).catch(() => undefined),
  };
}

async function waitForWhisperServer(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(config.whisperServerUrl);
      if (response.ok || response.status === 404 || response.status === 405) return;
    } catch {
      // Server is still loading the model.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('whisper-server did not become ready before timeout');
}

async function ensureWhisperServer(): Promise<void> {
  if (!providerState.whisperServerAvailable) throw new Error('whisper-server is unavailable');
  if (whisperServer && !whisperServer.killed && whisperServer.exitCode === null) return whisperServerReady ?? Promise.resolve();

  const language = targetLanguageCode(config.targetLanguage) ?? config.targetLanguage;
  const args = ['-m', config.whisperModelPath, '-l', language, '--port', String(config.whisperServerPort), '--host', config.whisperServerHost];
  if (config.whisperDtwPreset) {
    // DTW gives real token-level timestamps (t_dtw); without it whisper.cpp
    // interpolates times evenly across each segment and karaoke can't line up.
    // whisper.cpp disables DTW silently when flash-attention is on, so turn it off.
    args.push('--dtw', config.whisperDtwPreset, '--no-flash-attn');
  }
  whisperServer = spawn(config.whisperServerBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  whisperServer.stderr?.on('data', () => undefined);
  whisperServer.on('exit', () => {
    whisperServer = null;
    whisperServerReady = null;
  });
  whisperServerReady = waitForWhisperServer();
  return whisperServerReady;
}

interface WhisperServerVerboseResponse {
  text?: unknown;
  words?: unknown;
  segments?: Array<{
    text?: unknown;
    words?: unknown;
    tokens?: WhisperCliSegment['tokens'];
    offsets?: WhisperCliSegment['offsets'];
  }>;
}

function extractWordsFromWhisperServer(payload: WhisperServerVerboseResponse): WordTiming[] | null {
  // Newer whisper.cpp server builds expose a flat `words` array.
  const top = normalizeFlatWords(payload.words);
  if (top) return top;

  // Older builds put words inside each segment.
  if (Array.isArray(payload.segments)) {
    const flat = payload.segments.flatMap((segment) => (Array.isArray(segment?.words) ? segment.words : []));
    const nested = normalizeFlatWords(flat);
    if (nested) return nested;

    // Fall back to per-segment tokens (present when verbose_json exposes them).
    const segments: WhisperCliSegment[] = payload.segments.map((segment) => ({
      text: segment?.text,
      offsets: segment?.offsets ?? null,
      tokens: Array.isArray(segment?.tokens) ? segment.tokens : null,
    }));
    const merged = mergeWhisperCliTokensToWords(segments);
    if (merged.length > 0) return merged;
  }
  return null;
}

async function transcribeWithWhisperServer(wavPath: string): Promise<TranscribeResult> {
  await ensureWhisperServer();
  const form = new FormData();
  form.append('file', new Blob([await fsp.readFile(wavPath)], { type: 'audio/wav' }), path.basename(wavPath));
  // verbose_json gives us word/token detail when the server build supports it,
  // and still contains `text` when it does not — so we never lose the caption.
  form.append('response_format', 'verbose_json');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(new URL('/inference', config.whisperServerUrl), {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`whisper-server responded ${response.status}`);
    const payload = (await response.json()) as WhisperServerVerboseResponse;
    const text = cleanTranscript(typeof payload.text === 'string' ? payload.text : '');
    const words = extractWordsFromWhisperServer(payload);
    return { text, words: words ?? undefined };
  } finally {
    clearTimeout(timeout);
  }
}

interface WhisperCliJson {
  transcription?: WhisperCliSegment[];
}

async function transcribeWithWhisperCli(wavPath: string): Promise<TranscribeResult> {
  const language = targetLanguageCode(config.targetLanguage) ?? config.targetLanguage;
  const outputBase = wavPath.replace(/\.wav$/i, `-${randomUUID()}`);
  const jsonPath = `${outputBase}.json`;
  // -ojf writes a JSON file with per-token timings; -of picks the output base
  // name (whisper-cli appends `.json`).
  const args = ['-m', config.whisperModelPath, '-l', language, '-np', '-nt', '-ojf', '-of', outputBase, '-f', wavPath];

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(config.whisperCliBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let stderr = '';
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.stdout?.on('data', (data: Buffer) => {
      out += data.toString();
    });
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    child.on('error', (error) => {
      clearTimeout(killTimer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(killTimer);
      if (code === 0) resolve(out);
      else reject(new Error(`whisper-cli exited ${code}: ${stderr.slice(0, 400)}`));
    });
  });

  let jsonRaw: string | null = null;
  try {
    jsonRaw = await fsp.readFile(jsonPath, 'utf8');
  } catch {
    // No JSON output — return the stdout text (still a valid caption).
    return { text: cleanTranscript(stdout) };
  } finally {
    await fsp.rm(jsonPath, { force: true }).catch(() => undefined);
  }

  let parsed: WhisperCliJson;
  try {
    parsed = JSON.parse(jsonRaw) as WhisperCliJson;
  } catch {
    return { text: cleanTranscript(stdout) };
  }
  const segments = Array.isArray(parsed.transcription) ? parsed.transcription : [];
  const text = segments
    .map((segment) => (typeof segment.text === 'string' ? segment.text : ''))
    .join(' ');
  const words = mergeWhisperCliTokensToWords(segments);
  return { text: cleanTranscript(text.length > 0 ? text : stdout), words: words.length > 0 ? words : undefined };
}

async function transcribeLocal(filePath: string): Promise<TranscribeResult> {
  const wav = await convertToWhisperWav(filePath);
  try {
    if (providerState.whisperServerAvailable) return await transcribeWithWhisperServer(wav.filePath);
    return await transcribeWithWhisperCli(wav.filePath);
  } finally {
    await wav.cleanup();
  }
}

export async function transcribeChunk(filePath: string): Promise<TranscribeResult> {
  if (providerState.transcribeProvider === 'local-whisper') {
    return transcribeLocal(filePath);
  }
  throw new Error('No transcription provider is available.');
}

export async function transcribeAudio(filePath: string): Promise<string> {
  return (await transcribeChunk(filePath)).text;
}

export async function generateOllamaQuestions(
  transcript: string,
  difficulty: Difficulty,
  language = config.targetLanguage,
): Promise<QuizQuestion[]> {
  const response = await fetch(new URL('/api/chat', config.ollamaUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollamaModel,
      stream: false,
      format: QUESTION_SCHEMA,
      options: { temperature: 0.4 },
      messages: [
        {
          role: 'system',
          content: 'You write precise listening-comprehension quizzes and reply only with JSON matching the schema.',
        },
        { role: 'user', content: buildQuizPrompt(transcript, difficulty, language) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Ollama responded ${response.status}`);

  const payload = (await response.json()) as { message?: { content?: unknown }; response?: unknown };
  const content =
    typeof payload.message?.content === 'string'
      ? payload.message.content
      : typeof payload.response === 'string'
        ? payload.response
        : '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Ollama did not return valid JSON');
  }
  return parseGeneratedQuestions(parsed);
}

async function generateLocalQuestions(transcript: string, difficulty: Difficulty): Promise<QuizQuestion[]> {
  let questions = await generateOllamaQuestions(transcript, difficulty);
  if (questions.length >= 2) return questions;
  questions = await generateOllamaQuestions(transcript, difficulty);
  if (questions.length >= 2) return questions;
  throw new Error('Ollama returned fewer than two usable questions');
}

export async function generateQuizQuestions(transcript: string, difficulty: Difficulty): Promise<QuizQuestion[]> {
  if (providerState.quizProvider === 'ollama') {
    return generateLocalQuestions(transcript, difficulty);
  }
  throw new Error('No quiz generation provider is available.');
}

async function translateWordOllama(word: string, context: string): Promise<WordTranslation> {
  const response = await fetch(new URL('/api/chat', config.ollamaUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollamaModel,
      stream: false,
      format: TRANSLATION_SCHEMA,
      options: { temperature: 0.2 },
      messages: [
        { role: 'system', content: 'You are a precise bilingual dictionary and reply only with JSON matching the schema.' },
        { role: 'user', content: buildTranslationPrompt(word, context, config.targetLanguage) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Ollama responded ${response.status}`);

  const payload = (await response.json()) as { message?: { content?: unknown } };
  const content = typeof payload.message?.content === 'string' ? payload.message.content : '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Ollama did not return valid JSON');
  }
  const translation = parseWordTranslation(parsed);
  if (!translation) throw new Error('Ollama returned no usable translation');
  return translation;
}

/** Word lookups ride the quiz provider: same local model. */
export async function translateWord(word: string, context: string): Promise<WordTranslation> {
  if (providerState.quizProvider === 'ollama') {
    return translateWordOllama(word, context);
  }
  throw new Error('No translation provider is available.');
}

export function shutdownProviders(): void {
  if (whisperServer && whisperServer.exitCode === null) {
    whisperServer.kill('SIGTERM');
    setTimeout(() => {
      if (whisperServer && whisperServer.exitCode === null) whisperServer.kill('SIGKILL');
    }, 2000).unref();
  }
  whisperServer = null;
  whisperServerReady = null;
}
