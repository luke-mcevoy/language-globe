import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  captionSessionAudioUrl,
  pollCaptionSession,
  startCaptionSession,
  stopCaptionSession,
} from '../api';
import {
  findActiveChunk,
  findActiveWordIndex,
  initialPlaybackAnchor,
  reanchorPlayback,
  sessionTimeAt,
  type PlaybackAnchor,
} from '../lib/captionSync';
import type { CaptionChunk, Station } from '../types';

type CaptionMode = 'synced' | 'live';

interface CaptionsPanelProps {
  station: Station;
  active: boolean;
  enabled: boolean;
  paused: boolean;
  chunkSeconds: number;
  onClose: () => void;
  onAudioUrlChange: (url: string | null) => void;
  getAudioElement: () => HTMLAudioElement | null;
}

interface KaraokeState {
  chunkSeq: number | null;
  wordIndex: number;
}

const IDLE_KARAOKE: KaraokeState = { chunkSeq: null, wordIndex: -1 };

export function CaptionsPanel({
  active,
  chunkSeconds,
  enabled,
  getAudioElement,
  onAudioUrlChange,
  onClose,
  paused,
  station,
}: CaptionsPanelProps) {
  const [chunks, setChunks] = useState<CaptionChunk[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<CaptionMode>('synced');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [karaoke, setKaraoke] = useState<KaraokeState>(IDLE_KARAOKE);
  // The sync relay can only serve audio once it has buffered `delaySeconds`
  // worth of stream. Pointing the player at it earlier starves the <audio>
  // element and the whole station errors out, so we keep playing the direct
  // stream and only switch when the server reports enough buffer.
  const [syncReady, setSyncReady] = useState(false);
  const [bufferVersion, setBufferVersion] = useState(0);
  const bufferRef = useRef<{ bufferedMs: number; atMs: number } | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const anchorRef = useRef<PlaybackAnchor>(initialPlaybackAnchor());
  const sessionEpochRef = useRef<number | null>(null);
  const delaySeconds = chunkSeconds + 5;

  useEffect(() => {
    setChunks([]);
    setError(null);
    setSessionId(null);
    setKaraoke(IDLE_KARAOKE);
    setSyncReady(false);
    bufferRef.current = null;
    anchorRef.current = initialPlaybackAnchor();
    sessionEpochRef.current = null;
    pinnedRef.current = true;
  }, [station.id]);

  const pinToBottom = useCallback(() => {
    const feed = feedRef.current;
    if (!feed || !pinnedRef.current) return;
    feed.scrollTop = feed.scrollHeight;
  }, []);

  useEffect(() => {
    pinToBottom();
  }, [chunks, pending, pinToBottom]);

  useEffect(() => {
    if (!active || !enabled || paused) {
      setPending(false);
      setSessionId(null);
      setKaraoke(IDLE_KARAOKE);
      sessionEpochRef.current = null;
      onAudioUrlChange(null);
      return;
    }

    let cancelled = false;
    let session: string | null = null;
    let controller: AbortController | null = null;

    async function loop() {
      setPending(true);
      try {
        // Deliberately not abortable: if the panel closes (or the station
        // changes) mid-create, we still need the response so we can delete
        // the session we asked for — an aborted create leaks it server-side.
        const created = await startCaptionSession(station.id);
        session = created.sessionId;
        if (cancelled) {
          // The panel closed while the create was in flight; the cleanup ran
          // before we knew the id, so release the session ourselves.
          void stopCaptionSession(created.sessionId).catch(() => undefined);
          return;
        }
        setSessionId(created.sessionId);
        setSyncReady(false);
        bufferRef.current = null;
        sessionEpochRef.current = performance.now();
        anchorRef.current = initialPlaybackAnchor();
        setError(null);

        let after = 0;
        while (!cancelled) {
          controller = new AbortController();
          const response = await pollCaptionSession(created.sessionId, after, controller.signal);
          if (cancelled) return;
          if (typeof response.audioBufferedMs === 'number') {
            bufferRef.current = { bufferedMs: response.audioBufferedMs, atMs: performance.now() };
            // True session-axis zero is the first buffered byte (after the
            // burst discard), not the create response — correct the epoch so
            // karaoke wall-clock re-anchoring sits on the right axis.
            sessionEpochRef.current = performance.now() - response.audioBufferedMs;
            setBufferVersion((version) => version + 1);
          }
          if (response.chunks.length > 0) {
            after = response.chunks[response.chunks.length - 1]?.seq ?? after;
            setError(null);
            setChunks((previous) => [...previous, ...response.chunks].slice(-40));
          }
          setPending(false);
        }
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
        setError(error instanceof ApiError ? error.message : 'Could not load captions.');
        setPending(false);
      }
    }

    void loop();
    return () => {
      cancelled = true;
      controller?.abort();
      onAudioUrlChange(null);
      if (session) void stopCaptionSession(session).catch(() => undefined);
    };
  }, [active, enabled, onAudioUrlChange, paused, station.id]);

  // Flip syncReady once the relay buffer covers the delay (extrapolating
  // between polls, since long-polls can be 25s apart).
  useEffect(() => {
    if (syncReady || !sessionId) return;
    const buffer = bufferRef.current;
    if (!buffer) return;
    // Well past the delay on purpose: at switch time the relay can then hand
    // the <audio> element ~8s of data instantly, so playback starts in ~1s
    // instead of trickling at 1x while the browser pre-buffers (~10s of
    // silence between the live stream stopping and the synced one starting).
    const marginMs = 8_000;
    const bufferedNow = buffer.bufferedMs + (performance.now() - buffer.atMs);
    const remainingMs = delaySeconds * 1000 + marginMs - bufferedNow;
    if (remainingMs <= 0) {
      setSyncReady(true);
      return;
    }
    const timer = window.setTimeout(() => setSyncReady(true), remainingMs);
    return () => window.clearTimeout(timer);
  }, [bufferVersion, delaySeconds, sessionId, syncReady]);

  useEffect(() => {
    if (!sessionId || mode !== 'synced' || paused || !active || !syncReady) {
      onAudioUrlChange(null);
      return;
    }
    onAudioUrlChange(captionSessionAudioUrl(sessionId, delaySeconds));
    return () => onAudioUrlChange(null);
  }, [active, delaySeconds, mode, onAudioUrlChange, paused, sessionId, syncReady]);

  // Re-anchor on every arriving chunk: MP3 currentTime drift over minutes
  // would otherwise walk the highlight away from the audible word.
  useEffect(() => {
    if (mode !== 'synced' || !sessionId || !syncReady || sessionEpochRef.current === null) return;
    const audio = getAudioElement();
    if (!audio || audio.currentTime < 0.05) return;
    anchorRef.current = reanchorPlayback({
      anchor: anchorRef.current,
      clientNowMs: performance.now(),
      sessionEpochMs: sessionEpochRef.current,
      relayDelayMs: delaySeconds * 1000,
      audioCurrentTimeSeconds: audio.currentTime,
    });
  }, [chunks, delaySeconds, getAudioElement, mode, sessionId, syncReady]);

  // Karaoke tick: cheap rAF loop mapping audio.currentTime onto the session
  // axis and updating which word span glows.
  useEffect(() => {
    if (mode !== 'synced' || !sessionId || paused || !active || !syncReady) {
      setKaraoke(IDLE_KARAOKE);
      return;
    }
    let raf = 0;
    const tick = () => {
      const audio = getAudioElement();
      if (audio && !audio.paused && audio.currentTime > 0) {
        const sessionMs = sessionTimeAt(anchorRef.current, audio.currentTime);
        const chunk = findActiveChunk(chunks, sessionMs);
        if (chunk?.words && chunk.words.length > 0) {
          const idx = findActiveWordIndex(chunk.words, sessionMs);
          setKaraoke((previous) =>
            previous.chunkSeq === chunk.seq && previous.wordIndex === idx
              ? previous
              : { chunkSeq: chunk.seq, wordIndex: idx },
          );
        } else if (chunk) {
          setKaraoke((previous) =>
            previous.chunkSeq === chunk.seq && previous.wordIndex === -1 ? previous : { chunkSeq: chunk.seq, wordIndex: -1 },
          );
        } else {
          setKaraoke((previous) => (previous.chunkSeq === null && previous.wordIndex === -1 ? previous : IDLE_KARAOKE));
        }
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [active, chunks, getAudioElement, mode, paused, sessionId, syncReady]);

  const wordCount = chunks.reduce((total, chunk) => total + chunk.text.split(/\s+/).filter(Boolean).length, 0);
  const activeChunkSeq = mode === 'synced' ? karaoke.chunkSeq : null;
  const activeWordIndex = mode === 'synced' ? karaoke.wordIndex : -1;

  const modeFooter = useMemo(() => {
    if (mode !== 'synced') return 'live captions';
    if (!syncReady) return `synced - buffering ${delaySeconds}s delay (audio stays live meanwhile)`;
    const hasKaraoke = chunks.some((chunk) => Array.isArray(chunk.words) && chunk.words.length > 0);
    return hasKaraoke
      ? `synced - karaoke - audio delayed ${delaySeconds}s`
      : `synced - audio delayed ${delaySeconds}s`;
  }, [chunks, delaySeconds, mode, syncReady]);

  return (
    <aside className="captions glass" aria-label="Live captions">
      <header className="captions__header">
        <div>
          <p className="captions__eyebrow">Live captions</p>
          <h2 className="captions__station" title={station.name}>
            {station.name}
          </h2>
        </div>
        <div className="captions__controls">
          <div className="captions__mode" role="group" aria-label="Caption timing mode">
            <button
              type="button"
              className={mode === 'synced' ? 'captions__mode-button captions__mode-button--active' : 'captions__mode-button'}
              onClick={() => setMode('synced')}
            >
              Synced
            </button>
            <button
              type="button"
              className={mode === 'live' ? 'captions__mode-button captions__mode-button--active' : 'captions__mode-button'}
              onClick={() => setMode('live')}
            >
              Live
            </button>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close captions">
            ×
          </button>
        </div>
      </header>

      <div
        className="captions__feed"
        ref={feedRef}
        onScroll={(event) => {
          const feed = event.currentTarget;
          pinnedRef.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 24;
        }}
      >
        {chunks.length === 0 && !pending && !paused && !error && (
          <p className="captions__empty">Waiting for the next spoken chunk...</p>
        )}
        {chunks.map((chunk, index) => {
          const isLatest = index === chunks.length - 1;
          const isPlaying = mode === 'synced' && chunk.seq === activeChunkSeq;
          const className =
            `captions__chunk${isLatest ? ' captions__chunk--latest' : ''}` +
            `${isPlaying ? ' captions__chunk--playing' : ''}` +
            `${chunk.text.includes('music') ? ' captions__chunk--music' : ''}`;
          return (
            <p className={className} key={chunk.seq}>
              {renderChunkBody(chunk, isPlaying, isPlaying ? activeWordIndex : -1, mode)}
            </p>
          );
        })}
        {paused && <p className="captions__paused">Paused while the quiz captures this station.</p>}
        {error && <p className="captions__error">{error}</p>}
        {pending && (
          <p className="captions__pending" aria-label="Captions loading">
            ...
          </p>
        )}
      </div>

      <footer className="captions__footer">
        <span>{wordCount} words</span>
        <span>{modeFooter}</span>
      </footer>
    </aside>
  );
}

function renderChunkBody(
  chunk: CaptionChunk,
  isCurrentChunk: boolean,
  activeWordIndex: number,
  mode: CaptionMode,
) {
  const words = chunk.words;
  // In Live mode the words on screen were spoken ~15s ago; a moving highlight
  // would lie. Same fallback when the provider did not report word timings,
  // or when this chunk is not the one currently playing — already-spoken
  // chunks stay as normal text so only the karaoke line moves.
  if (mode !== 'synced' || !isCurrentChunk || !words || words.length === 0) return chunk.text;

  return words.map((word, index) => {
    const state: 'past' | 'current' | 'future' =
      index < activeWordIndex ? 'past' : index === activeWordIndex ? 'current' : 'future';
    return (
      <span key={index} className={`captions__word captions__word--${state}`}>
        {word.word}
        {index < words.length - 1 ? ' ' : ''}
      </span>
    );
  });
}
