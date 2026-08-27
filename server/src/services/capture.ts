import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

export type CaptureErrorCode = 'unsupported_stream' | 'stream_failed' | 'no_audio';

export class CaptureError extends Error {
  constructor(
    readonly code: CaptureErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CaptureError';
  }
}

export interface Capture {
  filePath: string;
  bytes: number;
  /** Removes the temp file; safe to call more than once. */
  cleanup: () => Promise<void>;
}

let ffmpegProbe: Promise<boolean> | null = null;

export function ffmpegAvailable(): Promise<boolean> {
  ffmpegProbe ??= new Promise<boolean>((resolve) => {
    const child = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
  return ffmpegProbe;
}

/** Extensions the transcription API accepts directly. */
const DIRECT_EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mpeg3': 'mp3',
  'audio/x-mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/webm': 'webm',
};

const PLAYLIST_TYPES = ['audio/x-scpls', 'audio/scpls', 'audio/x-mpegurl', 'audio/mpegurl', 'application/pls+xml'];
const HLS_TYPES = ['application/vnd.apple.mpegurl', 'application/x-mpegurl'];

function contentType(response: Response): string {
  return (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

function looksLikeHls(url: string, type: string): boolean {
  return url.toLowerCase().includes('.m3u8') || HLS_TYPES.includes(type);
}

async function ensureTmpDir(): Promise<void> {
  await fsp.mkdir(config.tmpDir, { recursive: true });
}

function tmpFile(extension: string): string {
  return path.join(config.tmpDir, `capture-${randomUUID()}.${extension}`);
}

function makeCleanup(filePath: string): () => Promise<void> {
  let done = false;
  return async () => {
    if (done) return;
    done = true;
    await fsp.rm(filePath, { force: true }).catch(() => undefined);
  };
}

/** Pulls the first stream URL out of a .pls or .m3u playlist body. */
function firstUrlInPlaylist(body: string): string | null {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const plsMatch = /^File\d+\s*=\s*(\S+)$/i.exec(trimmed);
    if (plsMatch?.[1]) return plsMatch[1];
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
  }
  return null;
}

/**
 * Buffers ~`captureSeconds` of a plain icecast/shoutcast stream. We never send
 * `Icy-MetaData`, so the server does not interleave title metadata and the
 * bytes we write are a valid audio file as-is.
 */
async function captureDirect(url: string, response: Response, extension: string, seconds: number): Promise<Capture> {
  if (!response.body) throw new CaptureError('stream_failed', `No response body from ${url}`);

  await ensureTmpDir();
  const filePath = tmpFile(extension);
  const handle = await fsp.open(filePath, 'w');
  const cleanup = makeCleanup(filePath);

  const reader = response.body.getReader();
  let bytes = 0;

  // One shared deadline promise: racing a fresh setTimeout per chunk would
  // leave thousands of live timers on a low-bitrate 60s capture.
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadlineReached = new Promise<null>((resolve) => {
    deadlineTimer = setTimeout(() => resolve(null), seconds * 1000);
  });

  try {
    while (bytes < config.captureMaxBytes) {
      const chunk = await Promise.race([reader.read(), deadlineReached]);
      if (chunk === null) break; // hit the capture deadline mid-read
      if (chunk.done) break;
      if (chunk.value) {
        await handle.write(chunk.value);
        bytes += chunk.value.byteLength;
      }
    }
  } catch (error) {
    await handle.close();
    await cleanup();
    throw new CaptureError('stream_failed', `Stream read failed: ${(error as Error).message}`);
  } finally {
    clearTimeout(deadlineTimer);
    await reader.cancel().catch(() => undefined);
  }

  await handle.close();

  // A few KB is a connection that dropped immediately, not a minute of radio.
  if (bytes < 16 * 1024) {
    await cleanup();
    throw new CaptureError('no_audio', `Only ${bytes} bytes captured from ${url}`);
  }

  return { filePath, bytes, cleanup };
}

/**
 * ffmpeg path for anything the transcription API will not take raw: HLS
 * playlists, AAC/Ogg streams, and unlabelled formats. Optional dependency —
 * without it those stations simply cannot be quizzed.
 */
async function captureWithFfmpeg(url: string, seconds: number): Promise<Capture> {
  await ensureTmpDir();
  const filePath = tmpFile('mp3');
  const cleanup = makeCleanup(filePath);

  const args = [
    '-nostdin',
    '-loglevel', 'error',
    '-user_agent', config.userAgent,
    '-i', url,
    '-t', String(seconds),
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-b:a', '64k',
    '-y', filePath,
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    // ffmpeg reads a live stream forever if the input never ends; -t bounds
    // the output but a stalled connection still needs a hard stop.
    const killTimer = setTimeout(() => child.kill('SIGKILL'), (seconds + 45) * 1000);

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    child.on('error', (error) => {
      clearTimeout(killTimer);
      reject(new CaptureError('unsupported_stream', `ffmpeg failed to start: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(killTimer);
      if (code === 0) resolve();
      else reject(new CaptureError('stream_failed', `ffmpeg exited ${code}: ${stderr.slice(0, 400)}`));
    });
  });

  const stat = await fsp.stat(filePath).catch(() => null);
  if (!stat || stat.size < 8 * 1024) {
    await cleanup();
    throw new CaptureError('no_audio', `ffmpeg produced no usable audio from ${url}`);
  }

  return { filePath, bytes: stat.size, cleanup };
}

/**
 * Captures a clip of a live station. Returns a temp file the caller must
 * `cleanup()` once transcription is done.
 */
export async function captureStream(streamUrl: string, seconds = config.captureSeconds): Promise<Capture> {
  let url = streamUrl;

  for (let hop = 0; hop < 2; hop++) {
    if (looksLikeHls(url, '')) {
      if (!(await ffmpegAvailable())) {
        throw new CaptureError('unsupported_stream', 'This station uses HLS, which needs ffmpeg installed.');
      }
      return captureWithFfmpeg(url, seconds);
    }

    const controller = new AbortController();
    let response: Response;
    try {
      response = await fetch(url, {
        // No Icy-MetaData header on purpose: we want a clean audio byte stream.
        headers: { 'User-Agent': config.userAgent, Accept: '*/*' },
        signal: controller.signal,
        redirect: 'follow',
      });
    } catch (error) {
      throw new CaptureError('stream_failed', `Could not connect to the stream: ${(error as Error).message}`);
    }

    if (!response.ok) {
      controller.abort();
      throw new CaptureError('stream_failed', `Stream responded ${response.status}`);
    }

    const type = contentType(response);

    if (PLAYLIST_TYPES.includes(type)) {
      const body = await response.text();
      const next = firstUrlInPlaylist(body);
      if (!next) throw new CaptureError('unsupported_stream', 'Station returned an empty playlist.');
      url = new URL(next, url).toString();
      continue;
    }

    if (looksLikeHls(url, type)) {
      controller.abort();
      if (!(await ffmpegAvailable())) {
        throw new CaptureError('unsupported_stream', 'This station uses HLS, which needs ffmpeg installed.');
      }
      return captureWithFfmpeg(url, seconds);
    }

    const extension = DIRECT_EXTENSIONS[type];
    if (extension) return captureDirect(url, response, extension, seconds);

    // AAC, Ogg, or an unlabelled stream: transcode if we can, otherwise stop.
    controller.abort();
    if (await ffmpegAvailable()) return captureWithFfmpeg(url, seconds);
    throw new CaptureError(
      'unsupported_stream',
      `This station streams ${type || 'an unknown format'}, which needs ffmpeg installed.`,
    );
  }

  throw new CaptureError('unsupported_stream', 'Too many playlist redirects.');
}

/** Clears anything a crashed capture left behind; called once at boot. */
export function sweepTmpDir(): void {
  if (!fs.existsSync(config.tmpDir)) return;
  for (const entry of fs.readdirSync(config.tmpDir)) {
    if (entry.startsWith('capture-')) {
      fs.rmSync(path.join(config.tmpDir, entry), { force: true });
    }
  }
}
