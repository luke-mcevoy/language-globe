/**
 * Karaoke timing helpers for Sync-mode captions (see PLAN-CAPTIONS-V3.md).
 *
 * The server exposes every chunk and word on a single session time axis
 * (ms since the first byte of relayed audio). On the client, the audio
 * element's `currentTime` is a monotonic reading of how much of that same
 * stream has played, so `audio.currentTime * 1000 + baseOffsetMs` gives
 * the session time currently being HEARD.
 *
 * `baseOffsetMs` starts at 0 (a fresh sync-mode session begins near
 * audio.currentTime=0 ≈ session-offset 0) and is re-anchored on each new
 * chunk that arrives: MP3 frame quantization + VBR make raw currentTime
 * drift over minutes.
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

export interface PlaybackAnchor {
  baseOffsetMs: number;
}

export const initialPlaybackAnchor = (): PlaybackAnchor => ({ baseOffsetMs: 0 });

export function sessionTimeAt(anchor: PlaybackAnchor, audioCurrentTimeSeconds: number): number {
  return audioCurrentTimeSeconds * 1000 + anchor.baseOffsetMs;
}

/**
 * The audio element's currentTime is the authoritative clock: the relay
 * serves the stream from session-offset 0, so currentTime maps 1:1 onto the
 * word timestamps regardless of when playback managed to start. The
 * wall-clock estimate (client time since session start minus the relay
 * delay) is only a coarse sanity check — it is systematically wrong by the
 * player's startup lag (connect + pre-buffer, easily seconds), so snapping
 * to it continuously pushes the highlight AHEAD of the audio. We therefore
 * re-anchor only when the two clocks disagree so badly that the audio
 * element must have reconnected mid-session (its currentTime restarts at 0
 * while the relay resumes mid-stream).
 */
export function reanchorPlayback(params: {
  anchor: PlaybackAnchor;
  clientNowMs: number;
  sessionEpochMs: number;
  relayDelayMs: number;
  audioCurrentTimeSeconds: number;
  /**
   * How far the clocks may disagree before we snap to the wall estimate.
   * Must exceed the worst honest disagreement: the switch margin (~8s) plus
   * player startup lag — otherwise we would "correct" ordinary startup into
   * a permanent lead. Reconnect desyncs grow with playback position, so
   * they still clear this bar within a chunk or two.
   */
  toleranceMs?: number;
}): PlaybackAnchor {
  const toleranceMs = params.toleranceMs ?? 15_000;
  const expectedSessionMs = params.clientNowMs - params.sessionEpochMs - params.relayDelayMs;
  const audioSessionMs = sessionTimeAt(params.anchor, params.audioCurrentTimeSeconds);
  if (Math.abs(expectedSessionMs - audioSessionMs) <= toleranceMs) return params.anchor;
  return { baseOffsetMs: expectedSessionMs - params.audioCurrentTimeSeconds * 1000 };
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
