import { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import type { Station } from '../types';

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface Radio {
  station: Station | null;
  status: PlaybackStatus;
  error: string | null;
  volume: number;
  muted: boolean;
  /** Station ids whose stream failed, so the globe can dim them. */
  deadStations: ReadonlySet<string>;
  tune: (station: Station) => void;
  toggle: () => void;
  stop: () => void;
  retry: () => void;
  setVolume: (value: number) => void;
  toggleMute: () => void;
}

const VOLUME_KEY = 'language-globe:volume';

function readStoredVolume(): number {
  const stored = Number(localStorage.getItem(VOLUME_KEY));
  return Number.isFinite(stored) && stored >= 0 && stored <= 1 ? stored : 0.8;
}

function isHls(url: string): boolean {
  return url.toLowerCase().includes('.m3u8');
}

export function useRadio(): Radio {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [station, setStation] = useState<Station | null>(null);
  const [status, setStatus] = useState<PlaybackStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolumeState] = useState<number>(() => readStoredVolume());
  const [muted, setMuted] = useState(false);
  const [deadStations, setDeadStations] = useState<ReadonlySet<string>>(() => new Set());
  /** Bumped by retry() to re-run the attach effect with the same station. */
  const [attempt, setAttempt] = useState(0);

  if (audioRef.current === null && typeof Audio !== 'undefined') {
    const audio = new Audio();
    audio.preload = 'none';
    // No crossOrigin: most icecast servers send no CORS headers, and plain
    // playback does not need them.
    audioRef.current = audio;
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
      audio.muted = muted;
    }
    localStorage.setItem(VOLUME_KEY, String(volume));
  }, [volume, muted]);

  const markDead = useCallback((stationId: string) => {
    setDeadStations((previous) => new Set(previous).add(stationId));
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !station) return;

    setStatus('loading');
    setError(null);

    const fail = (message: string) => {
      setStatus('error');
      setError(message);
      markDead(station.id);
    };

    // Live streams have no meaningful duration; if nothing is playing after a
    // while the station is almost certainly down rather than slow.
    const stallTimer = window.setTimeout(() => {
      if (audio.paused || audio.readyState < 2) fail('This station is not responding. Try another one.');
    }, 15_000);

    const onPlaying = () => {
      window.clearTimeout(stallTimer);
      setStatus('playing');
      setError(null);
    };
    const onPause = () => setStatus((current) => (current === 'error' ? current : 'paused'));
    const onWaiting = () => setStatus((current) => (current === 'playing' ? 'loading' : current));
    const onError = () => fail('This station is offline right now. Try another one.');

    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('error', onError);

    if (isHls(station.url) && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hlsRef.current = hls;
      hls.loadSource(station.url);
      hls.attachMedia(audio);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) fail('This HLS stream could not be loaded. Try another station.');
      });
    } else {
      // Safari plays HLS natively; everything else is a plain audio URL.
      audio.src = station.url;
      audio.load();
    }

    void audio.play().catch(() => {
      // Autoplay policies reject the promise until the user interacts; the
      // click that selected the station usually satisfies that, so anything
      // left here is a genuine failure to start.
      fail('Playback was blocked. Press play to start this station.');
    });

    return () => {
      window.clearTimeout(stallTimer);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('error', onError);
      audio.pause();
      hlsRef.current?.destroy();
      hlsRef.current = null;
      audio.removeAttribute('src');
      audio.load();
    };
  }, [station, attempt, markDead]);

  const tune = useCallback((next: Station) => {
    setStation(next);
    setDeadStations((previous) => {
      if (!previous.has(next.id)) return previous;
      const updated = new Set(previous);
      updated.delete(next.id);
      return updated;
    });
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !station) return;
    if (audio.paused) {
      setStatus('loading');
      void audio.play().catch(() => setStatus('error'));
    } else {
      audio.pause();
    }
  }, [station]);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    setStation(null);
    setStatus('idle');
    setError(null);
  }, []);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const setVolume = useCallback((value: number) => {
    setVolumeState(value);
    setMuted(value === 0);
  }, []);

  const toggleMute = useCallback(() => setMuted((value) => !value), []);

  return {
    station,
    status,
    error,
    volume,
    muted,
    deadStations,
    tune,
    toggle,
    stop,
    retry,
    setVolume,
    toggleMute,
  };
}
