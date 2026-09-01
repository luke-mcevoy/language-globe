import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  captionSessionAudioUrl,
  lookupWord,
  pollCaptionSession,
  startCaptionSession,
  stopCaptionSession,
} from '../api';
import { findActiveChunk, findActiveWordIndex, sessionTimeAt } from '../lib/captionSync';
import type { CaptionChunk, Station, VocabEntry } from '../types';

interface CaptionsPanelProps {
  station: Station;
  language: string;
  active: boolean;
  enabled: boolean;
  paused: boolean;
  chunkSeconds: number;
  onClose: () => void;
  onAudioUrlChange: (url: string | null) => void;
  getAudioElement: () => HTMLAudioElement | null;
  onPauseAudio: () => void;
  onResumeAudio: () => void;
}

interface WordLookup {
  word: string;
  status: 'loading' | 'ready' | 'error';
  entry?: VocabEntry;
  saved?: boolean;
  message?: string;
  /** Popover anchor in viewport coordinates (position: fixed). */
  top: number;
  left: number;
}

type SubtitleView =
  | { kind: 'sync' }
  | { kind: 'music'; seq: number }
  | { kind: 'chunk'; chunk: CaptionChunk };

function subtitleViewKey(view: SubtitleView): string {
  if (view.kind === 'sync') return 'sync';
  if (view.kind === 'music') return `music-${view.seq}`;
  return `chunk-${view.chunk.seq}`;
}

/** Strip surrounding punctuation: clicking "¡Sacude!" looks up "Sacude". */
function cleanWord(raw: string): string {
  return raw.replace(/^[\s\p{P}\p{S}]+/u, '').replace(/[\s\p{P}\p{S}]+$/u, '');
}

interface KaraokeState {
  chunkSeq: number | null;
  wordIndex: number;
}

const IDLE_KARAOKE: KaraokeState = { chunkSeq: null, wordIndex: -1 };

/** Matches MUSIC_CAPTION_TEXT on the server (lib/captions.ts). */
const MUSIC_TEXT = '♪ music ♪';

/**
 * Buffer this much past the relay delay before switching audio over, so the
 * relay can hand the <audio> element several seconds instantly and playback
 * starts right away instead of trickling in.
 */
const SYNC_MARGIN_MS = 8_000;

type FeedItem =
  | { kind: 'chunk'; chunk: CaptionChunk }
  | { kind: 'music'; seq: number; count: number };

export function CaptionsPanel({
  active,
  chunkSeconds,
  enabled,
  getAudioElement,
  language,
  onAudioUrlChange,
  onClose,
  onPauseAudio,
  onResumeAudio,
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
  const [syncProgress, setSyncProgress] = useState(0);
  const [bufferVersion, setBufferVersion] = useState(0);
  const [pinned, setPinned] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [lookup, setLookup] = useState<WordLookup | null>(null);
  const [exitingView, setExitingView] = useState<SubtitleView | null>(null);
  const bufferRef = useRef<{ bufferedMs: number; atMs: number } | null>(null);
  /** When the session was created — seeds the sync bar before the first poll reports real buffer fill. */
  const sessionStartRef = useRef<number | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const prevSubtitleKeyRef = useRef<string | null>(null);
  const delaySeconds = chunkSeconds + 5;

  useEffect(() => {
    setChunks([]);
    setError(null);
    setSessionId(null);
    setKaraoke(IDLE_KARAOKE);
    setSyncReady(false);
    setSyncProgress(0);
    setPinned(true);
    setHistoryOpen(false);
    setLookup(null);
    setExitingView(null);
    bufferRef.current = null;
    pinnedRef.current = true;
    prevSubtitleKeyRef.current = null;
  }, [station.id]);

  const handleWordClick = useCallback(
    (raw: string, context: string, target: HTMLElement) => {
      const word = cleanWord(raw);
      if (word.length === 0) return;
      onPauseAudio();

      const wordRect = target.getBoundingClientRect();
      const left = Math.min(Math.max(wordRect.left + wordRect.width / 2, 140), window.innerWidth - 140);
      const top = Math.max(wordRect.top, 72);

      setLookup({ word, status: 'loading', top, left });
      lookupWord(word, context, station.name, language)
        .then((response) =>
          setLookup((current) =>
            current?.word === word
              ? { ...current, status: 'ready', entry: response.entry, saved: response.saved }
              : current,
          ),
        )
        .catch((error: unknown) =>
          setLookup((current) =>
            current?.word === word
              ? {
                  ...current,
                  status: 'error',
                  message: error instanceof ApiError ? error.message : 'Translation failed. Try again.',
                }
              : current,
          ),
        );
    },
    [language, onPauseAudio, station.name],
  );

  const closeLookup = useCallback(
    (resume: boolean) => {
      setLookup(null);
      if (resume) onResumeAudio();
    },
    [onResumeAudio],
  );

  useEffect(() => {
    if (!lookup) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeLookup(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeLookup, lookup]);

  const pinToBottom = useCallback(() => {
    const feed = feedRef.current;
    if (!feed || !pinnedRef.current) return;
    feed.scrollTop = feed.scrollHeight;
  }, []);

  useEffect(() => {
    pinToBottom();
  }, [chunks, historyOpen, pending, pinToBottom]);

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
        const created = await startCaptionSession(station.id, language);
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
        sessionStartRef.current = performance.now();
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
  }, [active, enabled, language, onAudioUrlChange, paused, station.id]);

  // Flip syncReady once the relay buffer covers the delay (extrapolating
  // between polls, since long-polls can be 25s apart).
  useEffect(() => {
    if (syncReady || !sessionId) return;
    const buffer = bufferRef.current;
    if (!buffer) return;
    const bufferedNow = buffer.bufferedMs + (performance.now() - buffer.atMs);
    const remainingMs = delaySeconds * 1000 + SYNC_MARGIN_MS - bufferedNow;
    if (remainingMs <= 0) {
      setSyncReady(true);
      return;
    }
    const timer = window.setTimeout(() => setSyncReady(true), remainingMs);
    return () => window.clearTimeout(timer);
  }, [bufferVersion, delaySeconds, sessionId, syncReady]);

  // Animate the sync progress bar while buffering (poll data only arrives
  // every long-poll, so extrapolate between reports).
  useEffect(() => {
    if (!sessionId || syncReady) return;
    const targetMs = delaySeconds * 1000 + SYNC_MARGIN_MS;
    const timer = window.setInterval(() => {
      const buffer = bufferRef.current;
      // Before the first poll reports real buffer fill, estimate from elapsed
      // time (minus the ~3s burst window the server discards) so the bar
      // moves right away instead of sitting at 0% for the first chunk.
      const bufferedNow = buffer
        ? buffer.bufferedMs + (performance.now() - buffer.atMs)
        : sessionStartRef.current !== null
          ? Math.max(0, performance.now() - sessionStartRef.current - 3_000)
          : 0;
      setSyncProgress(Math.min(1, bufferedNow / targetMs));
    }, 250);
    return () => window.clearInterval(timer);
  }, [delaySeconds, sessionId, syncReady]);

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
  const activeChunk = useMemo(
    () => chunks.find((chunk) => chunk.seq === activeChunkSeq) ?? null,
    [activeChunkSeq, chunks],
  );

  const subtitleView = useMemo<SubtitleView | null>(() => {
    if (!syncReady && !error) return { kind: 'sync' };
    if (!activeChunk) return null;
    if (activeChunk.text === MUSIC_TEXT) return { kind: 'music', seq: activeChunk.seq };
    return { kind: 'chunk', chunk: activeChunk };
  }, [activeChunk, error, syncReady]);

  const subtitleKey = subtitleView ? subtitleViewKey(subtitleView) : null;

  useEffect(() => {
    const previousKey = prevSubtitleKeyRef.current;
    prevSubtitleKeyRef.current = subtitleKey;
    if (previousKey === null || previousKey === subtitleKey) return;

    if (previousKey === 'sync') {
      setExitingView({ kind: 'sync' });
      return;
    }
    if (previousKey.startsWith('music-')) {
      const seq = Number(previousKey.slice('music-'.length));
      if (Number.isFinite(seq)) setExitingView({ kind: 'music', seq });
      return;
    }
    if (previousKey.startsWith('chunk-')) {
      const seq = Number(previousKey.slice('chunk-'.length));
      const chunk = chunks.find((item) => item.seq === seq);
      if (chunk) setExitingView({ kind: 'chunk', chunk });
    }
  }, [chunks, subtitleKey]);

  useEffect(() => {
    if (!exitingView) return;
    const timer = window.setTimeout(() => setExitingView(null), 300);
    return () => window.clearTimeout(timer);
  }, [exitingView]);

  // Collapse runs of "♪ music ♪" chunks into one quiet row — five identical
  // lines of music markers were noise that pushed real speech off screen.
  const feedItems = useMemo(() => {
    const items: FeedItem[] = [];
    for (const chunk of chunks) {
      const last = items[items.length - 1];
      if (chunk.text === MUSIC_TEXT) {
        if (last?.kind === 'music') {
          last.count += 1;
          last.seq = chunk.seq;
        } else {
          items.push({ kind: 'music', seq: chunk.seq, count: 1 });
        }
      } else {
        items.push({ kind: 'chunk', chunk });
      }
    }
    return items;
  }, [chunks]);

  const status = !syncReady
    ? 'syncing audio to captions'
    : `karaoke · audio ${delaySeconds}s behind live`;

  const jumpToLatest = useCallback(() => {
    const feed = feedRef.current;
    if (!feed) return;
    pinnedRef.current = true;
    setPinned(true);
    feed.scrollTop = feed.scrollHeight;
  }, []);

  const syncPct = Math.round(syncProgress * 100);

  return (
    <>
      <div className="subtitles" aria-live="polite">
        <div className="subtitles__stage">
          {exitingView && (
            <div
              key={`out-${subtitleViewKey(exitingView)}`}
              className="subtitles__layer subtitles__layer--out"
              aria-hidden="true"
            >
              {renderSubtitleView(exitingView, -1, handleWordClick, syncPct)}
            </div>
          )}
          {subtitleView && (
            <div key={subtitleViewKey(subtitleView)} className="subtitles__layer subtitles__layer--in">
              {renderSubtitleView(subtitleView, activeWordIndex, handleWordClick, syncPct)}
            </div>
          )}
        </div>
      </div>

      {lookup && (
        <div
          className="word-popover"
          style={{ top: lookup.top, left: lookup.left }}
          role="dialog"
          aria-label={`Translation of ${lookup.word}`}
        >
          <p className="word-popover__word">{lookup.word}</p>
          {lookup.status === 'loading' && <p className="word-popover__muted">translating…</p>}
          {lookup.status === 'error' && <p className="word-popover__error">{lookup.message}</p>}
          {lookup.status === 'ready' && lookup.entry && (
            <>
              <p className="word-popover__translation">{lookup.entry.translation}</p>
              {lookup.entry.note && <p className="word-popover__note">{lookup.entry.note}</p>}
              <p className="word-popover__saved">
                {lookup.saved
                  ? `✓ Saved to your vocab${lookup.entry.timesLookedUp > 1 ? ` · looked up ${lookup.entry.timesLookedUp}×` : ''}`
                  : 'Sign in to save words you look up'}
              </p>
            </>
          )}
          <div className="word-popover__actions">
            <button type="button" className="word-popover__resume" onClick={() => closeLookup(true)}>
              ▶ Resume
            </button>
            <button type="button" className="word-popover__close" onClick={() => closeLookup(false)}>
              Close
            </button>
          </div>
        </div>
      )}

      <aside
        className={`captions glass${historyOpen ? ' captions--expanded' : ' captions--collapsed'}`}
        aria-label="Live captions"
      >
        <header className="captions__header">
          <div className="captions__identity">
            <p className="captions__eyebrow">Live captions</p>
            <h2 className="captions__station" title={station.name}>
              {station.name}
            </h2>
          </div>
          <div className="captions__controls">
            <span className="captions__compact-stat" title={status}>
              {syncReady ? 'live' : `${syncPct}%`}
            </span>
            <span className="captions__compact-stat">{wordCount} words</span>
            <button
              type="button"
              className="icon-button captions__toggle"
              onClick={() => setHistoryOpen((open) => !open)}
              aria-expanded={historyOpen}
              aria-label={historyOpen ? 'Hide caption history' : 'Show caption history'}
            >
              {historyOpen ? '▴' : '▾'}
            </button>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close captions">
              ×
            </button>
          </div>
        </header>

        {historyOpen && (
          <>
            {!syncReady && !error && (
              <div className="captions__sync" role="status">
                <span>Syncing audio</span>
                <div className="captions__sync-track" aria-hidden="true">
                  <div className="captions__sync-fill" style={{ width: `${syncPct}%` }} />
                </div>
                <span className="captions__sync-pct">{syncPct}%</span>
              </div>
            )}

            <div
              className="captions__feed"
              ref={feedRef}
              onScroll={(event) => {
                const feed = event.currentTarget;
                const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 24;
                pinnedRef.current = atBottom;
                setPinned(atBottom);
              }}
            >
              {chunks.length === 0 && !pending && !paused && !error && (
                <p className="captions__empty">Listening for speech…</p>
              )}
              {feedItems.map((item, index) => {
                const isLatest = index === feedItems.length - 1;
                if (item.kind === 'music') {
                  return (
                    <p className="captions__music" key={`music-${item.seq}`}>
                      {MUSIC_TEXT}
                    </p>
                  );
                }
                const { chunk } = item;
                const isPlaying = chunk.seq === activeChunkSeq;
                const className =
                  `captions__chunk${isLatest ? ' captions__chunk--latest' : ''}` +
                  `${isPlaying ? ' captions__chunk--playing' : ''}`;
                return (
                  <p className={className} key={chunk.seq}>
                    {renderChunkBody(chunk, isPlaying, isPlaying ? activeWordIndex : -1, handleWordClick)}
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

            {!pinned && (
              <button type="button" className="captions__jump" onClick={jumpToLatest}>
                ↓ Latest
              </button>
            )}

            <footer className="captions__footer">
              <span>{wordCount} words</span>
              <span className={syncReady ? 'captions__status captions__status--live' : 'captions__status'}>{status}</span>
            </footer>
          </>
        )}
      </aside>
    </>
  );
}

type WordClickHandler = (word: string, context: string, target: HTMLElement) => void;

function renderSubtitleView(
  view: SubtitleView,
  activeWordIndex: number,
  onWordClick: WordClickHandler,
  syncPct: number,
) {
  if (view.kind === 'sync') {
    return (
      <div className="subtitles__pill subtitles__pill--sync" role="status">
        <span>Syncing audio</span>
        <div className="subtitles__sync-track" aria-hidden="true">
          <div className="subtitles__sync-fill" style={{ width: `${syncPct}%` }} />
        </div>
        <span className="subtitles__sync-pct">{syncPct}%</span>
      </div>
    );
  }
  if (view.kind === 'music') {
    return (
      <div className="subtitles__pill subtitles__pill--music">
        <span>♪ música</span>
      </div>
    );
  }
  return (
    <p className="subtitles__line">
      {renderSubtitleBody(view.chunk, activeWordIndex, onWordClick)}
    </p>
  );
}

function renderSubtitleBody(chunk: CaptionChunk, activeWordIndex: number, onWordClick: WordClickHandler) {
  const words = chunk.words;
  if (!words || words.length === 0) {
    return chunk.text.split(/(\s+)/).map((token, index) =>
      /\S/.test(token) ? (
        <span
          key={index}
          className="subtitles__word subtitles__word--past subtitles__word--clickable"
          onClick={(event) => onWordClick(token, chunk.text, event.currentTarget)}
        >
          {token}
        </span>
      ) : (
        token
      ),
    );
  }

  return words.map((word, index) => {
    const state: 'past' | 'current' | 'future' =
      index < activeWordIndex ? 'past' : index === activeWordIndex ? 'current' : 'future';
    return (
      <span key={index}>
        <span
          className={`subtitles__word subtitles__word--${state} subtitles__word--clickable`}
          onClick={(event) => onWordClick(word.word, chunk.text, event.currentTarget)}
        >
          {word.word}
        </span>
        {index < words.length - 1 ? ' ' : ''}
      </span>
    );
  });
}

function renderChunkBody(
  chunk: CaptionChunk,
  isCurrentChunk: boolean,
  activeWordIndex: number,
  onWordClick: WordClickHandler,
) {
  const words = chunk.words;
  // Chunks without karaoke timing (and already-spoken chunks) render as plain
  // tokens — still clickable for lookup, just without highlight state.
  if (!isCurrentChunk || !words || words.length === 0) {
    return chunk.text.split(/(\s+)/).map((token, index) =>
      /\S/.test(token) ? (
        <span
          key={index}
          className="captions__word captions__word--clickable"
          onClick={(event) => onWordClick(token, chunk.text, event.currentTarget)}
        >
          {token}
        </span>
      ) : (
        token
      ),
    );
  }

  return words.map((word, index) => {
    const state: 'past' | 'current' | 'future' =
      index < activeWordIndex ? 'past' : index === activeWordIndex ? 'current' : 'future';
    // The separating space lives OUTSIDE the highlighted span: the current
    // word's pill background would otherwise swallow the space plus the
    // first letter of the next word (its negative margin pulls the following
    // text under the pill).
    return (
      <span key={index}>
        <span
          className={`captions__word captions__word--${state} captions__word--clickable`}
          onClick={(event) => onWordClick(word.word, chunk.text, event.currentTarget)}
        >
          {word.word}
        </span>
        {index < words.length - 1 ? ' ' : ''}
      </span>
    );
  });
}
