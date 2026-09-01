import cookie from '@fastify/cookie';
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthStore } from '../src/lib/auth.js';
import { PRESENCE_TTL_MS, createPresenceStore, createSocialStore } from '../src/lib/social.js';
import { createVocabStore } from '../src/lib/vocab.js';
import { registerAuthRoutes } from '../src/routes/auth.js';
import { registerSocialRoutes } from '../src/routes/social.js';
import type { Station } from '../src/types.js';

const station: Station = {
  id: 'station-1',
  name: 'Radio Nacional',
  url: 'https://example.com/stream.mp3',
  homepage: '',
  favicon: '',
  tags: ['news'],
  country: 'Spain',
  countryCode: 'ES',
  state: '',
  language: 'spanish',
  lat: 40.4,
  lon: -3.7,
  clickcount: 100,
  votes: 20,
  codec: 'MP3',
  bitrate: 128,
  kind: 'talk',
  reachable: true,
};

function cookieFrom(response: { headers: { 'set-cookie'?: string | string[] } }): string {
  const raw = response.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return first?.split(';')[0] ?? '';
}

async function signup(app: FastifyInstance, username: string, displayName?: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: { username, password: 'password1', displayName },
  });
  expect(response.statusCode).toBe(201);
  return cookieFrom(response);
}

async function buildApp(now?: () => Date): Promise<FastifyInstance> {
  const db = new Database(':memory:');
  const authStore = createAuthStore(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS quiz_results (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id          TEXT NOT NULL,
      quiz_id          TEXT NOT NULL,
      station_id       TEXT NOT NULL,
      station_name     TEXT NOT NULL,
      country          TEXT NOT NULL DEFAULT '',
      country_code     TEXT NOT NULL DEFAULT '',
      difficulty       TEXT NOT NULL,
      n_questions      INTEGER NOT NULL,
      n_correct        INTEGER NOT NULL,
      transcript_words INTEGER NOT NULL,
      created_at       TEXT NOT NULL
    );
  `);
  createVocabStore(db);

  const app = Fastify({ logger: false });
  await app.register(cookie);
  app.decorate('authStore', authStore);
  app.decorate('socialStore', createSocialStore(db));
  app.decorate('presenceStore', createPresenceStore(now ? { now } : {}));
  await registerAuthRoutes(app);
  await registerSocialRoutes(app, {
    findStation: async (stationId) => (stationId === station.id ? station : undefined),
    getStations: async () => ({ stations: [station] }),
  });
  await app.ready();
  return app;
}

describe('social routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 on social endpoints when anonymous', async () => {
    for (const request of [
      { method: 'GET' as const, url: '/api/social/leaderboard' },
      { method: 'GET' as const, url: '/api/social/friends-listening' },
      { method: 'POST' as const, url: '/api/social/follow', payload: { username: 'bob' } },
      { method: 'DELETE' as const, url: '/api/social/follow/bob' },
      { method: 'POST' as const, url: '/api/social/presence', payload: { stationId: station.id } },
      { method: 'DELETE' as const, url: '/api/social/presence' },
    ]) {
      const response = await app.inject(request);
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'account_required' });
    }
  });

  it('follows by username, shapes the leaderboard, then unfollows', async () => {
    const aliceCookie = await signup(app, 'alice', 'Alice');
    await signup(app, 'bob', 'Bob');

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/social/follow',
      headers: { cookie: aliceCookie },
      payload: { username: 'nobody' },
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ error: 'unknown_user' });

    const self = await app.inject({
      method: 'POST',
      url: '/api/social/follow',
      headers: { cookie: aliceCookie },
      payload: { username: 'alice' },
    });
    expect(self.statusCode).toBe(400);
    expect(self.json()).toMatchObject({ error: 'cannot_follow_self' });

    const follow = await app.inject({
      method: 'POST',
      url: '/api/social/follow',
      headers: { cookie: aliceCookie },
      payload: { username: 'bob' },
    });
    expect(follow.statusCode).toBe(204);

    const board = await app.inject({
      method: 'GET',
      url: '/api/social/leaderboard',
      headers: { cookie: aliceCookie },
    });
    expect(board.statusCode).toBe(200);
    expect(board.json()).toEqual({
      entries: [
        {
          userId: expect.any(String),
          username: 'alice',
          displayName: 'Alice',
          streakDays: 0,
          quizCount: 0,
          accuracy7d: null,
          vocabCount: 0,
          countriesCount: 0,
          listeningNow: null,
        },
        {
          userId: expect.any(String),
          username: 'bob',
          displayName: 'Bob',
          streakDays: 0,
          quizCount: 0,
          accuracy7d: null,
          vocabCount: 0,
          countriesCount: 0,
          listeningNow: null,
        },
      ],
    });

    const unfollow = await app.inject({
      method: 'DELETE',
      url: '/api/social/follow/bob',
      headers: { cookie: aliceCookie },
    });
    expect(unfollow.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: '/api/social/leaderboard',
      headers: { cookie: aliceCookie },
    });
    expect(after.json().entries).toHaveLength(1);
    expect(after.json().entries[0].username).toBe('alice');
  });

  it('records presence and lists followed listeners with station geo', async () => {
    const aliceCookie = await signup(app, 'alice', 'Alice');
    const bobCookie = await signup(app, 'bob', 'Bob');

    await app.inject({
      method: 'POST',
      url: '/api/social/follow',
      headers: { cookie: aliceCookie },
      payload: { username: 'bob' },
    });

    const missing = await app.inject({
      method: 'POST',
      url: '/api/social/presence',
      headers: { cookie: bobCookie },
      payload: { stationId: 'missing' },
    });
    expect(missing.statusCode).toBe(404);

    const beat = await app.inject({
      method: 'POST',
      url: '/api/social/presence',
      headers: { cookie: bobCookie },
      payload: { stationId: station.id },
    });
    expect(beat.statusCode).toBe(204);

    const listening = await app.inject({
      method: 'GET',
      url: '/api/social/friends-listening',
      headers: { cookie: aliceCookie },
    });
    expect(listening.statusCode).toBe(200);
    expect(listening.json()).toEqual({
      friends: [
        {
          userId: expect.any(String),
          username: 'bob',
          displayName: 'Bob',
          stationId: station.id,
          stationName: station.name,
          country: station.country,
          lat: station.lat,
          lon: station.lon,
          startedAt: expect.any(String),
        },
      ],
    });

    const board = await app.inject({
      method: 'GET',
      url: '/api/social/leaderboard',
      headers: { cookie: aliceCookie },
    });
    const bobRow = board.json().entries.find((row: { username: string }) => row.username === 'bob');
    expect(bobRow.listeningNow).toEqual({ stationName: station.name, country: station.country });

    const stop = await app.inject({
      method: 'DELETE',
      url: '/api/social/presence',
      headers: { cookie: bobCookie },
    });
    expect(stop.statusCode).toBe(204);

    const afterStop = await app.inject({
      method: 'GET',
      url: '/api/social/friends-listening',
      headers: { cookie: aliceCookie },
    });
    expect(afterStop.json()).toEqual({ friends: [] });
  });
});

describe('social presence expiry (route + fake clock)', () => {
  it('drops a friend pin once the heartbeat is 90s stale', async () => {
    let now = new Date('2026-08-31T12:00:00.000Z');
    const app = await buildApp(() => now);
    try {
      const aliceCookie = await signup(app, 'alice');
      const bobCookie = await signup(app, 'bob');
      await app.inject({
        method: 'POST',
        url: '/api/social/follow',
        headers: { cookie: aliceCookie },
        payload: { username: 'bob' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/social/presence',
        headers: { cookie: bobCookie },
        payload: { stationId: station.id },
      });

      now = new Date(now.getTime() + PRESENCE_TTL_MS - 1);
      const stillLive = await app.inject({
        method: 'GET',
        url: '/api/social/friends-listening',
        headers: { cookie: aliceCookie },
      });
      expect(stillLive.json().friends).toHaveLength(1);

      now = new Date(now.getTime() + 2);
      const expired = await app.inject({
        method: 'GET',
        url: '/api/social/friends-listening',
        headers: { cookie: aliceCookie },
      });
      expect(expired.json()).toEqual({ friends: [] });
    } finally {
      await app.close();
    }
  });
});
