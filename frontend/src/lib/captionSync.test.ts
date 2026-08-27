import { describe, expect, it } from 'vitest';
import {
  classifyWord,
  findActiveChunk,
  findActiveWordIndex,
  initialPlaybackAnchor,
  reanchorPlayback,
  sessionTimeAt,
} from './captionSync';

const words = [
  { startMs: 0, endMs: 200 },
  { startMs: 200, endMs: 500 },
  { startMs: 500, endMs: 900 },
  { startMs: 900, endMs: 1400 },
];

describe('findActiveWordIndex', () => {
  it('returns -1 before the first word', () => {
    expect(findActiveWordIndex(words, -50)).toBe(-1);
  });

  it('finds the current word at boundary and inside', () => {
    expect(findActiveWordIndex(words, 0)).toBe(0);
    expect(findActiveWordIndex(words, 199)).toBe(0);
    expect(findActiveWordIndex(words, 200)).toBe(1);
    expect(findActiveWordIndex(words, 450)).toBe(1);
    expect(findActiveWordIndex(words, 1200)).toBe(3);
  });

  it('clamps to the last word once time passes its end', () => {
    expect(findActiveWordIndex(words, 1400)).toBe(3);
    expect(findActiveWordIndex(words, 100_000)).toBe(3);
  });

  it('picks the next word when landing in a gap the model did not annotate', () => {
    const gappy = [
      { startMs: 0, endMs: 200 },
      { startMs: 400, endMs: 600 },
    ];
    expect(findActiveWordIndex(gappy, 300)).toBe(1);
  });

  it('handles an empty word list', () => {
    expect(findActiveWordIndex([], 500)).toBe(-1);
  });
});

describe('classifyWord', () => {
  const word = { startMs: 500, endMs: 900 };
  it('labels past, current, and future', () => {
    expect(classifyWord(word, 100)).toBe('future');
    expect(classifyWord(word, 500)).toBe('current');
    expect(classifyWord(word, 899)).toBe('current');
    expect(classifyWord(word, 900)).toBe('past');
    expect(classifyWord(word, 5000)).toBe('past');
  });
});

describe('playback anchor', () => {
  it('starts with a zero base offset so audio.currentTime maps straight onto session time', () => {
    const anchor = initialPlaybackAnchor();
    expect(sessionTimeAt(anchor, 0)).toBe(0);
    expect(sessionTimeAt(anchor, 12.5)).toBe(12_500);
  });

  it('trusts audio.currentTime when the wall-clock estimate only disagrees by startup lag', () => {
    // Session started 25s ago, relay delay 20s → wall estimate says session
    // offset 5000ms. The audio element started ~3s late (connect +
    // pre-buffer), so it is genuinely playing offset 2000ms. currentTime is
    // the truth; the anchor must NOT snap the highlight 3s ahead.
    const anchor = reanchorPlayback({
      anchor: initialPlaybackAnchor(),
      clientNowMs: 25_000,
      sessionEpochMs: 0,
      relayDelayMs: 20_000,
      audioCurrentTimeSeconds: 2,
    });
    expect(sessionTimeAt(anchor, 2)).toBe(2_000);
    expect(sessionTimeAt(anchor, 2.5)).toBe(2_500);
  });

  it('tolerates the switch margin plus startup lag without snapping', () => {
    // Switch waits for delay+8s of buffer, player takes ~2s to start: the
    // wall estimate leads currentTime by ~10s. Still the honest case.
    const anchor = reanchorPlayback({
      anchor: initialPlaybackAnchor(),
      clientNowMs: 32_000,
      sessionEpochMs: 0,
      relayDelayMs: 20_000,
      audioCurrentTimeSeconds: 2,
    });
    expect(sessionTimeAt(anchor, 2)).toBe(2_000);
  });

  it('snaps to the wall-clock estimate only on gross desync (audio element reconnected)', () => {
    // currentTime restarted at ~1s while the session is 60s in (20s delay →
    // expected offset 40000ms). A 39s disagreement means the element
    // reconnected mid-session and its clock no longer maps onto the axis.
    const anchor = reanchorPlayback({
      anchor: initialPlaybackAnchor(),
      clientNowMs: 60_000,
      sessionEpochMs: 0,
      relayDelayMs: 20_000,
      audioCurrentTimeSeconds: 1,
    });
    expect(sessionTimeAt(anchor, 1)).toBe(40_000);
    // And once snapped, ordinary residual disagreement is left alone again.
    const stable = reanchorPlayback({
      anchor,
      clientNowMs: 65_000,
      sessionEpochMs: 0,
      relayDelayMs: 20_000,
      audioCurrentTimeSeconds: 5.8,
    });
    expect(stable).toBe(anchor);
  });
});

describe('findActiveChunk', () => {
  const chunks = [
    { seq: 1, startMs: 0, endMs: 15_000 },
    { seq: 2, startMs: 15_000, endMs: 30_000 },
    { seq: 3, startMs: 30_000, endMs: 45_000 },
  ];

  it('returns the chunk currently being spoken', () => {
    expect(findActiveChunk(chunks, 0)?.seq).toBe(1);
    expect(findActiveChunk(chunks, 14_999)?.seq).toBe(1);
    expect(findActiveChunk(chunks, 15_000)?.seq).toBe(2);
    expect(findActiveChunk(chunks, 44_500)?.seq).toBe(3);
  });

  it('returns null before the first chunk', () => {
    expect(findActiveChunk(chunks, -1)).toBeNull();
    expect(findActiveChunk([], 500)).toBeNull();
  });

  it('falls back to the previous chunk when the playhead is in dead air after all chunks', () => {
    // 90s past the last chunk end — still returns the last chunk so its
    // already-spoken words remain visible.
    expect(findActiveChunk(chunks, 90_000)?.seq).toBe(3);
  });
});
