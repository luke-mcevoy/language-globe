import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config, targetLanguageCode } from '../config.js';
import { parseGeneratedQuestions } from '../lib/grading.js';
import { cleanTranscript } from '../lib/text.js';
import type { Difficulty, QuizQuestion } from '../types.js';
import {
  buildQuizPrompt,
  generateQuestions as generateOpenAiQuestions,
  QUESTION_SCHEMA,
  transcribe as transcribeOpenAi,
} from './openai.js';

export type TranscribeProvider = 'local-whisper' | 'openai' | 'unavailable';
export type QuizProvider = 'ollama' | 'openai' | 'unavailable';

type TranscribeMode = 'auto' | 'local' | 'openai';
type QuizMode = 'auto' | 'ollama' | 'openai';

export interface ProviderProbeState {
  openaiAvailable: boolean;
  localWhisperAvailable: boolean;
  ollamaAvailable: boolean;
}

interface ProviderState {
  transcribeProvider: TranscribeProvider;
  quizProvider: QuizProvider;
  openaiAvailable: boolean;
  localWhisperAvailable: boolean;
  whisperServerAvailable: boolean;
  ollamaAvailable: boolean;
}

const TRANSCRIBE_MODES = new Set(['auto', 'local', 'openai']);
const QUIZ_MODES = new Set(['auto', 'ollama', 'openai']);

let providerState: ProviderState = {
  transcribeProvider: 'unavailable',
  quizProvider: 'unavailable',
  openaiAvailable: false,
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
  const selected = transcribeMode(mode);
  if (selected === 'openai') return probes.openaiAvailable ? 'openai' : 'unavailable';
  if (selected === 'local') {
    if (probes.localWhisperAvailable) return 'local-whisper';
    return probes.openaiAvailable ? 'openai' : 'unavailable';
  }
  if (probes.localWhisperAvailable) return 'local-whisper';
  return probes.openaiAvailable ? 'openai' : 'unavailable';
}

export function resolveQuizProvider(mode: string, probes: ProviderProbeState): QuizProvider {
  const selected = quizMode(mode);
  if (selected === 'openai') return probes.openaiAvailable ? 'openai' : 'unavailable';
  if (selected === 'ollama') {
    if (probes.ollamaAvailable) return 'ollama';
    return probes.openaiAvailable ? 'openai' : 'unavailable';
  }
  if (probes.ollamaAvailable) return 'ollama';
  return probes.openaiAvailable ? 'openai' : 'unavailable';
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
  const openaiAvailable = config.openaiApiKey.length > 0;
  const whisperModelAvailable = fs.existsSync(config.whisperModelPath);
  const whisperServerAvailable = whisperModelAvailable && fs.existsSync(config.whisperServerBin);
  const whisperCliAvailable = whisperModelAvailable && (await commandExists(config.whisperCliBin));
  const probes: ProviderProbeState = {
    openaiAvailable,
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
  whisperServer = spawn(
    config.whisperServerBin,
    ['-m', config.whisperModelPath, '-l', language, '--port', String(config.whisperServerPort), '--host', config.whisperServerHost],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  whisperServer.stderr?.on('data', () => undefined);
  whisperServer.on('exit', () => {
    whisperServer = null;
    whisperServerReady = null;
  });
  whisperServerReady = waitForWhisperServer();
  return whisperServerReady;
}

async function transcribeWithWhisperServer(wavPath: string): Promise<string> {
  await ensureWhisperServer();
  const form = new FormData();
  form.append('file', new Blob([await fsp.readFile(wavPath)], { type: 'audio/wav' }), path.basename(wavPath));
  form.append('response_format', 'json');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(new URL('/inference', config.whisperServerUrl), {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`whisper-server responded ${response.status}`);
    const payload = (await response.json()) as { text?: unknown };
    return cleanTranscript(typeof payload.text === 'string' ? payload.text : '');
  } finally {
    clearTimeout(timeout);
  }
}

async function transcribeWithWhisperCli(wavPath: string): Promise<string> {
  const language = targetLanguageCode(config.targetLanguage) ?? config.targetLanguage;
  const args = ['-m', config.whisperModelPath, '-l', language, '-np', '-nt', '-f', wavPath];
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(config.whisperCliBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
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
      if (code === 0) resolve(stdout);
      else reject(new Error(`whisper-cli exited ${code}: ${stderr.slice(0, 400)}`));
    });
  });
  return cleanTranscript(output);
}

async function transcribeLocal(filePath: string): Promise<string> {
  const wav = await convertToWhisperWav(filePath);
  try {
    if (providerState.whisperServerAvailable) return await transcribeWithWhisperServer(wav.filePath);
    return await transcribeWithWhisperCli(wav.filePath);
  } finally {
    await wav.cleanup();
  }
}

export async function transcribeAudio(filePath: string): Promise<string> {
  const primary = providerState.transcribeProvider;
  if (primary === 'local-whisper') {
    try {
      return await transcribeLocal(filePath);
    } catch (error) {
      if (!providerState.openaiAvailable) throw error;
    }
  }
  if (providerState.openaiAvailable) return transcribeOpenAi(filePath);
  throw new Error('No transcription provider is available.');
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
  const primary = providerState.quizProvider;
  if (primary === 'ollama') {
    try {
      return await generateLocalQuestions(transcript, difficulty);
    } catch (error) {
      if (!providerState.openaiAvailable) throw error;
    }
  }
  if (providerState.openaiAvailable) return generateOpenAiQuestions(transcript, difficulty);
  throw new Error('No quiz generation provider is available.');
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
