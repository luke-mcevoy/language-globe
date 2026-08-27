import type Database from 'better-sqlite3';

type BetterDatabase = Database.Database;

export interface VocabRecord {
  id: number;
  word: string;
  translation: string;
  note: string;
  context: string;
  station_name: string;
  times_looked_up: number;
  created_at: string;
  last_looked_up_at: string;
}

export interface VocabInput {
  userId: number;
  word: string;
  translation: string;
  note: string;
  context: string;
  stationName: string;
  now?: Date;
}

export interface VocabStore {
  record(input: VocabInput): VocabRecord;
  list(userId: number, limit?: number): VocabRecord[];
  remove(userId: number, id: number): boolean;
}

/**
 * Canonical form used to deduplicate lookups: lowercase, surrounding
 * punctuation stripped ("¡Sacude!" and "sacude" are the same vocab entry).
 * Inner punctuation stays so contractions/hyphenations keep their identity.
 */
export function normalizeWord(raw: string): string {
  return raw
    .replace(/^[\s\p{P}\p{S}]+/u, '')
    .replace(/[\s\p{P}\p{S}]+$/u, '')
    .toLowerCase();
}

/**
 * SQLite-backed "words I didn't know" store. Pure over a Database instance so
 * tests can use an in-memory DB, matching the favorites store.
 */
export function createVocabStore(db: BetterDatabase): VocabStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vocab_lookups (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id            INTEGER NOT NULL REFERENCES users(id),
      word_key           TEXT    NOT NULL,
      word               TEXT    NOT NULL,
      translation        TEXT    NOT NULL,
      note               TEXT    NOT NULL DEFAULT '',
      context            TEXT    NOT NULL DEFAULT '',
      station_name       TEXT    NOT NULL DEFAULT '',
      times_looked_up    INTEGER NOT NULL DEFAULT 1,
      created_at         TEXT    NOT NULL,
      last_looked_up_at  TEXT    NOT NULL,
      UNIQUE (user_id, word_key)
    );

    CREATE INDEX IF NOT EXISTS idx_vocab_user_last
      ON vocab_lookups(user_id, last_looked_up_at);
  `);

  // Looking a word up again bumps the counter and refreshes the context and
  // translation (the newest sentence is the one the learner just heard), but
  // keeps created_at so "when did I first meet this word" survives.
  const upsertStmt = db.prepare(
    `INSERT INTO vocab_lookups
       (user_id, word_key, word, translation, note, context, station_name, times_looked_up, created_at, last_looked_up_at)
     VALUES (@user_id, @word_key, @word, @translation, @note, @context, @station_name, 1, @now, @now)
     ON CONFLICT(user_id, word_key) DO UPDATE SET
       times_looked_up   = times_looked_up + 1,
       translation       = excluded.translation,
       note              = excluded.note,
       context           = excluded.context,
       station_name      = excluded.station_name,
       last_looked_up_at = excluded.last_looked_up_at
     RETURNING id, word, translation, note, context, station_name, times_looked_up, created_at, last_looked_up_at`,
  );

  const listStmt = db.prepare(
    `SELECT id, word, translation, note, context, station_name, times_looked_up, created_at, last_looked_up_at
     FROM vocab_lookups WHERE user_id = ? ORDER BY last_looked_up_at DESC, id DESC LIMIT ?`,
  );

  const removeStmt = db.prepare('DELETE FROM vocab_lookups WHERE user_id = ? AND id = ?');

  return {
    record({ userId, word, translation, note, context, stationName, now = new Date() }) {
      return upsertStmt.get({
        user_id: userId,
        word_key: normalizeWord(word),
        word: word.trim(),
        translation,
        note,
        context,
        station_name: stationName,
        now: now.toISOString(),
      }) as VocabRecord;
    },
    list(userId, limit = 200) {
      return listStmt.all(userId, limit) as VocabRecord[];
    },
    remove(userId, id) {
      return removeStmt.run(userId, id).changes > 0;
    },
  };
}
