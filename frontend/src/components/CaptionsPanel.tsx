import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  captionSessionAudioUrl,
  pollCaptionSession,
  startCaptionSession,
  stopCaptionSession,
} from '../api';
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
}

export function CaptionsPanel({
  active,
  chunkSeconds,
  enabled,
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
  const feedRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const delaySeconds = chunkSeconds + 5;

  useEffect(() => {
    setChunks([]);
    setError(null);
    setSessionId(null);
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
      onAudioUrlChange(null);
      return;
    }

    let cancelled = false;
    let session: string | null = null;
    let controller: AbortController | null = null;

    async function loop() {
      setPending(true);
      try {
        controller = new AbortController();
        const created = await startCaptionSession(station.id, controller.signal);
        session = created.sessionId;
        if (cancelled) {
          // The panel closed while the create was in flight; the cleanup ran
          // before we knew the id, so release the session ourselves.
          void stopCaptionSession(created.sessionId).catch(() => undefined);
          return;
        }
        setSessionId(created.sessionId);
        setError(null);

        let after = 0;
        while (!cancelled) {
          controller = new AbortController();
          const response = await pollCaptionSession(created.sessionId, after, controller.signal);
          if (cancelled) return;
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

  useEffect(() => {
    if (!sessionId || mode !== 'synced' || paused || !active) {
      onAudioUrlChange(null);
      return;
    }
    onAudioUrlChange(captionSessionAudioUrl(sessionId, delaySeconds));
    return () => onAudioUrlChange(null);
  }, [active, delaySeconds, mode, onAudioUrlChange, paused, sessionId]);

  const wordCount = chunks.reduce((total, chunk) => total + chunk.text.split(/\s+/).filter(Boolean).length, 0);
  const playingSeq = useMemo(() => (mode === 'synced' ? chunks[chunks.length - 1]?.seq : null), [chunks, mode]);

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
        {chunks.map((chunk, index) => (
          <p
            className={`captions__chunk${index === chunks.length - 1 ? ' captions__chunk--latest' : ''}${
              chunk.seq === playingSeq ? ' captions__chunk--playing' : ''
            }${chunk.text.includes('music') ? ' captions__chunk--music' : ''}`}
            key={chunk.seq}
          >
            {chunk.text}
          </p>
        ))}
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
        <span>{mode === 'synced' ? `synced - audio delayed ${delaySeconds}s` : 'live captions'}</span>
      </footer>
    </aside>
  );
}
