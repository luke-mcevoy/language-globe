import type Database from 'better-sqlite3';

type BetterDatabase = Database.Database;

interface TableRebuild {
  name: string;
  create: string;
  indexes: string[];
}

/**
 * When accounts landed, `users` was renamed to `users_legacy` (INTEGER ids)
 * and replaced with UUID text ids. Tables created before that still FK to
 * `users_legacy`, so inserting a real account id fails:
 * `FOREIGN KEY constraint failed`. Rebuild those tables against `users`.
 */
const REBUILDS: TableRebuild[] = [
  {
    name: 'quizzes',
    create: `CREATE TABLE quizzes__mig (
      id             TEXT PRIMARY KEY,
      user_id        TEXT NOT NULL REFERENCES users(id),
      station_id     TEXT NOT NULL,
      station_name   TEXT NOT NULL,
      country        TEXT NOT NULL DEFAULT '',
      country_code   TEXT NOT NULL DEFAULT '',
      difficulty     TEXT NOT NULL,
      transcript     TEXT NOT NULL,
      questions_json TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      submitted_at   TEXT
    )`,
    indexes: [],
  },
  {
    name: 'quiz_results',
    create: `CREATE TABLE quiz_results__mig (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id          TEXT NOT NULL REFERENCES users(id),
      quiz_id          TEXT NOT NULL REFERENCES quizzes(id),
      station_id       TEXT NOT NULL,
      station_name     TEXT NOT NULL,
      country          TEXT NOT NULL DEFAULT '',
      country_code     TEXT NOT NULL DEFAULT '',
      difficulty       TEXT NOT NULL,
      n_questions      INTEGER NOT NULL,
      n_correct        INTEGER NOT NULL,
      transcript_words INTEGER NOT NULL,
      created_at       TEXT NOT NULL
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_quiz_results_user_created
         ON quiz_results(user_id, created_at)`,
    ],
  },
  {
    name: 'favorites',
    create: `CREATE TABLE favorites__mig (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      TEXT NOT NULL REFERENCES users(id),
      station_id   TEXT NOT NULL,
      station_name TEXT NOT NULL,
      country      TEXT NOT NULL DEFAULT '',
      country_code TEXT NOT NULL DEFAULT '',
      lat          REAL NOT NULL,
      lon          REAL NOT NULL,
      kind         TEXT NOT NULL,
      url          TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      UNIQUE (user_id, station_id)
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_favorites_user_created
         ON favorites(user_id, created_at)`,
    ],
  },
  {
    name: 'vocab_lookups',
    create: `CREATE TABLE vocab_lookups__mig (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id            TEXT NOT NULL REFERENCES users(id),
      word_key           TEXT NOT NULL,
      word               TEXT NOT NULL,
      translation        TEXT NOT NULL,
      note               TEXT NOT NULL DEFAULT '',
      context            TEXT NOT NULL DEFAULT '',
      station_name       TEXT NOT NULL DEFAULT '',
      times_looked_up    INTEGER NOT NULL DEFAULT 1,
      created_at         TEXT NOT NULL,
      last_looked_up_at  TEXT NOT NULL,
      UNIQUE (user_id, word_key)
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_vocab_user_last
         ON vocab_lookups(user_id, last_looked_up_at)`,
    ],
  },
];

function needsRebuild(sql: string | undefined): boolean {
  if (!sql) return false;
  return /users_legacy/i.test(sql) || /user_id\s+INTEGER/i.test(sql);
}

export function migrateLegacyUserForeignKeys(db: BetterDatabase): void {
  const pending = REBUILDS.filter((rebuild) => {
    const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(rebuild.name) as
      | { sql: string }
      | undefined;
    return needsRebuild(row?.sql);
  });
  if (pending.length === 0) return;

  db.pragma('foreign_keys = OFF');
  const tx = db.transaction(() => {
    for (const rebuild of pending) {
      const cols = (
        db.prepare(`PRAGMA table_info(${rebuild.name})`).all() as Array<{ name: string }>
      ).map((col) => col.name);
      if (cols.length === 0) continue;
      db.exec(rebuild.create);
      const list = cols.join(', ');
      db.exec(
        `INSERT INTO ${rebuild.name}__mig (${list})
         SELECT ${list} FROM ${rebuild.name}
         WHERE CAST(user_id AS TEXT) IN (SELECT id FROM users)`,
      );
      db.exec(`DROP TABLE ${rebuild.name}`);
      db.exec(`ALTER TABLE ${rebuild.name}__mig RENAME TO ${rebuild.name}`);
      for (const index of rebuild.indexes) db.exec(index);
    }
  });
  tx();
  db.pragma('foreign_keys = ON');
}
