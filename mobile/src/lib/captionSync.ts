/**
 * Karaoke timing helpers for Sync-mode captions (see PLAN-CAPTIONS-V3.md).
 *
 * The server exposes every chunk and word on a single session time axis
 * (ms since the first byte of relayed audio). The relay serves EVERY
 * connection — first connect, browser preload probes, reconnects — from
 * session offset 0, so the audio element's `currentTime` IS the session
 * clock: `currentTime * 1000` is the session time currently being heard.
 * No wall-clock correction is applied; every estimate of "when the session
 * started" from the client side is off by connect/buffer latency and
 * historically pushed the highlight seconds ahead of the audio.
 */

export interface WordWithBounds {
  startMs: number;
  endMs: number;
}

export interface ChunkTiming {
  seq: number;
  startMs: number;
  endMs: number;
  words?: readonly WordWithBounds[];
}

export function sessionTimeAt(audioCurrentTimeSeconds: number): number {
  return audioCurrentTimeSeconds * 1000;
}

/**
 * Binary-search the word whose [startMs, endMs) window contains `sessionMs`.
 * Returns -1 when `sessionMs` is before every word or the list is empty,
 * and `words.length - 1` when it is beyond the last word's end (so callers
 * can still dim already-spoken words in that chunk).
 */
export function findActiveWordIndex(words: readonly WordWithBounds[], sessionMs: number): number {
  if (words.length === 0) return -1;
  if (sessionMs < words[0]!.startMs) return -1;
  if (sessionMs >= words[words.length - 1]!.endMs) return words.length - 1;

  let lo = 0;
  let hi = words.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const w = words[mid]!;
    if (sessionMs < w.startMs) hi = mid - 1;
    else if (sessionMs >= w.endMs) lo = mid + 1;
    else return mid;
  }
  // Between two words (a small gap the model did not annotate): treat the
  // upcoming word as the current one so highlighting keeps moving.
  return Math.min(lo, words.length - 1);
}

/**
 * Categorise every word in a chunk so the UI can render past / current /
 * future differently. The current word is the one whose window contains
 * `sessionMs`; when we are strictly between two words we treat none as
 * current (returns -1) — the caller keeps the last "current" for a frame
 * to avoid flicker.
 */
export function classifyWord(
  word: WordWithBounds,
  sessionMs: number,
): 'past' | 'current' | 'future' {
  if (sessionMs >= word.endMs) return 'past';
  if (sessionMs >= word.startMs) return 'current';
  return 'future';
}

/**
 * Locates which chunk is currently playing. Prefers the chunk whose window
 * contains `sessionMs`; when we are between chunks (dead-air gaps) it
 * returns the most recent chunk that ended before now, so past words still
 * get dimmed correctly.
 */
export function findActiveChunk<T extends ChunkTiming>(chunks: readonly T[], sessionMs: number): T | null {
  if (chunks.length === 0) return null;
  let last: T | null = null;
  for (const chunk of chunks) {
    if (sessionMs >= chunk.startMs && sessionMs < chunk.endMs) return chunk;
    if (chunk.endMs <= sessionMs) last = chunk;
    else break;
  }
  return last;
}
