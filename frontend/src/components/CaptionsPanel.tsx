import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  captionSessionAudioUrl,
  pollCaptionSession,
  startCaptionSession,
  stopCaptionSession,
} from '../api';
import { findActiveChunk, findActiveWordIndex, sessionTimeAt } from '../lib/captionSync';
import type { CaptionChunk, Station } from '../types';

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
  const delaySeconds = chunkSeconds + 5;

  useEffect(() => {
    setChunks([]);
    setError(null);
    setSessionId(null);
    setKaraoke(IDLE_KARAOKE);
    setSyncReady(false);
    bufferRef.current = null;
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
        setError(null);

        let after = 0;
        while (!cancelled) {
          controller = new AbortController();
          const response = await pollCaptionSession(created.sessionId, after, controller.signal);
          if (cancelled) return;
          if (typeof response.audioBufferedMs === 'number') {
            bufferRef.current = { bufferedMs: response.audioBufferedMs, atMs: performance.now() };
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
    if (!sessionId || paused || !active || !syncReady) {
      onAudioUrlChange(null);
      return;
    }
    onAudioUrlChange(captionSessionAudioUrl(sessionId, delaySeconds));
    return () => onAudioUrlChange(null);
  }, [active, delaySeconds, onAudioUrlChange, paused, sessionId, syncReady]);

  // Karaoke tick: cheap rAF loop mapping audio.currentTime onto the session
  // axis and updating which word span glows. currentTime IS the session
  // clock: the relay serves every connection from session offset 0, so no
  // wall-clock correction is needed (or safe — every client-side estimate
  // of the session start is off by connect/buffer latency).
  useEffect(() => {
    if (!sessionId || paused || !active || !syncReady) {
      setKaraoke(IDLE_KARAOKE);
      return;
    }
    let raf = 0;
    const tick = () => {
      const audio = getAudioElement();
      if (audio && !audio.paused && audio.currentTime > 0) {
        const sessionMs = sessionTimeAt(audio.currentTime);
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
  }, [active, chunks, getAudioElement, paused, sessionId, syncReady]);

  const wordCount = chunks.reduce((total, chunk) => total + chunk.text.split(/\s+/).filter(Boolean).length, 0);
  const activeChunkSeq = karaoke.chunkSeq;
  const activeWordIndex = karaoke.wordIndex;

  const modeFooter = useMemo(() => {
    if (!syncReady) return `synced - buffering ${delaySeconds}s delay (audio stays live meanwhile)`;
    const hasKaraoke = chunks.some((chunk) => Array.isArray(chunk.words) && chunk.words.length > 0);
    return hasKaraoke
      ? `synced - karaoke - audio delayed ${delaySeconds}s`
      : `synced - audio delayed ${delaySeconds}s`;
  }, [chunks, delaySeconds, syncReady]);

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
          const isPlaying = chunk.seq === activeChunkSeq;
          const className =
            `captions__chunk${isLatest ? ' captions__chunk--latest' : ''}` +
            `${isPlaying ? ' captions__chunk--playing' : ''}` +
            `${chunk.text.includes('music') ? ' captions__chunk--music' : ''}`;
          return (
            <p className={className} key={chunk.seq}>
              {renderChunkBody(chunk, isPlaying, isPlaying ? activeWordIndex : -1)}
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

function renderChunkBody(chunk: CaptionChunk, isCurrentChunk: boolean, activeWordIndex: number) {
  const words = chunk.words;
  // Plain text when the provider did not report word timings, or when this
  // chunk is not the one currently playing — already-spoken chunks stay as
  // normal text so only the karaoke line moves.
  if (!isCurrentChunk || !words || words.length === 0) return chunk.text;

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
