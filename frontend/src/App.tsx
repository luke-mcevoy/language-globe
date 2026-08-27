import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, getHealth, getStations, getStats } from './api';
import { CaptionsPanel } from './components/CaptionsPanel';
import { GlobeView, KIND_COLORS } from './components/GlobeView';
import { PlayerBar } from './components/PlayerBar';
import { QuizPanel } from './components/QuizPanel';

// Recharts is only needed once the user opens their progress, so keep it out
// of the initial bundle.
const StatsPanel = lazy(() =>
  import('./components/StatsPanel').then((module) => ({ default: module.StatsPanel })),
);
import { useRadio } from './hooks/useRadio';
import { titleCase } from './lib/format';
import type { HealthResponse, Station, StatsResponse } from './types';

type Loadable<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [stations, setStations] = useState<Loadable<Station[]>>({ status: 'loading' });
  const [stats, setStats] = useState<Loadable<StatsResponse>>({ status: 'loading' });
  const [selected, setSelected] = useState<Station | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [captionsOpen, setCaptionsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [globeReady, setGlobeReady] = useState(false);
  const radio = useRadio();

  const refreshStats = useCallback(async () => {
    try {
      const data = await getStats();
      setStats({ status: 'ready', data });
    } catch (error) {
      setStats({
        status: 'error',
        message: error instanceof ApiError ? error.message : 'Could not load your stats.',
      });
    }
  }, []);

  const loadStations = useCallback(async () => {
    setStations({ status: 'loading' });
    try {
      const response = await getStations();
      setStations({ status: 'ready', data: response.stations });
    } catch (error) {
      setStations({
        status: 'error',
        message: error instanceof ApiError ? error.message : 'Could not load stations.',
      });
    }
  }, []);

  useEffect(() => {
    void getHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
    void loadStations();
    void refreshStats();
  }, [loadStations, refreshStats]);

  const stationList = stations.status === 'ready' ? stations.data : [];

  const visitedCountries = useMemo(
    () => new Set(stats.status === 'ready' ? stats.data.countries.map((country) => country.countryCode) : []),
    [stats],
  );

  const tune = useCallback(
    (station: Station) => {
      setSelected(station);
      radio.tune(station);
    },
    [radio],
  );

  /**
   * Random station, biased toward places the user has not quizzed yet and
   * toward talk radio, which is what the quiz actually works on.
   */
  const surpriseMe = useCallback(() => {
    if (stationList.length === 0) return;

    const alive = stationList.filter(
      (station) => station.reachable && !radio.deadStations.has(station.id) && station.id !== selected?.id,
    );
    const pool = alive.length > 0 ? alive : stationList;

    const unvisited = pool.filter((station) => !visitedCountries.has(station.countryCode));
    const preferred = unvisited.length > 0 ? unvisited : pool;
    const talk = preferred.filter((station) => station.kind === 'talk');
    const finalPool = talk.length > 0 ? talk : preferred;

    const pick = finalPool[Math.floor(Math.random() * finalPool.length)];
    if (pick) tune(pick);
  }, [radio.deadStations, selected, stationList, tune, visitedCountries]);

  // Space toggles playback, as long as the user is not typing in a control.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)) return;
      if (event.code === 'Space' && radio.station) {
        event.preventDefault();
        radio.toggle();
      }
      if (event.key === 'Escape') {
        setQuizOpen(false);
        setCaptionsOpen(false);
        setStatsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [radio]);

  const openStats = useCallback(() => {
    setStatsOpen(true);
    void refreshStats();
  }, [refreshStats]);

  const targetLanguage = health?.targetLanguage ?? 'spanish';
  const booting = stations.status === 'loading' || !globeReady;

  return (
    <div className="app">
      <GlobeView
        stations={stationList}
        selected={selected}
        playing={radio.station}
        deadStations={radio.deadStations}
        onSelect={tune}
        onReady={() => setGlobeReady(true)}
      />

      <header className="hud hud--top">
        <div className="brand glass">
          <span className="brand__mark" aria-hidden="true" />
          <div className="brand__text">
            <h1 className="brand__title">Language Globe</h1>
            <p className="brand__subtitle">
              {titleCase(targetLanguage)} radio ·{' '}
              {stations.status === 'ready'
                ? `${stationList.length.toLocaleString()} stations`
                : stations.status === 'loading'
                  ? 'finding stations…'
                  : 'stations unavailable'}
            </p>
          </div>
        </div>

        <div className="hud__actions">
          <button
            type="button"
            className="button glass"
            onClick={surpriseMe}
            disabled={stationList.length === 0}
          >
            <span aria-hidden="true">✦</span> Surprise me
          </button>
          <button type="button" className="button glass" onClick={openStats}>
            <span aria-hidden="true">◷</span> Progress
          </button>
        </div>
      </header>

      <div className="hud hud--legend">
        <div className="legend glass">
          <span className="legend__item">
            <i style={{ background: KIND_COLORS.talk }} /> talk / news
          </span>
          <span className="legend__item">
            <i style={{ background: KIND_COLORS.music }} /> music
          </span>
          <span className="legend__item">
            <i style={{ background: KIND_COLORS.unknown }} /> unlabelled
          </span>
        </div>
      </div>

      {health && !health.quizEnabled && (
        <div className="hud hud--notice">
          <p className="notice glass">
            Quizzes are off — add <code>OPENAI_API_KEY</code> to <code>server/.env</code> and restart the
            server.
          </p>
        </div>
      )}

      {stations.status === 'error' && (
        <div className="hud hud--notice">
          <p className="notice notice--error glass">
            {stations.message}{' '}
            <button type="button" className="link-button" onClick={() => void loadStations()}>
              Retry
            </button>
          </p>
        </div>
      )}

      <PlayerBar
        radio={radio}
        captionsEnabled={health?.captionsEnabled ?? false}
        captionsOpen={captionsOpen}
        quizEnabled={health?.quizEnabled ?? false}
        quizOpen={quizOpen}
        onCaptions={() => setCaptionsOpen((open) => !open)}
        onQuiz={() => setQuizOpen(true)}
      />

      {captionsOpen && radio.station && (
        <CaptionsPanel
          station={radio.station}
          active={captionsOpen}
          enabled={health?.captionsEnabled ?? false}
          paused={quizOpen}
          chunkSeconds={health?.captionChunkSeconds ?? 15}
          onClose={() => setCaptionsOpen(false)}
        />
      )}

      {quizOpen && radio.station && (
        <QuizPanel
          station={radio.station}
          quizEnabled={health?.quizEnabled ?? false}
          captureSeconds={health?.captureSeconds ?? 60}
          targetLanguage={targetLanguage}
          onClose={() => setQuizOpen(false)}
          onTune={(station) => tune(station)}
          onCompleted={() => void refreshStats()}
        />
      )}

      {statsOpen && (
        <Suspense fallback={null}>
          <StatsPanel
            stats={stats.status === 'ready' ? stats.data : null}
            loading={stats.status === 'loading'}
            error={stats.status === 'error' ? stats.message : null}
            onClose={() => setStatsOpen(false)}
          />
        </Suspense>
      )}

      <div className={`boot${booting ? '' : ' boot--done'}`} aria-hidden={!booting}>
        <div className="boot__inner">
          <span className="boot__ring" />
          <p className="boot__label">
            {stations.status === 'loading' ? 'Tuning the world in…' : 'Lighting up the globe…'}
          </p>
        </div>
      </div>
    </div>
  );
}
