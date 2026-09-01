import type Database from 'better-sqlite3';
import type { AuthUser, LeaderboardEntry, ListeningNow } from '../types.js';
import { ACCURACY_WINDOW_DAYS, accuracyForWindow, aggregateStats, type QuizResultRow } from './stats.js';

type BetterDatabase = Database.Database;

export const PRESENCE_TTL_MS = 90_000;

export type SocialErrorCode = 'unknown_user' | 'cannot_follow_self';

export class SocialError extends Error {
  readonly code: SocialErrorCode;

  constructor(code: SocialErrorCode, message: string) {
    super(message);
    this.name = 'SocialError';
    this.code = code;
  }
}

export interface PresenceRecord {
  stationId: string;
  stationName: string;
  country: string;
  startedAt: string;
  lastSeenAt: string;
}

export interface PresenceStation {
  id: string;
  name: string;
  country: string;
}

export interface PresenceStore {
  heartbeat(userId: string, station: PresenceStation, now?: Date): PresenceRecord;
  stop(userId: string): boolean;
  get(userId: string, now?: Date): PresenceRecord | null;
  list(userIds: string[], now?: Date): Map<string, PresenceRecord>;
}

export interface SocialStore {
  follow(userId: string, username: string, now?: Date): AuthUser;
  unfollow(userId: string, username: string): boolean;
  following(userId: string): AuthUser[];
  findUserByUsername(username: string): AuthUser | null;
  quizRows(userId: string): QuizResultRow[];
  vocabCount(userId: string): number;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
}

interface FollowedRow {
  id: string;
  username: string;
  display_name: string;
}

function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

function toUser(row: UserRow): AuthUser {
  return { id: row.id, username: row.username, displayName: row.display_name };
}

/**
 * SQLite-backed follows. Pure over a Database instance so tests can use an
 * in-memory DB, matching the favorites / auth stores. Quiz + vocab aggregate
 * statements assume those tables already exist (db.ts creates them first).
 */
export function createSocialStore(db: BetterDatabase): SocialStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS follows (
      user_id     TEXT NOT NULL,
      followed_id TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      UNIQUE (user_id, followed_id)
    );

    CREATE INDEX IF NOT EXISTS idx_follows_user ON follows(user_id);
    CREATE INDEX IF NOT EXISTS idx_follows_followed ON follows(followed_id);
  `);

  const findByUsername = db.prepare(
    `SELECT id, username, display_name FROM users WHERE username = ? COLLATE NOCASE`,
  );
  const insertFollow = db.prepare(
    `INSERT INTO follows (user_id, followed_id, created_at)
     VALUES (@user_id, @followed_id, @created_at)
     ON CONFLICT(user_id, followed_id) DO NOTHING`,
  );
  const deleteFollow = db.prepare('DELETE FROM follows WHERE user_id = ? AND followed_id = ?');
  const listFollowing = db.prepare(
    `SELECT u.id, u.username, u.display_name
     FROM follows f
     JOIN users u ON u.id = f.followed_id
     WHERE f.user_id = ?
     ORDER BY f.created_at ASC`,
  );
  const listQuiz = db.prepare(
    `SELECT created_at, country_code, country, n_questions, n_correct, transcript_words
     FROM quiz_results WHERE user_id = ? ORDER BY created_at ASC`,
  );
  const countVocab = db.prepare('SELECT COUNT(*) AS n FROM vocab_lookups WHERE user_id = ?');

  return {
    findUserByUsername(raw) {
      const username = normalizeUsername(raw);
      if (username.length === 0) return null;
      const row = findByUsername.get(username) as UserRow | undefined;
      return row ? toUser(row) : null;
    },

    follow(userId, rawUsername, now = new Date()) {
      const target = this.findUserByUsername(rawUsername);
      if (!target) {
        throw new SocialError('unknown_user', 'No account with that username.');
      }
      if (target.id === userId) {
        throw new SocialError('cannot_follow_self', 'You cannot follow yourself.');
      }
      insertFollow.run({
        user_id: userId,
        followed_id: target.id,
        created_at: now.toISOString(),
      });
      return target;
    },

    unfollow(userId, rawUsername) {
      const target = this.findUserByUsername(rawUsername);
      if (!target) {
        throw new SocialError('unknown_user', 'No account with that username.');
      }
      return deleteFollow.run(userId, target.id).changes > 0;
    },

    following(userId) {
      return (listFollowing.all(userId) as FollowedRow[]).map(toUser);
    },

    quizRows(userId) {
      return listQuiz.all(userId) as QuizResultRow[];
    },

    vocabCount(userId) {
      return (countVocab.get(userId) as { n: number }).n;
    },
  };
}

export function buildLeaderboardEntry(
  user: AuthUser,
  rows: QuizResultRow[],
  vocabCount: number,
  listeningNow: ListeningNow | null,
  now: Date = new Date(),
): LeaderboardEntry {
  const stats = aggregateStats(rows, now);
  return {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    streakDays: stats.streak.current,
    quizCount: stats.totals.quizzes,
    accuracy7d: accuracyForWindow(rows, ACCURACY_WINDOW_DAYS, now),
    vocabCount,
    countriesCount: stats.totals.countriesVisited,
    listeningNow,
  };
}

export function sortLeaderboard(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    if (b.streakDays !== a.streakDays) return b.streakDays - a.streakDays;
    if (b.quizCount !== a.quizCount) return b.quizCount - a.quizCount;
    return a.username.localeCompare(b.username);
  });
}

export function buildLeaderboard(
  user: AuthUser,
  store: SocialStore,
  presence: PresenceStore,
  now: Date = new Date(),
): LeaderboardEntry[] {
  const seen = new Set<string>();
  const circle: AuthUser[] = [];
  for (const candidate of [user, ...store.following(user.id)]) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    circle.push(candidate);
  }

  const entries = circle.map((member) => {
    const live = presence.get(member.id, now);
    const listeningNow: ListeningNow | null = live
      ? { stationName: live.stationName, country: live.country }
      : null;
    return buildLeaderboardEntry(member, store.quizRows(member.id), store.vocabCount(member.id), listeningNow, now);
  });
  return sortLeaderboard(entries);
}

/**
 * In-memory who-is-listening map. Entries expire `PRESENCE_TTL_MS` after the
 * last heartbeat. `now` is injectable so expiry tests can use a fake clock.
 */
export function createPresenceStore(options: { now?: () => Date } = {}): PresenceStore {
  const clock = options.now ?? (() => new Date());
  const entries = new Map<string, PresenceRecord>();

  function expired(record: PresenceRecord, at: Date): boolean {
    return at.getTime() - new Date(record.lastSeenAt).getTime() >= PRESENCE_TTL_MS;
  }

  function sweep(at: Date): void {
    for (const [userId, record] of entries) {
      if (expired(record, at)) entries.delete(userId);
    }
  }

  return {
    heartbeat(userId, station, now = clock()) {
      sweep(now);
      const iso = now.toISOString();
      const existing = entries.get(userId);
      const record: PresenceRecord =
        existing && existing.stationId === station.id
          ? { ...existing, lastSeenAt: iso }
          : {
              stationId: station.id,
              stationName: station.name,
              country: station.country,
              startedAt: iso,
              lastSeenAt: iso,
            };
      entries.set(userId, record);
      return record;
    },

    stop(userId) {
      return entries.delete(userId);
    },

    get(userId, now = clock()) {
      sweep(now);
      return entries.get(userId) ?? null;
    },

    list(userIds, now = clock()) {
      sweep(now);
      const live = new Map<string, PresenceRecord>();
      for (const userId of userIds) {
        const record = entries.get(userId);
        if (record) live.set(userId, record);
      }
      return live;
    },
  };
}
