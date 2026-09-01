import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import type { Station } from '../types';

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface Radio {
  station: Station | null;
  status: PlaybackStatus;
  error: string | null;
  volume: number;
  muted: boolean;
  deadStations: ReadonlySet<string>;
  playback: {
    currentTime: number;
    playing: boolean;
    receivedAtMs: number;
  };
  tune: (station: Station) => void;
  toggle: () => void;
  /** Pause/resume without toggling — word-lookup must never start playback. */
  pause: () => void;
  resume: () => void;
  stop: () => void;
  retry: () => void;
  setVolume: (value: number) => void;
  toggleMute: () => void;
  setAudioUrlOverride: (url: string | null) => void;
}

export function useRadio(): Radio {
  const player = useAudioPlayer(null, { updateInterval: 500 });
  const playerStatus = useAudioPlayerStatus(player);
  const [station, setStation] = useState<Station | null>(null);
  const [status, setStatus] = useState<PlaybackStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolumeState] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [deadStations, setDeadStations] = useState<ReadonlySet<string>>(() => new Set());
  const [audioUrlOverride, setAudioUrlOverrideState] = useState<string | null>(null);
  const [playback, setPlayback] = useState(() => ({ currentTime: 0, playing: false, receivedAtMs: Date.now() }));
  const [sourceVersion, setSourceVersion] = useState(0);
  const sourceUriRef = useRef<string | null>(null);

  useEffect(() => {
    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    });
  }, []);

  useEffect(() => {
    player.volume = muted ? 0 : volume;
    player.muted = muted;
  }, [muted, player, volume]);

  useEffect(() => {
    setPlayback({
      currentTime: playerStatus.currentTime ?? 0,
      playing: playerStatus.playing,
      receivedAtMs: Date.now(),
    });
  }, [playerStatus.currentTime, playerStatus.playing]);

  useEffect(() => {
    if (!station) {
      setStatus('idle');
      return;
    }
    if (playerStatus.error) {
      setStatus('error');
      setError('This station is offline right now. Try another one.');
      setDeadStations((previous) => new Set(previous).add(station.id));
      return;
    }
    if (playerStatus.playing) {
      setStatus('playing');
      setError(null);
      return;
    }
    if (playerStatus.isBuffering || !playerStatus.isLoaded) {
      setStatus('loading');
      return;
    }
    setStatus('paused');
  }, [playerStatus.error, playerStatus.isBuffering, playerStatus.isLoaded, playerStatus.playing, station]);

  useEffect(() => {
    if (!station || status !== 'loading') return;
    const timer = setTimeout(() => {
      setStatus((current) => {
        if (current !== 'loading') return current;
        setError('This station is not responding. Try another one.');
        setDeadStations((previous) => new Set(previous).add(station.id));
        return 'error';
      });
    }, 15_000);
    return () => clearTimeout(timer);
  }, [station, status]);

  useEffect(() => {
    if (!station) return;
    const uri = audioUrlOverride ?? station.url;
    if (sourceUriRef.current === uri) return;
    sourceUriRef.current = uri;
    setStatus('loading');
    setError(null);
    player.replace({ uri, name: station.name });
    player.setActiveForLockScreen(true, {
      title: station.name,
      artist: [station.state, station.country].filter(Boolean).join(', ') || station.country,
      artworkUrl: station.favicon || undefined,
    });
    player.play();
  }, [audioUrlOverride, player, sourceVersion, station]);

  const playStation = useCallback(
    (next: Station) => {
      setStation(next);
      setAudioUrlOverrideState(null);
      sourceUriRef.current = null;
      setSourceVersion((version) => version + 1);
      setStatus('loading');
      setError(null);
      setDeadStations((previous) => {
        if (!previous.has(next.id)) return previous;
        const updated = new Set(previous);
        updated.delete(next.id);
        return updated;
      });
    },
    [],
  );

  const toggle = useCallback(() => {
    if (!station) return;
    if (status === 'playing' || playerStatus.playing) {
      player.pause();
      setStatus('paused');
    } else {
      setStatus('loading');
      player.play();
    }
  }, [player, playerStatus.playing, station, status]);

  const pause = useCallback(() => {
    if (!station) return;
    player.pause();
    setStatus('paused');
  }, [player, station]);

  const resume = useCallback(() => {
    if (!station) return;
    if (playerStatus.playing) return;
    setStatus('loading');
    player.play();
  }, [player, playerStatus.playing, station]);

  const stop = useCallback(() => {
    player.pause();
    player.setActiveForLockScreen(false);
    sourceUriRef.current = null;
    setAudioUrlOverrideState(null);
    setStation(null);
    setStatus('idle');
    setError(null);
  }, [player]);

  const retry = useCallback(() => {
    if (station) playStation(station);
  }, [playStation, station]);

  const setVolume = useCallback((value: number) => {
    const clamped = Math.max(0, Math.min(1, value));
    setVolumeState(clamped);
    setMuted(clamped === 0);
  }, []);

  const setAudioUrlOverride = useCallback((url: string | null) => {
    setAudioUrlOverrideState(url);
  }, []);

  const api = useMemo(
    () => ({
      station,
      status,
      error,
      volume,
      muted,
      deadStations,
      playback,
      tune: playStation,
      toggle,
      pause,
      resume,
      stop,
      retry,
      setVolume,
      toggleMute: () => setMuted((value) => !value),
      setAudioUrlOverride,
    }),
    [deadStations, error, muted, playStation, playback, pause, resume, retry, station, status, stop, toggle, volume, setVolume, setAudioUrlOverride],
  );

  return api;
}
