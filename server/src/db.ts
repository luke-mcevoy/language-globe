import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { createAuthStore } from './lib/auth.js';
import { createFavoritesStore } from './lib/favorites.js';
import { createVocabStore } from './lib/vocab.js';
import type { Difficulty, QuizQuestion } from './types.js';
import type { QuizResultRow } from './lib/stats.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

/**
 * Accounts own the `users` table (uuid ids + credentials). Existing
 * single-user progress rows stay on whatever user_id they already have;
 * new accounts start empty.
 */
export const authStore = createAuthStore(db);

db.exec(`
  CREATE TABLE IF NOT EXISTS quizzes (
    id             TEXT PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    station_id     TEXT NOT NULL,
    station_name   TEXT NOT NULL,
    country        TEXT NOT NULL DEFAULT '',
    country_code   TEXT NOT NULL DEFAULT '',
    difficulty     TEXT NOT NULL,
    transcript     TEXT NOT NULL,
    questions_json TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    submitted_at   TEXT
  );

  CREATE TABLE IF NOT EXISTS quiz_results (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id),
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
  );

  CREATE INDEX IF NOT EXISTS idx_quiz_results_user_created
    ON quiz_results(user_id, created_at);

  CREATE TABLE IF NOT EXISTS stations_cache (
    key        TEXT PRIMARY KEY,
    payload    TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
`);

/**
 * Favorites live in the same DB, but the table + statements are created inside
 * the store so the same code can be pointed at an in-memory DB in tests.
 */
export const favoritesStore = createFavoritesStore(db);

/** "Words I didn't know" — caption word lookups, same store pattern. */
export const vocabStore = createVocabStore(db);

export interface StoredQuiz {
  id: string;
  station_id: string;
  station_name: string;
  country: string;
  country_code: string;
  difficulty: Difficulty;
  transcript: string;
  questions_json: string;
  submitted_at: string | null;
}

export interface NewQuiz {
  id: string;
  stationId: string;
  stationName: string;
  country: string;
  countryCode: string;
  difficulty: Difficulty;
  transcript: string;
  questions: QuizQuestion[];
}

export function insertQuiz(userId: string, quiz: NewQuiz): void {
  db.prepare(
    `INSERT INTO quizzes
       (id, user_id, station_id, station_name, country, country_code, difficulty, transcript, questions_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    quiz.id,
    userId,
    quiz.stationId,
    quiz.stationName,
    quiz.country,
    quiz.countryCode,
    quiz.difficulty,
    quiz.transcript,
    JSON.stringify(quiz.questions),
    new Date().toISOString(),
  );
}

export function getQuiz(userId: string, quizId: string): StoredQuiz | undefined {
  return db.prepare('SELECT * FROM quizzes WHERE id = ? AND user_id = ?').get(quizId, userId) as
    | StoredQuiz
    | undefined;
}

export interface RecordedResult {
  quizId: string;
  stationId: string;
  stationName: string;
  country: string;
  countryCode: string;
  difficulty: Difficulty;
  nQuestions: number;
  nCorrect: number;
  transcriptWords: number;
}

/**
 * Records a graded attempt. Re-submitting the same quiz overwrites the earlier
 * result rather than inflating the stats with a second attempt.
 */
export function recordResult(userId: string, result: RecordedResult): void {
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM quiz_results WHERE quiz_id = ? AND user_id = ?').run(result.quizId, userId);
    db.prepare(
      `INSERT INTO quiz_results
         (user_id, quiz_id, station_id, station_name, country, country_code, difficulty,
          n_questions, n_correct, transcript_words, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      userId,
      result.quizId,
      result.stationId,
      result.stationName,
      result.country,
      result.countryCode,
      result.difficulty,
      result.nQuestions,
      result.nCorrect,
      result.transcriptWords,
      now,
    );
    db.prepare('UPDATE quizzes SET submitted_at = ? WHERE id = ?').run(now, result.quizId);
  });
  tx();
}

export function listResults(userId: string): QuizResultRow[] {
  return db
    .prepare(
      `SELECT created_at, country_code, country, n_questions, n_correct, transcript_words
       FROM quiz_results WHERE user_id = ? ORDER BY created_at ASC`,
    )
    .all(userId) as QuizResultRow[];
}

export function readStationsCache(key: string): { payload: string; fetchedAt: number } | null {
  const row = db.prepare('SELECT payload, fetched_at FROM stations_cache WHERE key = ?').get(key) as
    | { payload: string; fetched_at: number }
    | undefined;
  return row ? { payload: row.payload, fetchedAt: row.fetched_at } : null;
}

export function writeStationsCache(key: string, payload: string, fetchedAt: number): void {
  db.prepare(
    `INSERT INTO stations_cache (key, payload, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
  ).run(key, payload, fetchedAt);
}
