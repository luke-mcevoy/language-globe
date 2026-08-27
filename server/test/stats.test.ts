import { describe, expect, it } from 'vitest';
import { DAILY_WINDOW_DAYS, aggregateStats, computeStreak, dateKey } from '../src/lib/stats.js';
import type { QuizResultRow } from '../src/lib/stats.js';

const NOW = new Date(2026, 7, 26, 18, 0, 0); // 2026-08-26, local time

/** Builds a row `daysAgo` before NOW, in local time so the test is TZ-agnostic. */
function row(daysAgo: number, overrides: Partial<QuizResultRow> = {}): QuizResultRow {
  const date = new Date(NOW);
  date.setDate(date.getDate() - daysAgo);
  return {
    created_at: date.toISOString(),
    country_code: 'ES',
    country: 'Spain',
    n_questions: 4,
    n_correct: 3,
    transcript_words: 120,
    ...overrides,
  };
}

describe('aggregateStats', () => {
  it('returns an empty-but-shaped payload with no history', () => {
    const stats = aggregateStats([], NOW);
    expect(stats.totals).toEqual({
      quizzes: 0,
      questions: 0,
      correct: 0,
      accuracy: null,
      countriesVisited: 0,
      wordsHeard: 0,
    });
    expect(stats.countries).toEqual([]);
    expect(stats.daily).toHaveLength(DAILY_WINDOW_DAYS);
    expect(stats.daily.every((day) => day.accuracy === null)).toBe(true);
  });

  it('totals questions, correct answers, words and countries', () => {
    const stats = aggregateStats(
      [
        row(0),
        row(1, { n_correct: 1 }),
        row(2, { country_code: 'MX', country: 'Mexico', n_correct: 4, transcript_words: 200 }),
      ],
      NOW,
    );
    expect(stats.totals.quizzes).toBe(3);
    expect(stats.totals.questions).toBe(12);
    expect(stats.totals.correct).toBe(8);
    expect(stats.totals.accuracy).toBeCloseTo(8 / 12);
    expect(stats.totals.countriesVisited).toBe(2);
    expect(stats.totals.wordsHeard).toBe(440);
  });

  it('buckets the daily series by local day and fills gaps', () => {
    const stats = aggregateStats([row(0), row(0, { n_correct: 4 }), row(3)], NOW);

    const today = stats.daily.at(-1);
    expect(today?.date).toBe(dateKey(NOW));
    expect(today?.attempts).toBe(2);
    expect(today?.questions).toBe(8);
    expect(today?.correct).toBe(7);
    expect(today?.accuracy).toBeCloseTo(7 / 8);

    const yesterday = stats.daily.at(-2);
    expect(yesterday?.attempts).toBe(0);
    expect(yesterday?.accuracy).toBeNull();
  });

  it('leaves rows older than the window out of the daily series but in the totals', () => {
    const stats = aggregateStats([row(45)], NOW);
    expect(stats.daily.every((day) => day.attempts === 0)).toBe(true);
    expect(stats.totals.quizzes).toBe(1);
  });

  it('ranks countries by attempts and computes per-country accuracy', () => {
    const stats = aggregateStats(
      [
        row(0, { country_code: 'ar', country: 'Argentina', n_correct: 2 }),
        row(1, { country_code: 'AR', country: 'Argentina', n_correct: 4 }),
        row(2, { country_code: 'ES', country: 'Spain', n_correct: 1 }),
      ],
      NOW,
    );

    expect(stats.countries).toHaveLength(2);
    expect(stats.countries[0]?.countryCode).toBe('AR');
    expect(stats.countries[0]?.attempts).toBe(2);
    expect(stats.countries[0]?.accuracy).toBeCloseTo(6 / 8);
    expect(stats.countries[1]?.accuracy).toBeCloseTo(1 / 4);
  });
});

describe('computeStreak', () => {
  it('is zero with no history', () => {
    expect(computeStreak([], NOW)).toEqual({ current: 0, longest: 0, lastQuizDate: null });
  });

  it('counts consecutive days ending today', () => {
    const streak = computeStreak([row(0), row(1), row(2)], NOW);
    expect(streak.current).toBe(3);
    expect(streak.longest).toBe(3);
    expect(streak.lastQuizDate).toBe(dateKey(NOW));
  });

  it('survives a day that is not over yet', () => {
    expect(computeStreak([row(1), row(2)], NOW).current).toBe(2);
  });

  it('breaks once a full day is missed', () => {
    expect(computeStreak([row(2), row(3)], NOW).current).toBe(0);
  });

  it('does not double-count several quizzes on the same day', () => {
    expect(computeStreak([row(0), row(0), row(1)], NOW).current).toBe(2);
  });

  it('remembers the longest run even after it breaks', () => {
    const streak = computeStreak([row(10), row(9), row(8), row(7), row(0)], NOW);
    expect(streak.longest).toBe(4);
    expect(streak.current).toBe(1);
  });
});
