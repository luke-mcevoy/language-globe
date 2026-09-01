import type { CountryStat, DailyAccuracy, StatsResponse } from '../types.js';

export interface QuizResultRow {
  created_at: string;
  country_code: string;
  country: string;
  n_questions: number;
  n_correct: number;
  transcript_words: number;
}

export const DAILY_WINDOW_DAYS = 30;
export const ACCURACY_WINDOW_DAYS = 7;

/** Local-time YYYY-MM-DD. Streaks should follow the user's day, not UTC's. */
export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function accuracyOf(correct: number, questions: number): number | null {
  return questions > 0 ? correct / questions : null;
}

/** Accuracy over the last `days` local dates (including today). */
export function accuracyForWindow(rows: QuizResultRow[], days: number, now: Date): number | null {
  const oldest = dateKey(addDays(now, -(days - 1)));
  let questions = 0;
  let correct = 0;
  for (const row of rows) {
    if (dateKey(new Date(row.created_at)) >= oldest) {
      questions += row.n_questions;
      correct += row.n_correct;
    }
  }
  return accuracyOf(correct, questions);
}

function buildDaily(rows: QuizResultRow[], now: Date): DailyAccuracy[] {
  const byDay = new Map<string, { attempts: number; questions: number; correct: number }>();
  for (const row of rows) {
    const key = dateKey(new Date(row.created_at));
    const bucket = byDay.get(key) ?? { attempts: 0, questions: 0, correct: 0 };
    bucket.attempts += 1;
    bucket.questions += row.n_questions;
    bucket.correct += row.n_correct;
    byDay.set(key, bucket);
  }

  // Emit every day in the window, including empty ones, so the chart has a
  // continuous x-axis instead of collapsing gaps.
  const daily: DailyAccuracy[] = [];
  for (let offset = DAILY_WINDOW_DAYS - 1; offset >= 0; offset--) {
    const key = dateKey(addDays(now, -offset));
    const bucket = byDay.get(key) ?? { attempts: 0, questions: 0, correct: 0 };
    daily.push({
      date: key,
      attempts: bucket.attempts,
      questions: bucket.questions,
      correct: bucket.correct,
      accuracy: accuracyOf(bucket.correct, bucket.questions),
    });
  }
  return daily;
}

function buildCountries(rows: QuizResultRow[]): CountryStat[] {
  const byCountry = new Map<string, CountryStat>();
  for (const row of rows) {
    const code = (row.country_code || '??').toUpperCase();
    const existing = byCountry.get(code) ?? {
      countryCode: code,
      country: row.country || code,
      attempts: 0,
      questions: 0,
      correct: 0,
      accuracy: 0,
    };
    existing.attempts += 1;
    existing.questions += row.n_questions;
    existing.correct += row.n_correct;
    if (!existing.country && row.country) existing.country = row.country;
    byCountry.set(code, existing);
  }

  return [...byCountry.values()]
    .map((stat) => ({ ...stat, accuracy: stat.questions > 0 ? stat.correct / stat.questions : 0 }))
    .sort((a, b) => b.attempts - a.attempts || a.country.localeCompare(b.country));
}

export interface StreakSummary {
  current: number;
  longest: number;
  lastQuizDate: string | null;
}

/**
 * A streak survives until a full day is missed: finishing yesterday but not
 * yet today still counts, so the streak doesn't appear to break every morning.
 */
export function computeStreak(rows: QuizResultRow[], now: Date): StreakSummary {
  const days = [...new Set(rows.map((row) => dateKey(new Date(row.created_at))))].sort();
  if (days.length === 0) return { current: 0, longest: 0, lastQuizDate: null };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    const previous = days[i - 1] as string;
    const expected = dateKey(addDays(new Date(`${previous}T12:00:00`), 1));
    run = days[i] === expected ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  const today = dateKey(now);
  const yesterday = dateKey(addDays(now, -1));
  const lastQuizDate = days[days.length - 1] as string;
  const current = lastQuizDate === today || lastQuizDate === yesterday ? run : 0;

  return { current, longest, lastQuizDate };
}

export function aggregateStats(rows: QuizResultRow[], now: Date = new Date()): StatsResponse {
  const questions = rows.reduce((sum, row) => sum + row.n_questions, 0);
  const correct = rows.reduce((sum, row) => sum + row.n_correct, 0);
  const wordsHeard = rows.reduce((sum, row) => sum + row.transcript_words, 0);
  const countries = buildCountries(rows);

  return {
    totals: {
      quizzes: rows.length,
      questions,
      correct,
      accuracy: accuracyOf(correct, questions),
      countriesVisited: countries.length,
      wordsHeard,
    },
    streak: computeStreak(rows, now),
    daily: buildDaily(rows, now),
    countries,
  };
}
