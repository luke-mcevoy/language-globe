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

  it('serves every relay connection from the start of the buffer', async () => {
    // Browsers open more than one connection to a media URL (preload probe,
    // dev-mode double mount). If reading were destructive, the connection that
    // actually plays would start mid-stream and audio.currentTime would no
    // longer map to session offset 0 — desyncing the karaoke highlight.
    const session = new CaptionSession(station, { now: () => 1000 });
    const push = (text: string) =>
      (session as unknown as { pushAudio(data: Uint8Array): void }).pushAudio(new TextEncoder().encode(text));
    push('one');
    push('two');

    const read = async (count: number) => {
      const relay = session.audioRelay(0);
      const out: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const next = await relay.next();
        if (next.done) break;
        out.push(new TextDecoder().decode(next.value));
      }
      await relay.return(undefined as never);
      return out;
    };

    expect(await read(2)).toEqual(['one', 'two']);
    expect(await read(2)).toEqual(['one', 'two']);
    session.stop();
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
    const store = new CaptionSessionStore({ maxSessions: 2, openSource, transcribe: async () => ({ text: '' }) });

    const [first, second] = await Promise.all([store.create(station), store.create(station)]);
    expect(store.size).toBe(1);
    expect(store.get(first.id)).toBeNull();
    expect(store.get(second.id)).toBe(second);

    store.clear();
  });

  it('reclaims orphaned sessions at the cap so surfing stations cannot lock captions out', async () => {
    // Orphan: created but never polled (its create response never reached the
    // client, e.g. the browser moved on to another station). It must not hold
    // a cap slot against a new, different station.
    let clock = 0;
    const now = () => clock;
    const openSource = async () => ({
      url: station.url,
      contentType: 'audio/mpeg',
      extension: 'mp3',
      body: new ReadableStream<Uint8Array>({ start: () => undefined }),
      cleanup: async () => undefined,
    });
    const store = new CaptionSessionStore({ maxSessions: 2, now, openSource, transcribe: async () => ({ text: '' }) });

    const orphanA = await store.create(station);
    const orphanB = await store.create({ ...station, id: 'station-2' });
    expect(store.size).toBe(2);

    clock += 6_000; // past the 5s orphan grace period, well under the stale threshold

    const fresh = await store.create({ ...station, id: 'station-3' });
    expect(store.get(orphanA.id)).toBeNull();
    expect(store.get(orphanB.id)).toBeNull();
    expect(store.get(fresh.id)).toBe(fresh);

    store.clear();
  });

  it('keeps actively polled sessions when reclaiming at the cap', async () => {
    let clock = 0;
    const now = () => clock;
    const openSource = async () => ({
      url: station.url,
      contentType: 'audio/mpeg',
      extension: 'mp3',
      body: new ReadableStream<Uint8Array>({ start: () => undefined }),
      cleanup: async () => undefined,
    });
    const store = new CaptionSessionStore({ maxSessions: 2, now, openSource, transcribe: async () => ({ text: '' }) });

    const live = await store.create(station);
    const orphan = await store.create({ ...station, id: 'station-2' });
    clock += 6_000;
    live.touch(); // an active client polls continuously

    const fresh = await store.create({ ...station, id: 'station-3' });
    expect(store.get(live.id)).toBe(live);
    expect(store.get(orphan.id)).toBeNull();
    expect(store.get(fresh.id)).toBe(fresh);

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
