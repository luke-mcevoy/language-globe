import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { captionText } from '../lib/captions.js';
import { CaptureError, openStreamSource, type StreamSource } from './capture.js';
import { transcribeChunk, type TranscribeResult } from './providers.js';
import type { CaptionWord, Station } from '../types.js';

export interface CaptionResult {
  seq: number;
  text: string;
  capturedAt: string;
  /** ms since session start when this chunk's audio window began. */
  startMs: number;
  /** ms since session start when this chunk's audio window ended. */
  endMs: number;
  /** Per-word timings on the session time axis, when the provider reports them. */
  words?: CaptionWord[];
}

interface AudioByteChunk {
  data: Uint8Array;
  receivedAt: number;
  /** Monotonic position in the stream, so relay connections keep private cursors. */
  seq: number;
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
  transcribe?: (filePath: string) => Promise<TranscribeResult>;
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
  createdAtMs: number;
  lastPollAtMs: number;
  everPolled = false;

  private readonly maxResults: number;
  private readonly maxAudioBufferMs: number;
  private readonly now: () => number;
  private readonly transcribe: (filePath: string) => Promise<TranscribeResult>;
  private readonly openSource: (url: string) => Promise<StreamSource>;
  private readonly onError: (error: unknown) => void;
  private results: CaptionResult[] = [];
  private audioBytes: AudioByteChunk[] = [];
  private audioSeq = 0;
  private resultWaiters: ResultWaiter[] = [];
  private audioWaiters: AudioWaiter[] = [];
  private nextSeq = 1;
  private source: StreamSource | null = null;
  private stopped = false;
  private error: unknown = null;
  /**
   * Wall-clock ms of the first byte that survived the burst-window drop.
   * All chunk/word timings are reported relative to this so the client has
   * one continuous timeline that begins near audio.currentTime=0 on the
   * relayed stream (see PLAN-CAPTIONS-V3.md).
   */
  private sessionStartMs: number | null = null;

  constructor(
    private readonly station: Station,
    options: CaptionSessionOptions = {},
  ) {
    this.stationId = station.id;
    this.chunkSeconds = options.chunkSeconds ?? config.captionChunkSeconds;
    this.maxResults = options.maxResults ?? 80;
    this.maxAudioBufferMs = options.maxAudioBufferMs ?? 180_000;
    this.now = options.now ?? Date.now;
    this.transcribe = options.transcribe ?? transcribeChunk;
    this.openSource = options.openSource ?? openStreamSource;
    this.onError = options.onError ?? (() => undefined);
    this.createdAt = new Date(this.now()).toISOString();
    this.lastPollAt = this.createdAt;
    this.createdAtMs = this.now();
    this.lastPollAtMs = this.createdAtMs;
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
    this.lastPollAtMs = this.now();
    this.everPolled = true;
  }

  appendResult(
    input:
      | string
      | {
          text: string;
          startMs?: number;
          endMs?: number;
          words?: CaptionWord[];
          capturedAt?: string;
        },
    capturedAt = new Date(this.now()).toISOString(),
  ): CaptionResult {
    const payload =
      typeof input === 'string'
        ? { text: input, startMs: this.sessionOffsetMs(this.now()), endMs: this.sessionOffsetMs(this.now()) }
        : input;
    const result: CaptionResult = {
      seq: this.nextSeq++,
      text: payload.text,
      capturedAt: payload.capturedAt ?? capturedAt,
      startMs: payload.startMs ?? this.sessionOffsetMs(this.now()),
      endMs: payload.endMs ?? this.sessionOffsetMs(this.now()),
      ...(payload.words && payload.words.length > 0 ? { words: payload.words } : {}),
    };
    this.results.push(result);
    if (this.results.length > this.maxResults) this.results = this.results.slice(-this.maxResults);
    this.flushResultWaiters();
    return result;
  }

  private sessionOffsetMs(wallMs: number): number {
    if (this.sessionStartMs === null) return 0;
    return Math.max(0, wallMs - this.sessionStartMs);
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

  /** How much post-burst audio the relay has buffered; null until the first byte lands. */
  audioBufferedMs(): number | null {
    return this.sessionStartMs === null ? null : this.now() - this.sessionStartMs;
  }

  /**
   * Every connection reads the shared buffer through its own cursor and always
   * starts from the oldest byte (session offset 0). Browsers routinely open
   * more than one connection to a media URL (preload probes, dev-mode double
   * mounts); when consumption was destructive, the connection that actually
   * played started wherever the previous one stopped, silently shifting
   * audio.currentTime against the session axis and desyncing the karaoke.
   */
  async *audioRelay(delaySeconds: number): AsyncGenerator<Uint8Array> {
    this.touch();
    const delayMs = Math.max(0, delaySeconds * 1000);
    let lastSeq = 0;
    while (!this.stopped) {
      this.touch();
      const cutoff = this.now() - delayMs;
      for (const chunk of this.audioBytes) {
        if (chunk.seq <= lastSeq) continue;
        if (chunk.receivedAt > cutoff) break;
        lastSeq = chunk.seq;
        yield chunk.data;
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

    // Time-to-first-caption schedule. The icecast connect burst floods in
    // within the first second or two, so 3s is plenty to discard it — a full
    // 15s burst window made the first caption take >30s. After that, short
    // ramp-up chunks get words on screen in seconds; steady-state chunks stay
    // at chunkSeconds for transcription quality.
    const BURST_WINDOW_MS = 3_000;
    const RAMP_SECONDS = [4, 6, 10];
    let rampIndex = 0;
    const windowDurationMs = () => {
      if (droppingBurstWindow) return BURST_WINDOW_MS;
      const rampSeconds = RAMP_SECONDS[rampIndex];
      return (rampSeconds ?? this.chunkSeconds) * 1000;
    };

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
      const closingWindowStart = windowStart;
      const closingWindowEnd = this.now();
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
      rampIndex += 1;
      if (closingBytes < 8 * 1024) {
        await fsp.rm(closingPath, { force: true }).catch(() => undefined);
        return;
      }

      // Freeze the session-axis window bounds NOW, before spawning transcription:
      // sessionStartMs is guaranteed to be set here (a byte flowed since burst)
      // so word timings that come back are anchored to the correct window.
      const startMs = this.sessionOffsetMs(closingWindowStart);
      const endMs = this.sessionOffsetMs(closingWindowEnd);

      void this.transcribe(closingPath)
        .then((result) => {
          const words = result.words?.map((word) => ({
            word: word.word,
            startMs: startMs + word.startMs,
            endMs: startMs + word.endMs,
          }));
          this.appendResult({
            text: captionText(result.text),
            startMs,
            endMs,
            words,
            capturedAt: new Date(this.now()).toISOString(),
          });
        })
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

        if (this.now() - windowStart >= windowDurationMs()) {
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
    // The relay begins yielding here, so anchor the session timeline on the
    // first surviving byte. audio.currentTime=0 on the client then lines up
    // with session-offset 0, and chunk/word timings sit on the same axis.
    if (this.sessionStartMs === null) this.sessionStartMs = receivedAt;
    this.audioBytes.push({ data, receivedAt, seq: ++this.audioSeq });
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
  private readonly now: () => number;
  private readonly sessionOptions: CaptionSessionOptions;
  private readonly sessions = new Map<string, { session: CaptionSession; expiry: ReturnType<typeof setTimeout> }>();
  /** Serializes create(); see the comment inside create for why. */
  private createChain: Promise<unknown> = Promise.resolve();

  constructor(options: CaptionSessionStoreOptions = {}) {
    // Each session costs one stream connection plus ~1.5s of whisper CPU per
    // 15s chunk, so four concurrent sessions is comfortable — and it keeps a
    // second tab or a dev test run from starving the user's live session.
    this.maxSessions = options.maxSessions ?? 4;
    this.expireMs = options.expireMs ?? 10 * 60_000;
    this.longPollMs = options.longPollMs ?? 25_000;
    this.now = options.now ?? Date.now;
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

  async create(station: Station, language?: string): Promise<CaptionSession> {
    // Creates must run one at a time: the session only lands in the map
    // *after* session.start() opens the stream (seconds), so two concurrent
    // creates for the same station would both pass the eviction scan and the
    // cap check, then both insert — filling the cap with duplicates. React
    // StrictMode's double-mount fires exactly that pattern.
    const run = this.createChain.then(() => this.createSerialized(station, language));
    this.createChain = run.catch(() => undefined);
    return run;
  }

  /**
   * Reclaim sessions nobody is reading. A live client long-polls continuously
   * (25s max wait), so its lastPollAt is always fresh; a session that has
   * never been polled a few seconds after create is an orphan whose create
   * response never reached the client (e.g. the browser aborted the request
   * while switching stations, so the client never learned the id to delete).
   */
  private evictAbandonedSessions(): void {
    const now = this.now();
    for (const [id, entry] of this.sessions) {
      const { session } = entry;
      const neverPolledOrphan = !session.everPolled && now - session.createdAtMs > 5_000;
      const stale = now - session.lastPollAtMs > this.longPollMs + 15_000;
      if (neverPolledOrphan || stale) this.delete(id);
    }
  }

  private async createSerialized(station: Station, language?: string): Promise<CaptionSession> {
    this.evictStationSessions(station.id);
    if (this.sessions.size >= this.maxSessions) this.evictAbandonedSessions();

    if (this.sessions.size >= this.maxSessions) {
      throw new CaptureError('stream_failed', 'Too many caption sessions are active. Close captions in another tab and try again.');
    }

    const session = new CaptionSession(station, {
      ...this.sessionOptions,
      transcribe: this.sessionOptions.transcribe ?? ((filePath) => transcribeChunk(filePath, language)),
    });
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
