import { describe, expect, it, vi } from 'vitest';
import { CaptionSession, CaptionSessionStore } from '../src/services/captionSessions.js';
import type { Station } from '../src/types.js';

const station: Station = {
  id: 'station-1',
  name: 'Radio Test',
  url: 'https://example.com/live.mp3',
  homepage: '',
  favicon: '',
  tags: [],
  country: 'Spain',
  countryCode: 'ES',
  state: '',
  language: 'Spanish',
  lat: 40,
  lon: -3,
  clickcount: 1,
  votes: 1,
  codec: 'MP3',
  bitrate: 128,
  kind: 'talk',
  reachable: true,
};

describe('CaptionSession', () => {
  it('assigns monotonically increasing sequence numbers', () => {
    const session = new CaptionSession(station);

    expect(session.appendResult('uno').seq).toBe(1);
    expect(session.appendResult('dos').seq).toBe(2);
    expect(session.appendResult('tres').seq).toBe(3);
  });

  it('filters results by after sequence', () => {
    const session = new CaptionSession(station);
    session.appendResult('uno');
    session.appendResult('dos');
    session.appendResult('tres');

    expect(session.resultsAfter(1).map((result) => result.text)).toEqual(['dos', 'tres']);
    expect(session.resultsAfter(3)).toEqual([]);
  });
});

describe('CaptionSessionStore', () => {
  it('expires sessions after inactivity', () => {
    vi.useFakeTimers();
    try {
      const store = new CaptionSessionStore({ expireMs: 1000 });
      const session = new CaptionSession(station);
      store.addForTest(session);

      expect(store.get(session.id)).toBe(session);
      vi.advanceTimersByTime(1000);
      expect(store.get(session.id)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('enforces the concurrent session cap', () => {
    const store = new CaptionSessionStore({ maxSessions: 2 });
    store.addForTest(new CaptionSession(station));
    store.addForTest(new CaptionSession({ ...station, id: 'station-2' }));

    expect(() => store.addForTest(new CaptionSession({ ...station, id: 'station-3' }))).toThrow(
      /Too many caption sessions/,
    );
  });

  it('serializes concurrent creates so same-station duplicates cannot slip past eviction', async () => {
    // Slow openSource simulates the real stream connection: without
    // serialization, both creates pass the eviction scan before either
    // session lands in the map, leaving two sessions for one station.
    const openSource = () =>
      new Promise<void>((resolve) => setTimeout(resolve, 20)).then(() => ({
        url: station.url,
        contentType: 'audio/mpeg',
        extension: 'mp3',
        body: new ReadableStream<Uint8Array>({ start: () => undefined }),
        cleanup: async () => undefined,
      }));
    const store = new CaptionSessionStore({ maxSessions: 2, openSource, transcribe: async () => '' });

    const [first, second] = await Promise.all([store.create(station), store.create(station)]);
    expect(store.size).toBe(1);
    expect(store.get(first.id)).toBeNull();
    expect(store.get(second.id)).toBe(second);

    store.clear();
  });

  it('replaces an existing session for the same station instead of counting it against the cap', () => {
    const store = new CaptionSessionStore({ maxSessions: 2 });
    const first = new CaptionSession(station);
    store.addForTest(first);

    // Same station again (e.g. StrictMode double-mount orphan): supersedes.
    const second = new CaptionSession(station);
    store.addForTest(second);
    expect(store.get(first.id)).toBeNull();
    expect(store.get(second.id)).toBe(second);
    expect(store.size).toBe(1);

    // A different station still fits under the cap afterwards.
    store.addForTest(new CaptionSession({ ...station, id: 'station-2' }));
    expect(store.size).toBe(2);
  });
});
