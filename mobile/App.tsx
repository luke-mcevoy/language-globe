import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ApiError, getHealth, getStations, getStats } from './src/lib/api';
import { GlobeView, KIND_COLORS } from './src/components/GlobeView';
import { CaptionsPanel } from './src/components/CaptionsPanel';
import { FavoritesPanel } from './src/components/FavoritesPanel';
import { LanguagePicker } from './src/components/LanguagePicker';
import { PlayerBar } from './src/components/PlayerBar';
import { QuizPanel } from './src/components/QuizPanel';
import { StatsPanel } from './src/components/StatsPanel';
import { useFavorites } from './src/hooks/useFavorites';
import { useRadio } from './src/hooks/useRadio';
import { languageLabel } from './src/lib/languages';
import type { HealthResponse, LearningLanguage, Station, StationKind, StatsResponse } from './src/types';

type Loadable<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

const FALLBACK_LANGUAGES: LearningLanguage[] = [
  { id: 'spanish', name: 'Spanish', nativeName: 'Español', code: 'es' },
  { id: 'italian', name: 'Italian', nativeName: 'Italiano', code: 'it' },
];

const ALL_KINDS: StationKind[] = ['talk', 'music', 'unknown'];
const KIND_LABELS: Record<StationKind, string> = {
  talk: 'talk',
  music: 'music',
  unknown: 'unlabelled',
};

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [stations, setStations] = useState<Loadable<Station[]>>({ status: 'loading' });
  const [stats, setStats] = useState<Loadable<StatsResponse>>({ status: 'loading' });
  const [selected, setSelected] = useState<Station | null>(null);
  const [captionsOpen, setCaptionsOpen] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [globeReady, setGlobeReady] = useState(false);
  // Empty set = no filter (all kinds shown).
  const [kindFilter, setKindFilter] = useState<Set<StationKind>>(new Set());
  const [language, setLanguage] = useState('spanish');
  const radio = useRadio();
  const favorites = useFavorites();

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

  const loadStations = useCallback(async (forLanguage: string) => {
    setStations({ status: 'loading' });
    try {
      const response = await getStations(forLanguage);
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
      .then((next) => {
        setHealth(next);
        const catalog = next.languages ?? [];
        const known = new Set(catalog.map((item) => item.id));
        setLanguage((current) =>
          known.has(current) ? current : known.has(next.targetLanguage) ? next.targetLanguage : current,
        );
      })
      .catch(() => setHealth(null));
    void refreshStats();
  }, [refreshStats]);

  useEffect(() => {
    void loadStations(language);
  }, [language, loadStations]);

  const stationList = stations.status === 'ready' ? stations.data : [];
  const languages = health?.languages?.length ? health.languages : FALLBACK_LANGUAGES;
  const targetLanguage = language;
  const languageName = languageLabel(targetLanguage, languages);

  const toggleKind = useCallback((kind: StationKind) => {
    setKindFilter((previous) => {
      const next = new Set(previous);
      if (next.size === 0) {
        // No filter active: first tap solos that kind.
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

  const surpriseMe = useCallback(() => {
    if (visibleStations.length === 0) return;
    const alive = visibleStations.filter(
      (station) => station.reachable && !radio.deadStations.has(station.id) && station.id !== selected?.id,
    );
    const pool = alive.length > 0 ? alive : visibleStations;
    const unvisited = pool.filter((station) => !visitedCountries.has(station.countryCode));
    const preferred = unvisited.length > 0 ? unvisited : pool;
    // Bias toward talk radio unless the user filtered talk out.
    const wantTalk = kindFilter.size === 0 || kindFilter.has('talk');
    const talk = wantTalk ? preferred.filter((station) => station.kind === 'talk') : [];
    const finalPool = talk.length > 0 ? talk : preferred;
    const pick = finalPool[Math.floor(Math.random() * finalPool.length)];
    if (pick) tune(pick);
  }, [kindFilter, radio.deadStations, selected, tune, visibleStations, visitedCountries]);

  const openStats = useCallback(() => {
    setStatsOpen(true);
    void refreshStats();
  }, [refreshStats]);

  const changeLanguage = useCallback(
    (next: string) => {
      if (next === language) return;
      radio.stop();
      setSelected(null);
      setQuizOpen(false);
      setCaptionsOpen(false);
      setLanguage(next);
    },
    [language, radio],
  );

  const booting = stations.status === 'loading' || !globeReady;

  return (
    <View style={styles.app}>
      <StatusBar style="light" />
      <GlobeView
        stations={visibleStations}
        selected={selected}
        playing={radio.station}
        deadStations={radio.deadStations}
        favoriteIds={favorites.ids}
        onSelect={tune}
        onReady={() => setGlobeReady(true)}
      />

      <SafeAreaView style={styles.safe} pointerEvents="box-none">
        <View style={styles.topHud}>
          <View style={styles.brand}>
            <View style={styles.brandMark} />
            <View style={styles.brandText}>
              <Text style={styles.brandTitle}>Language Globe</Text>
              <Text style={styles.brandSubtitle}>
                {languageName} radio ·{' '}
                {stations.status === 'ready'
                  ? kindFilter.size === 0
                    ? `${stationList.length.toLocaleString()} stations`
                    : `${visibleStations.length.toLocaleString()} of ${stationList.length.toLocaleString()} stations`
                  : stations.status === 'loading'
                    ? 'finding stations...'
                    : 'stations unavailable'}
              </Text>
            </View>
          </View>

          <View style={styles.actionRow}>
            <LanguagePicker language={targetLanguage} languages={languages} onChange={changeLanguage} />
            <Pressable style={styles.actionButton} onPress={surpriseMe} disabled={stationList.length === 0}>
              <Text style={styles.actionText}>Surprise</Text>
            </Pressable>
            <Pressable style={styles.actionButton} onPress={openStats}>
              <Text style={styles.actionText}>Progress</Text>
            </Pressable>
            <Pressable style={styles.actionButton} onPress={() => setFavoritesOpen(true)}>
              <Text style={styles.actionText}>
                ♥ {favorites.favorites.length > 0 ? favorites.favorites.length : ''}
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.legend}>
          {ALL_KINDS.map((kind) => (
            <LegendDot
              key={kind}
              color={KIND_COLORS[kind]}
              label={KIND_LABELS[kind]}
              active={kindFilter.size === 0 || kindFilter.has(kind)}
              onPress={() => toggleKind(kind)}
            />
          ))}
          {kindFilter.size > 0 && (
            <Pressable onPress={() => setKindFilter(new Set())}>
              <Text style={styles.legendClear}>show all</Text>
            </Pressable>
          )}
        </View>

        {health && !health.captionsEnabled && (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Live captions are off — whisper.cpp is not available. Set WHISPER_MODEL_PATH to a ggml model
              and install whisper-server (or whisper-cli).
            </Text>
          </View>
        )}

        {health && !health.quizEnabled && (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Quizzes and word lookup are off — Ollama is not running. Install it and run ollama pull
              qwen2.5:7b-instruct.
            </Text>
          </View>
        )}

        {stations.status === 'error' && (
          <View style={[styles.notice, styles.errorNotice]}>
            <Text style={styles.noticeText}>{stations.message}</Text>
            <Pressable onPress={() => void loadStations(language)}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        )}
      </SafeAreaView>

      <CaptionsPanel
        station={radio.station}
        language={targetLanguage}
        visible={captionsOpen}
        enabled={health?.captionsEnabled ?? false}
        paused={quizOpen}
        chunkSeconds={health?.captionChunkSeconds ?? 15}
        onClose={() => setCaptionsOpen(false)}
        onAudioUrlChange={radio.setAudioUrlOverride}
        onPauseAudio={radio.pause}
        onResumeAudio={radio.resume}
        playback={radio.playback}
      />

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

      <QuizPanel
        visible={quizOpen}
        station={radio.station}
        quizEnabled={health?.quizEnabled ?? false}
        captureSeconds={health?.captureSeconds ?? 60}
        targetLanguage={targetLanguage}
        onClose={() => setQuizOpen(false)}
        onTune={(station) => tune(station)}
        onCompleted={() => void refreshStats()}
      />

      <StatsPanel
        visible={statsOpen}
        stats={stats.status === 'ready' ? stats.data : null}
        loading={stats.status === 'loading'}
        error={stats.status === 'error' ? stats.message : null}
        onClose={() => setStatsOpen(false)}
      />

      <FavoritesPanel
        visible={favoritesOpen}
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

      {booting && (
        <View style={styles.boot} pointerEvents="none">
          <ActivityIndicator color="#54e6c3" size="large" />
          <Text style={styles.bootText}>{stations.status === 'loading' ? 'Tuning the world in...' : 'Lighting up the globe...'}</Text>
        </View>
      )}
    </View>
  );
}

function LegendDot({
  color,
  label,
  active,
  onPress,
}: {
  color: string;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.legendItem, !active && styles.legendItemOff]} onPress={onPress} hitSlop={6}>
      <View
        style={[
          styles.legendDot,
          active ? { backgroundColor: color } : [styles.legendDotOff, { borderColor: color }],
        ]}
      />
      <Text style={styles.legendText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: '#060a15',
  },
  safe: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  topHud: {
    paddingHorizontal: 14,
    paddingTop: 8,
    gap: 10,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(9, 14, 29, 0.78)',
    borderRadius: 18,
    padding: 12,
    gap: 10,
  },
  brandMark: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#54e6c3',
    backgroundColor: 'rgba(84,230,195,0.12)',
  },
  brandText: {
    flex: 1,
    minWidth: 0,
  },
  brandTitle: {
    color: '#f7fbff',
    fontSize: 19,
    fontWeight: '900',
  },
  brandSubtitle: {
    color: '#9ba8c3',
    fontSize: 12,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    minHeight: 42,
    paddingHorizontal: 18,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
  },
  actionText: {
    color: '#eaf2ff',
    fontWeight: '800',
  },
  legend: {
    position: 'absolute',
    right: 14,
    top: 150,
    gap: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(9,14,29,0.66)',
    padding: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  legendItemOff: {
    opacity: 0.35,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendDotOff: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
  },
  legendText: {
    color: '#c4cfe8',
    fontSize: 11,
  },
  legendClear: {
    color: '#54e6c3',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  notice: {
    marginHorizontal: 14,
    marginTop: 10,
    borderRadius: 14,
    padding: 11,
    backgroundColor: 'rgba(255,229,157,0.13)',
    borderWidth: 1,
    borderColor: 'rgba(255,229,157,0.25)',
  },
  errorNotice: {
    backgroundColor: 'rgba(255,111,145,0.12)',
    borderColor: 'rgba(255,111,145,0.28)',
  },
  noticeText: {
    color: '#f5ddb2',
    lineHeight: 18,
  },
  retryText: {
    color: '#54e6c3',
    fontWeight: '900',
    marginTop: 6,
  },
  boot: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(6,10,21,0.62)',
    gap: 12,
  },
  bootText: {
    color: '#dbe7ff',
    fontSize: 15,
    fontWeight: '700',
  },
});
