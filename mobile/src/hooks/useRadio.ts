import { useCallback, useEffect, useMemo, useState } from 'react';
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
  tune: (station: Station) => void;
  toggle: () => void;
  stop: () => void;
  retry: () => void;
  setVolume: (value: number) => void;
  toggleMute: () => void;
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

  const playStation = useCallback(
    (next: Station) => {
      setStation(next);
      setStatus('loading');
      setError(null);
      setDeadStations((previous) => {
        if (!previous.has(next.id)) return previous;
        const updated = new Set(previous);
        updated.delete(next.id);
        return updated;
      });
      player.replace({ uri: next.url, name: next.name });
      player.setActiveForLockScreen(true, {
        title: next.name,
        artist: [next.state, next.country].filter(Boolean).join(', ') || next.country,
        artworkUrl: next.favicon || undefined,
      });
      player.play();
    },
    [player],
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

  const stop = useCallback(() => {
    player.pause();
    player.setActiveForLockScreen(false);
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

  const api = useMemo(
    () => ({
      station,
      status,
      error,
      volume,
      muted,
      deadStations,
      tune: playStation,
      toggle,
      stop,
      retry,
      setVolume,
      toggleMute: () => setMuted((value) => !value),
    }),
    [deadStations, error, muted, playStation, retry, station, status, stop, toggle, volume, setVolume],
  );

  return api;
}
