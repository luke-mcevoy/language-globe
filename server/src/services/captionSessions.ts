import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { captionText } from '../lib/captions.js';
import { CaptureError, openStreamSource, type StreamSource } from './capture.js';
import { transcribeAudio } from './providers.js';
import type { Station } from '../types.js';

export interface CaptionResult {
  seq: number;
  text: string;
  capturedAt: string;
}

interface AudioByteChunk {
  data: Uint8Array;
  receivedAt: number;
}

interface ResultWaiter {
  after: number;
  resolve: (results: CaptionResult[]) => void;
}

interface AudioWaiter {
  resolve: () => void;
}

export interface CaptionSessionSnapshot {
  id: string;
  stationId: string;
  contentType: string;
  createdAt: string;
  lastPollAt: string;
}

interface CaptionSessionOptions {
  chunkSeconds?: number;
  maxResults?: number;
  maxAudioBufferMs?: number;
  now?: () => number;
  transcribe?: (filePath: string) => Promise<string>;
  openSource?: (url: string) => Promise<StreamSource>;
  onError?: (error: unknown) => void;
}

export class CaptionSession {
  readonly id = randomUUID();
  readonly stationId: string;
  readonly createdAt: string;
  readonly chunkSeconds: number;
  contentType = 'audio/mpeg';
  lastPollAt: string;

  private readonly maxResults: number;
  private readonly maxAudioBufferMs: number;
  private readonly now: () => number;
  private readonly transcribe: (filePath: string) => Promise<string>;
  private readonly openSource: (url: string) => Promise<StreamSource>;
  private readonly onError: (error: unknown) => void;
  private results: CaptionResult[] = [];
  private audioBytes: AudioByteChunk[] = [];
  private resultWaiters: ResultWaiter[] = [];
  private audioWaiters: AudioWaiter[] = [];
  private nextSeq = 1;
  private source: StreamSource | null = null;
  private stopped = false;
  private error: unknown = null;

  constructor(
    private readonly station: Station,
    options: CaptionSessionOptions = {},
  ) {
    this.stationId = station.id;
    this.chunkSeconds = options.chunkSeconds ?? config.captionChunkSeconds;
    this.maxResults = options.maxResults ?? 80;
    this.maxAudioBufferMs = options.maxAudioBufferMs ?? 180_000;
    this.now = options.now ?? Date.now;
    this.transcribe = options.transcribe ?? transcribeAudio;
    this.openSource = options.openSource ?? openStreamSource;
    this.onError = options.onError ?? (() => undefined);
    this.createdAt = new Date(this.now()).toISOString();
    this.lastPollAt = this.createdAt;
  }

  get snapshot(): CaptionSessionSnapshot {
    return {
      id: this.id,
      stationId: this.stationId,
      contentType: this.contentType,
      createdAt: this.createdAt,
      lastPollAt: this.lastPollAt,
    };
  }

  async start(): Promise<void> {
    this.source = await this.openSource(this.station.url);
    this.contentType = this.source.contentType || 'audio/mpeg';
    void this.captureLoop();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    void this.source?.cleanup();
    this.resultWaiters.splice(0).forEach((waiter) => waiter.resolve([]));
    this.wakeAudioWaiters();
  }

  touch(): void {
    this.lastPollAt = new Date(this.now()).toISOString();
  }

  appendResult(text: string, capturedAt = new Date(this.now()).toISOString()): CaptionResult {
    const result = { seq: this.nextSeq++, text, capturedAt };
    this.results.push(result);
    if (this.results.length > this.maxResults) this.results = this.results.slice(-this.maxResults);
    this.flushResultWaiters();
    return result;
  }

  poll(after: number, timeoutMs: number): Promise<CaptionResult[]> {
    this.touch();
    const ready = this.resultsAfter(after);
    if (ready.length > 0 || this.stopped) return Promise.resolve(ready);
    if (this.error) return Promise.reject(this.error);

    return new Promise<CaptionResult[]>((resolve, reject) => {
      const waiter: ResultWaiter = {
        after,
        resolve: (results) => {
          clearTimeout(timer);
          resolve(results);
        },
      };
      const timer = setTimeout(() => {
        this.resultWaiters = this.resultWaiters.filter((candidate) => candidate !== waiter);
        if (this.error) reject(this.error);
        else resolve([]);
      }, timeoutMs);
      this.resultWaiters.push(waiter);
    });
  }

  async *audioRelay(delaySeconds: number): AsyncGenerator<Uint8Array> {
    this.touch();
    const delayMs = Math.max(0, delaySeconds * 1000);
    let index = 0;
    while (!this.stopped) {
      this.touch();
      const cutoff = this.now() - delayMs;
      while (index < this.audioBytes.length) {
        const chunk = this.audioBytes[index];
        if (!chunk || chunk.receivedAt > cutoff) break;
        index += 1;
        yield chunk.data;
      }
      if (index > 0) {
        this.audioBytes = this.audioBytes.slice(index);
        index = 0;
      }
      await this.waitForAudio(Math.min(1000, Math.max(100, delayMs)));
    }
  }

  resultsAfter(after: number): CaptionResult[] {
    return this.results.filter((result) => result.seq > after);
  }

  private async captureLoop(): Promise<void> {
    const source = this.source;
    if (!source?.body) return;

    let handle: FileHandle | null = null;
    let filePath: string | null = null;
    let bytesInWindow = 0;
    let windowStart = this.now();
    let droppingBurstWindow = true;

    const openWindow = async () => {
      await fsp.mkdir(config.tmpDir, { recursive: true });
      filePath = path.join(config.tmpDir, `caption-${this.id}-${randomUUID()}.${source.extension || 'mp3'}`);
      handle = await fsp.open(filePath, 'w');
      bytesInWindow = 0;
      windowStart = this.now();
    };

    const closeWindow = async () => {
      const closingHandle = handle;
      const closingPath = filePath;
      const closingBytes = bytesInWindow;
      handle = null;
      filePath = null;
      bytesInWindow = 0;
      await closingHandle?.close();

      if (!closingPath) return;
      if (droppingBurstWindow) {
        droppingBurstWindow = false;
        await fsp.rm(closingPath, { force: true }).catch(() => undefined);
        return;
      }
      if (closingBytes < 8 * 1024) {
        await fsp.rm(closingPath, { force: true }).catch(() => undefined);
        return;
      }

      void this.transcribe(closingPath)
        .then((transcript) => this.appendResult(captionText(transcript), new Date(this.now()).toISOString()))
        .catch((error) => this.onError(error))
        .finally(() => void fsp.rm(closingPath, { force: true }).catch(() => undefined));
    };

    try {
      await openWindow();
      const reader = source.body.getReader();
      while (!this.stopped) {
        const read = await reader.read();
        if (read.done) break;
        const chunk = read.value;
        if (!chunk) continue;

        // Skip audio-relay bytes for the burst window: icecast dumps 10-30s
        // of buffered audio on connect, and replaying it would put synced
        // playback 30s in the past on the very first frame.
        if (!droppingBurstWindow) this.pushAudio(chunk);
        const currentHandle = handle as FileHandle | null;
        if (currentHandle) {
          await currentHandle.write(chunk);
          bytesInWindow += chunk.byteLength;
        }

        if (this.now() - windowStart >= this.chunkSeconds * 1000) {
          await closeWindow();
          await openWindow();
        }
      }
      await reader.cancel().catch(() => undefined);
    } catch (error) {
      this.error = error;
      this.onError(error);
      this.flushResultWaiters();
    } finally {
      const remainingHandle = handle as FileHandle | null;
      await remainingHandle?.close().catch(() => undefined);
      if (filePath) await fsp.rm(filePath, { force: true }).catch(() => undefined);
      this.stop();
    }
  }

  private pushAudio(data: Uint8Array): void {
    const receivedAt = this.now();
    this.audioBytes.push({ data, receivedAt });
    const oldest = receivedAt - this.maxAudioBufferMs;
    while (this.audioBytes.length > 0 && (this.audioBytes[0]?.receivedAt ?? receivedAt) < oldest) this.audioBytes.shift();
    this.wakeAudioWaiters();
  }

  private flushResultWaiters(): void {
    const pending = this.resultWaiters;
    this.resultWaiters = [];
    for (const waiter of pending) {
      const ready = this.resultsAfter(waiter.after);
      if (ready.length > 0 || this.stopped || this.error) waiter.resolve(ready);
      else this.resultWaiters.push(waiter);
    }
  }

  private waitForAudio(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const waiter = { resolve };
      const timer = setTimeout(() => {
        this.audioWaiters = this.audioWaiters.filter((candidate) => candidate !== waiter);
        resolve();
      }, timeoutMs);
      this.audioWaiters.push({
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      });
    });
  }

  private wakeAudioWaiters(): void {
    this.audioWaiters.splice(0).forEach((waiter) => waiter.resolve());
  }
}

interface CaptionSessionStoreOptions extends CaptionSessionOptions {
  maxSessions?: number;
  expireMs?: number;
  longPollMs?: number;
}

export class CaptionSessionStore {
  readonly maxSessions: number;
  readonly expireMs: number;
  readonly longPollMs: number;
  private readonly sessionOptions: CaptionSessionOptions;
  private readonly sessions = new Map<string, { session: CaptionSession; expiry: ReturnType<typeof setTimeout> }>();
  /** Serializes create(); see the comment inside create for why. */
  private createChain: Promise<unknown> = Promise.resolve();

  constructor(options: CaptionSessionStoreOptions = {}) {
    this.maxSessions = options.maxSessions ?? 2;
    this.expireMs = options.expireMs ?? 10 * 60_000;
    this.longPollMs = options.longPollMs ?? 25_000;
    this.sessionOptions = options;
  }

  get size(): number {
    return this.sessions.size;
  }

  /**
   * A new session for a station supersedes any existing one for the same
   * station. This absorbs client-side races (React StrictMode double-mount
   * aborts the first create before its response — and therefore its id —
   * ever reaches the client, so the client can never delete it) instead of
   * letting orphans eat the session cap.
   */
  private evictStationSessions(stationId: string): void {
    for (const [id, entry] of this.sessions) {
      if (entry.session.stationId === stationId) this.delete(id);
    }
  }

  async create(station: Station): Promise<CaptionSession> {
    // Creates must run one at a time: the session only lands in the map
    // *after* session.start() opens the stream (seconds), so two concurrent
    // creates for the same station would both pass the eviction scan and the
    // cap check, then both insert — filling the cap with duplicates. React
    // StrictMode's double-mount fires exactly that pattern.
    const run = this.createChain.then(() => this.createSerialized(station));
    this.createChain = run.catch(() => undefined);
    return run;
  }

  private async createSerialized(station: Station): Promise<CaptionSession> {
    this.evictStationSessions(station.id);

    if (this.sessions.size >= this.maxSessions) {
      throw new CaptureError('stream_failed', 'Too many caption sessions are active. Close captions in another tab and try again.');
    }

    const session = new CaptionSession(station, this.sessionOptions);
    await session.start();
    const expiry = this.scheduleExpiry(session.id);
    this.sessions.set(session.id, { session, expiry });
    return session;
  }

  addForTest(session: CaptionSession): void {
    this.evictStationSessions(session.stationId);
    if (this.sessions.size >= this.maxSessions) {
      throw new CaptureError('stream_failed', 'Too many caption sessions are active.');
    }
    this.sessions.set(session.id, { session, expiry: this.scheduleExpiry(session.id) });
  }

  get(id: string): CaptionSession | null {
    return this.sessions.get(id)?.session ?? null;
  }

  async poll(id: string, after: number): Promise<CaptionResult[] | null> {
    const entry = this.sessions.get(id);
    if (!entry) return null;
    entry.session.touch();
    clearTimeout(entry.expiry);
    entry.expiry = this.scheduleExpiry(id);
    return entry.session.poll(after, this.longPollMs);
  }

  delete(id: string): boolean {
    const entry = this.sessions.get(id);
    if (!entry) return false;
    clearTimeout(entry.expiry);
    entry.session.stop();
    this.sessions.delete(id);
    return true;
  }

  clear(): void {
    for (const id of [...this.sessions.keys()]) this.delete(id);
  }

  private scheduleExpiry(id: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      this.delete(id);
    }, this.expireMs);
  }
}

export const captionSessions = new CaptionSessionStore();
