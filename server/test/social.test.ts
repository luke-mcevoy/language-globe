import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthStore, type AuthStore } from '../src/lib/auth.js';
import {
  PRESENCE_TTL_MS,
  SocialError,
  buildLeaderboard,
  createPresenceStore,
  createSocialStore,
  type PresenceStore,
  type SocialStore,
} from '../src/lib/social.js';
import { createVocabStore, type VocabStore } from '../src/lib/vocab.js';
import type { AuthUser } from '../src/types.js';

function openSocialDb(): {
  db: Database.Database;
  auth: AuthStore;
  social: SocialStore;
  vocab: VocabStore;
} {
  const db = new Database(':memory:');
  const auth = createAuthStore(db);
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
  const vocab = createVocabStore(db);
  const social = createSocialStore(db);
  return { db, auth, social, vocab };
}

function signup(auth: AuthStore, username: string, displayName?: string): AuthUser {
  return auth.signup({ username, password: 'password1', displayName }).user;
}

function insertResult(
  db: Database.Database,
  userId: string,
  overrides: { daysAgo?: number; country?: string; countryCode?: string; nQuestions?: number; nCorrect?: number } = {},
): void {
  const now = new Date(2026, 7, 31, 18, 0, 0);
  const created = new Date(now);
  created.setDate(created.getDate() - (overrides.daysAgo ?? 0));
  db.prepare(
    `INSERT INTO quiz_results
       (user_id, quiz_id, station_id, station_name, country, country_code, difficulty,
        n_questions, n_correct, transcript_words, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    userId,
    `quiz-${Math.random().toString(16).slice(2)}`,
    'station-1',
    'Radio Nacional',
    overrides.country ?? 'Spain',
    overrides.countryCode ?? 'ES',
    'beginner',
    overrides.nQuestions ?? 4,
    overrides.nCorrect ?? 3,
    120,
    created.toISOString(),
  );
}

describe('socialStore', () => {
  let db: Database.Database;
  let auth: AuthStore;
  let social: SocialStore;

  beforeEach(() => {
    ({ db, auth, social } = openSocialDb());
  });

  afterEach(() => db.close());

  it('follows and unfollows by exact username and lists following', () => {
    const alice = signup(auth, 'alice', 'Alice');
    const bob = signup(auth, 'bob', 'Bob');

    expect(social.following(alice.id)).toEqual([]);
    expect(social.follow(alice.id, 'Bob')).toEqual(bob);
    expect(social.following(alice.id)).toEqual([bob]);

    expect(social.unfollow(alice.id, 'bob')).toBe(true);
    expect(social.following(alice.id)).toEqual([]);
    expect(social.unfollow(alice.id, 'bob')).toBe(false);
  });

  it('is idempotent on a second follow of the same user', () => {
    const alice = signup(auth, 'alice');
    const bob = signup(auth, 'bob', 'Bob');
    social.follow(alice.id, 'bob', new Date('2026-08-01T00:00:00.000Z'));
    social.follow(alice.id, 'BOB', new Date('2026-08-31T00:00:00.000Z'));
    expect(social.following(alice.id)).toEqual([bob]);
  });

  it('scopes following to the follower and rejects unknown or self', () => {
    const alice = signup(auth, 'alice');
    const bob = signup(auth, 'bob');
    const carol = signup(auth, 'carol');

    social.follow(alice.id, 'bob');
    expect(social.following(carol.id)).toEqual([]);
    expect(social.following(alice.id).map((user) => user.id)).toEqual([bob.id]);

    try {
      social.follow(alice.id, 'nobody');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SocialError);
      expect((error as SocialError).code).toBe('unknown_user');
    }

    try {
      social.follow(alice.id, 'alice');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SocialError);
      expect((error as SocialError).code).toBe('cannot_follow_self');
    }
  });
});

describe('presenceStore', () => {
  it('expires a heartbeat after 90s on a fake clock', () => {
    let now = new Date('2026-08-31T12:00:00.000Z');
    const presence: PresenceStore = createPresenceStore({ now: () => now });
    const station = { id: 'st1', name: 'Radio Nacional', country: 'Spain' };

    presence.heartbeat('alice', station);
    expect(presence.get('alice')).toMatchObject({
      stationId: 'st1',
      stationName: 'Radio Nacional',
      country: 'Spain',
    });

    now = new Date(now.getTime() + PRESENCE_TTL_MS - 1);
    expect(presence.get('alice')).not.toBeNull();

    now = new Date(now.getTime() + 2);
    expect(presence.get('alice')).toBeNull();
    expect(presence.list(['alice']).size).toBe(0);
  });

  it('keeps startedAt across heartbeats on the same station and resets on change', () => {
    let now = new Date('2026-08-31T12:00:00.000Z');
    const presence = createPresenceStore({ now: () => now });

    const first = presence.heartbeat('alice', { id: 'st1', name: 'One', country: 'Spain' });
    now = new Date(now.getTime() + 30_000);
    const again = presence.heartbeat('alice', { id: 'st1', name: 'One', country: 'Spain' });
    expect(again.startedAt).toBe(first.startedAt);
    expect(again.lastSeenAt).not.toBe(first.lastSeenAt);

    now = new Date(now.getTime() + 30_000);
    const switched = presence.heartbeat('alice', { id: 'st2', name: 'Two', country: 'Mexico' });
    expect(switched.startedAt).toBe(now.toISOString());
    expect(switched.stationName).toBe('Two');
  });

  it('stop removes the entry immediately', () => {
    const presence = createPresenceStore();
    presence.heartbeat('alice', { id: 'st1', name: 'One', country: 'Spain' });
    expect(presence.stop('alice')).toBe(true);
    expect(presence.get('alice')).toBeNull();
    expect(presence.stop('alice')).toBe(false);
  });
});

describe('leaderboard', () => {
  let db: Database.Database;
  let auth: AuthStore;
  let social: SocialStore;
  let vocab: VocabStore;

  beforeEach(() => {
    ({ db, auth, social, vocab } = openSocialDb());
  });

  afterEach(() => db.close());

  it('aggregates streak, quiz count, 7d accuracy, vocab, countries, and live listening', () => {
    const now = new Date(2026, 7, 31, 18, 0, 0);
    const alice = signup(auth, 'alice', 'Alice');
    const bob = signup(auth, 'bob', 'Bob');
    social.follow(alice.id, 'bob');

    insertResult(db, alice.id, { daysAgo: 0, nQuestions: 4, nCorrect: 2 });
    insertResult(db, alice.id, { daysAgo: 1, nQuestions: 4, nCorrect: 4, country: 'Mexico', countryCode: 'MX' });
    insertResult(db, bob.id, { daysAgo: 0, nQuestions: 4, nCorrect: 4 });
    insertResult(db, bob.id, { daysAgo: 1, nQuestions: 4, nCorrect: 4 });
    insertResult(db, bob.id, { daysAgo: 10, nQuestions: 4, nCorrect: 0 });

    vocab.record({
      userId: alice.id,
      word: 'hola',
      translation: 'hello',
      note: '',
      context: '',
      stationName: 'Radio Nacional',
    });

    const presence = createPresenceStore({ now: () => now });
    presence.heartbeat(bob.id, { id: 'st1', name: 'Radio Nacional', country: 'Spain' });

    const entries = buildLeaderboard(alice, social, presence, now);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      userId: bob.id,
      username: 'bob',
      displayName: 'Bob',
      streakDays: 2,
      quizCount: 3,
      accuracy7d: 1,
      vocabCount: 0,
      countriesCount: 1,
      listeningNow: { stationName: 'Radio Nacional', country: 'Spain' },
    });
    expect(entries[1]).toMatchObject({
      userId: alice.id,
      username: 'alice',
      displayName: 'Alice',
      streakDays: 2,
      quizCount: 2,
      accuracy7d: 6 / 8,
      vocabCount: 1,
      countriesCount: 2,
      listeningNow: null,
    });
  });
});
