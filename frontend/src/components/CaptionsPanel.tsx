import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, getCaptions } from '../api';
import type { Station } from '../types';

interface CaptionChunk {
  id: string;
  text: string;
  capturedAt: string;
}

interface CaptionsPanelProps {
  station: Station;
  active: boolean;
  enabled: boolean;
  paused: boolean;
  chunkSeconds: number;
  onClose: () => void;
}

export function CaptionsPanel({ active, chunkSeconds, enabled, onClose, paused, station }: CaptionsPanelProps) {
  const [chunks, setChunks] = useState<CaptionChunk[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    setChunks([]);
    setError(null);
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
      return;
    }

    let cancelled = false;
    let controller: AbortController | null = null;

    async function loop() {
      while (!cancelled) {
        controller = new AbortController();
        setPending(true);
        try {
          const response = await getCaptions(station.id, controller.signal);
          if (cancelled) return;
          setError(null);
          setChunks((previous) =>
            [
              ...previous,
              {
                id: `${response.capturedAt}-${previous.length}`,
                text: response.text,
                capturedAt: response.capturedAt,
              },
            ].slice(-40),
          );
        } catch (error) {
          if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
          setError(error instanceof ApiError ? error.message : 'Could not load captions.');
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
        } finally {
          if (!cancelled) setPending(false);
        }
      }
    }

    void loop();
    return () => {
      cancelled = true;
      controller?.abort();
    };
  }, [active, enabled, paused, station.id]);

  const wordCount = chunks.reduce((total, chunk) => total + chunk.text.split(/\s+/).filter(Boolean).length, 0);

  return (
    <aside className="captions glass" aria-label="Live captions">
      <header className="captions__header">
        <div>
          <p className="captions__eyebrow">Live captions</p>
          <h2 className="captions__station" title={station.name}>
            {station.name}
          </h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close captions">
          ×
        </button>
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
              chunk.text.includes('music') ? ' captions__chunk--music' : ''
            }`}
            key={chunk.id}
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
        <span>~{chunkSeconds}s behind live</span>
      </footer>
    </aside>
  );
}
