import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import { getVocab, removeVocabWord } from '../api';
import { flagEmoji, formatCompact, formatPercent, shortDate } from '../lib/format';
import type { StatsResponse, VocabEntry } from '../types';

interface StatsPanelProps {
  stats: StatsResponse | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

const ACCENT = '#54e6c3';
const INK_MUTED = '#7f8ba6';
const GRID = 'rgba(255, 255, 255, 0.07)';

export function StatsPanel({ stats, loading, error, onClose }: StatsPanelProps) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Your progress">
      <button type="button" className="modal__scrim" onClick={onClose} aria-label="Close progress" />
      <section className="modal__panel glass">
        <header className="modal__header">
          <div>
            <p className="modal__eyebrow">Your progress</p>
            <h2 className="modal__title">Listening passport</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {loading && (
          <div className="modal__center">
            <span className="spinner spinner--lg" />
            <p>Reading your history…</p>
          </div>
        )}

        {error && !loading && (
          <div className="modal__center">
            <p className="quiz__error-title">Could not load your stats</p>
            <p className="quiz__error-message">{error}</p>
          </div>
        )}

        {stats && !loading && !error && <StatsBody stats={stats} />}
      </section>
    </div>
  );
}

/**
 * "Words I didn't know" — every caption word the user clicked for a
 * translation, newest lookups first. Self-contained fetch so the section
 * works regardless of quiz history.
 */
function VocabSection() {
  const [words, setWords] = useState<VocabEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVocab()
      .then((response) => {
        if (!cancelled) setWords(response.words);
      })
      .catch(() => {
        if (!cancelled) setWords([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const remove = (id: number) => {
    setWords((current) => current?.filter((entry) => entry.id !== id) ?? null);
    void removeVocabWord(id).catch(() => undefined);
  };

  if (!words || words.length === 0) return null;

  return (
    <section className="stats__section vocab">
      <div className="stats__section-head">
        <h3>Words you looked up</h3>
        <span className="stats__section-note">
          {words.length} {words.length === 1 ? 'word' : 'words'} · click a caption word to add more
        </span>
      </div>
      <ul className="vocab__list">
        {words.map((entry) => (
          <li className="vocab__row" key={entry.id} title={entry.context ? `“${entry.context}”` : undefined}>
            <span className="vocab__word">{entry.word}</span>
            <span className="vocab__translation">
              {entry.translation}
              {entry.note ? <span className="vocab__note"> — {entry.note}</span> : null}
            </span>
            {entry.timesLookedUp > 1 && <span className="vocab__count">{entry.timesLookedUp}×</span>}
            <button
              type="button"
              className="vocab__remove"
              onClick={() => remove(entry.id)}
              aria-label={`Remove ${entry.word} from your vocab list`}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatsBody({ stats }: { stats: StatsResponse }) {
  const chartData = useMemo(
    () =>
      stats.daily.map((day) => ({
        date: day.date,
        label: shortDate(day.date),
        accuracy: day.accuracy === null ? null : Math.round(day.accuracy * 100),
        attempts: day.attempts,
        questions: day.questions,
        correct: day.correct,
      })),
    [stats.daily],
  );

  const hasHistory = stats.totals.quizzes > 0;
  const daysWithData = chartData.filter((day) => day.accuracy !== null).length;

  if (!hasHistory) {
    return (
      <div className="stats">
        <div className="modal__center modal__empty">
          <div className="quiz__key-icon" aria-hidden="true">
            🧭
          </div>
          <p className="quiz__error-title">No quizzes yet</p>
          <p className="quiz__error-message">
            Tune into a talk station, hit <strong>Quiz me</strong>, and your accuracy, streak and country
            passport will start filling in here.
          </p>
        </div>
        <VocabSection />
      </div>
    );
  }

  return (
    <div className="stats">
      <div className="stats__tiles">
        <Tile label="Quizzes" value={String(stats.totals.quizzes)} />
        <Tile label="Overall accuracy" value={formatPercent(stats.totals.accuracy)} />
        <Tile
          label="Current streak"
          value={`${stats.streak.current}d`}
          hint={stats.streak.longest > stats.streak.current ? `best ${stats.streak.longest}d` : 'personal best'}
        />
        <Tile label="Countries" value={String(stats.totals.countriesVisited)} />
        <Tile label="Words heard" value={formatCompact(stats.totals.wordsHeard)} />
      </div>

      <section className="stats__section">
        <div className="stats__section-head">
          <h3>Accuracy, last 30 days</h3>
          <span className="stats__section-note">
            {daysWithData} {daysWithData === 1 ? 'day' : 'days'} with a quiz
          </span>
        </div>
        <div className="stats__chart">
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis
                dataKey="label"
                interval={6}
                tickLine={false}
                axisLine={{ stroke: GRID }}
                tick={{ fill: INK_MUTED, fontSize: 11 }}
              />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(value: number) => `${value}%`}
                tickLine={false}
                axisLine={false}
                tick={{ fill: INK_MUTED, fontSize: 11 }}
                width={52}
              />
              <Tooltip
                content={(props) => <AccuracyTooltip {...props} />}
                cursor={{ stroke: 'rgba(255,255,255,0.22)', strokeWidth: 1 }}
              />
              <Line
                type="monotone"
                dataKey="accuracy"
                stroke={ACCENT}
                strokeWidth={2}
                connectNulls
                dot={{ r: 3, fill: ACCENT, stroke: 'transparent' }}
                activeDot={{ r: 5, fill: ACCENT, stroke: '#0a0f1c', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="stats__section">
        <div className="stats__section-head">
          <h3>Passport</h3>
          <span className="stats__section-note">{stats.countries.length} stamped</span>
        </div>
        <ul className="passport">
          {stats.countries.map((country) => (
            <li className="passport__stamp" key={country.countryCode} title={country.country}>
              <span className="passport__flag" aria-hidden="true">
                {flagEmoji(country.countryCode)}
              </span>
              <span className="passport__code">{country.countryCode}</span>
              <span className="passport__count">
                {country.attempts} {country.attempts === 1 ? 'quiz' : 'quizzes'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="stats__section">
        <div className="stats__section-head">
          <h3>By country</h3>
        </div>
        <table className="stats__table">
          <thead>
            <tr>
              <th scope="col">Country</th>
              <th scope="col">Quizzes</th>
              <th scope="col">Questions</th>
              <th scope="col">Accuracy</th>
            </tr>
          </thead>
          <tbody>
            {stats.countries.map((country) => (
              <tr key={country.countryCode}>
                <th scope="row">
                  <span aria-hidden="true">{flagEmoji(country.countryCode)}</span> {country.country}
                </th>
                <td>{country.attempts}</td>
                <td>{country.questions}</td>
                <td>
                  <span className="stats__bar" aria-hidden="true">
                    <span className="stats__bar-fill" style={{ width: `${country.accuracy * 100}%` }} />
                  </span>
                  {formatPercent(country.accuracy)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <VocabSection />
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="tile">
      <span className="tile__label">{label}</span>
      <span className="tile__value">{value}</span>
      {hint && <span className="tile__hint">{hint}</span>}
    </div>
  );
}

function AccuracyTooltip({ active, payload }: TooltipContentProps) {
  const point = payload?.[0]?.payload as
    | { label: string; accuracy: number | null; attempts: number; correct: number; questions: number }
    | undefined;
  if (!active || !point || point.accuracy === null) return null;

  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip__date">{point.label}</p>
      <p className="chart-tooltip__value">{point.accuracy}% correct</p>
      <p className="chart-tooltip__meta">
        {point.correct}/{point.questions} questions · {point.attempts}{' '}
        {point.attempts === 1 ? 'quiz' : 'quizzes'}
      </p>
    </div>
  );
}
