import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, getHealth, getStations, getStats } from './api';
import { AuthModal } from './components/AuthModal';
import { CaptionsPanel } from './components/CaptionsPanel';
import { FavoritesPanel } from './components/FavoritesPanel';
import { FriendsPanel } from './components/FriendsPanel';
import { GlobeView, KIND_COLORS } from './components/GlobeView';
import { PlayerBar } from './components/PlayerBar';
import { QuizPanel } from './components/QuizPanel';

// Recharts is only needed once the user opens their progress, so keep it out
// of the initial bundle.
const StatsPanel = lazy(() =>
  import('./components/StatsPanel').then((module) => ({ default: module.StatsPanel })),
);
import { ACCOUNT_NUDGE, useAuth } from './hooks/useAuth';
import { useFavorites } from './hooks/useFavorites';
import { useFriendsListening } from './hooks/useFriendsListening';
import { usePresence } from './hooks/usePresence';
import { useRadio } from './hooks/useRadio';
import { titleCase } from './lib/format';
import type { HealthResponse, Station, StationKind, StatsResponse } from './types';

const ALL_KINDS: StationKind[] = ['talk', 'music', 'unknown'];
const KIND_LABELS: Record<StationKind, string> = {
  talk: 'talk / news',
  music: 'music',
  unknown: 'unlabelled',
};

type Loadable<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [stations, setStations] = useState<Loadable<Station[]>>({ status: 'loading' });
  const [stats, setStats] = useState<Loadable<StatsResponse>>({ status: 'loading' });
  const [selected, setSelected] = useState<Station | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [captionsOpen, setCaptionsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [globeReady, setGlobeReady] = useState(false);
  // Empty set = no filter (all kinds shown).
  const [kindFilter, setKindFilter] = useState<Set<StationKind>>(new Set());
  const radio = useRadio();
  const auth = useAuth();
  const favorites = useFavorites(Boolean(auth.user));
  const friendsListening = useFriendsListening(Boolean(auth.user));
  usePresence(auth.user, radio.station, radio.status === 'playing');

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
  }, [loadStations]);

  useEffect(() => {
    if (!auth.user) {
      setStats({ status: 'loading' });
      return;
    }
    void refreshStats();
  }, [auth.user, refreshStats]);

  const stationList = stations.status === 'ready' ? stations.data : [];

  const toggleKind = useCallback((kind: StationKind) => {
    setKindFilter((previous) => {
      const next = new Set(previous);
      if (next.size === 0) {
        // No filter active: first click solos that kind.
        next.add(kind);
      } else if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      // Selecting everything is the same as no filter.
      if (next.size === ALL_KINDS.length) next.clear();
      return next;
    });
  }, []);

  const visibleStations = useMemo(
    () => (kindFilter.size === 0 ? stationList : stationList.filter((station) => kindFilter.has(station.kind))),
    [kindFilter, stationList],
  );

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
    if (visibleStations.length === 0) return;

    const alive = visibleStations.filter(
      (station) => station.reachable && !radio.deadStations.has(station.id) && station.id !== selected?.id,
    );
    const pool = alive.length > 0 ? alive : visibleStations;

    const unvisited = pool.filter((station) => !visitedCountries.has(station.countryCode));
    const preferred = unvisited.length > 0 ? unvisited : pool;
    // Bias toward talk radio (what the quiz works on) unless the user has
    // deliberately filtered talk out.
    const wantTalk = kindFilter.size === 0 || kindFilter.has('talk');
    const talk = wantTalk ? preferred.filter((station) => station.kind === 'talk') : [];
    const finalPool = talk.length > 0 ? talk : preferred;

    const pick = finalPool[Math.floor(Math.random() * finalPool.length)];
    if (pick) tune(pick);
  }, [kindFilter, radio.deadStations, selected, tune, visibleStations, visitedCountries]);

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
        setFavoritesOpen(false);
        setFriendsOpen(false);
        auth.closeModal();
        setAccountMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [auth, radio]);

  const requireAccount = useCallback(
    (then: () => void) => {
      if (!auth.user) {
        auth.openModal({ nudge: ACCOUNT_NUDGE, tab: 'signup' });
        return;
      }
      then();
    },
    [auth],
  );

  const openStats = useCallback(() => {
    requireAccount(() => {
      setStatsOpen(true);
      void refreshStats();
    });
  }, [refreshStats, requireAccount]);

  const openFavorites = useCallback(() => {
    requireAccount(() => setFavoritesOpen(true));
  }, [requireAccount]);

  const openFriends = useCallback(() => {
    requireAccount(() => setFriendsOpen(true));
  }, [requireAccount]);

  const targetLanguage = health?.targetLanguage ?? 'spanish';
  const booting = stations.status === 'loading' || !globeReady;

  return (
    <div className="app">
      <GlobeView
        stations={visibleStations}
        selected={selected}
        playing={radio.station}
        deadStations={radio.deadStations}
        favoriteIds={favorites.ids}
        friendsListening={friendsListening}
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
                ? kindFilter.size === 0
                  ? `${stationList.length.toLocaleString()} stations`
                  : `${visibleStations.length.toLocaleString()} of ${stationList.length.toLocaleString()} stations`
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
          <button type="button" className="button glass" onClick={openFriends}>
            <span aria-hidden="true">✧</span> Friends
          </button>
          <button type="button" className="button glass" onClick={openFavorites}>
            <span aria-hidden="true">♥</span> Favorites
            {favorites.favorites.length > 0 && (
              <span className="button__badge" aria-hidden="true">
                {favorites.favorites.length}
              </span>
            )}
          </button>
          {auth.user ? (
            <div className="account">
              <button
                type="button"
                className="button glass account__toggle"
                aria-expanded={accountMenuOpen}
                aria-haspopup="menu"
                onClick={() => setAccountMenuOpen((open) => !open)}
              >
                {auth.user.username}
              </button>
              {accountMenuOpen && (
                <div className="account__menu glass" role="menu">
                  <p className="account__display">{auth.user.displayName}</p>
                  <button
                    type="button"
                    className="account__signout"
                    role="menuitem"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      void auth.signOut();
                    }}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button type="button" className="button glass" onClick={() => auth.openModal()}>
              Sign in
            </button>
          )}
        </div>
      </header>

      <div className="hud hud--legend">
        <div className="legend glass" role="group" aria-label="Filter stations by kind">
          {ALL_KINDS.map((kind) => {
            const active = kindFilter.size === 0 || kindFilter.has(kind);
            const count = stationList.filter((station) => station.kind === kind).length;
            return (
              <button
                key={kind}
                type="button"
                className={`legend__item${active ? '' : ' legend__item--off'}`}
                aria-pressed={active}
                title={`Click to filter · ${count.toLocaleString()} stations`}
                onClick={() => toggleKind(kind)}
              >
                <i style={{ background: KIND_COLORS[kind] }} /> {KIND_LABELS[kind]}
                <span className="legend__count">{count.toLocaleString()}</span>
              </button>
            );
          })}
          {kindFilter.size > 0 && (
            <button type="button" className="legend__clear" onClick={() => setKindFilter(new Set())}>
              show all
            </button>
          )}
        </div>
      </div>

      {health && !health.captionsEnabled && (
        <div className="hud hud--notice">
          <p className="notice glass">
            Live captions are off — whisper.cpp is not available. Set <code>WHISPER_MODEL_PATH</code> to a
            ggml model and install <code>whisper-server</code> (or <code>whisper-cli</code>).
          </p>
        </div>
      )}

      {health && !health.quizEnabled && (
        <div className="hud hud--notice">
          <p className="notice glass">
            Quizzes and word lookup are off — Ollama is not running. Install it and run{' '}
            <code>ollama pull qwen2.5:7b-instruct</code>.
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
        isFavorited={radio.station ? favorites.isFavorite(radio.station.id) : false}
        onCaptions={() => setCaptionsOpen((open) => !open)}
        onQuiz={() => setQuizOpen(true)}
        onToggleFavorite={() => {
          if (radio.station) void favorites.toggle(radio.station);
        }}
      />

      {captionsOpen && radio.station && (
        <CaptionsPanel
          station={radio.station}
          active={captionsOpen}
          enabled={health?.captionsEnabled ?? false}
          paused={quizOpen}
          chunkSeconds={health?.captionChunkSeconds ?? 15}
          onClose={() => setCaptionsOpen(false)}
          onAudioUrlChange={radio.setAudioUrlOverride}
          getAudioElement={radio.getAudioElement}
          onPauseAudio={radio.pause}
          onResumeAudio={radio.resume}
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

      {favoritesOpen && (
        <FavoritesPanel
          favorites={favorites.favorites}
          loading={favorites.loading}
          error={favorites.error}
          onClose={() => setFavoritesOpen(false)}
          onTune={(station) => {
            tune(station);
            setFavoritesOpen(false);
          }}
          onRemove={(stationId) => void favorites.remove(stationId)}
        />
      )}

      {friendsOpen && auth.user && (
        <FriendsPanel me={auth.user} onClose={() => setFriendsOpen(false)} />
      )}

      {auth.modalOpen && (
        <AuthModal
          defaultTab={auth.defaultTab}
          nudge={auth.nudge}
          onClose={auth.closeModal}
          onLogin={auth.signIn}
          onSignup={auth.signUp}
        />
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
