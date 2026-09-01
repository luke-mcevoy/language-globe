import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  ApiError,
  captionSessionAudioUrl,
  lookupWord,
  pollCaptionSession,
  startCaptionSession,
  stopCaptionSession,
} from '../lib/api';
import { findActiveChunk, findActiveWordIndex, sessionTimeAt } from '../lib/captionSync';
import type { CaptionChunk, Station, VocabEntry } from '../types';

interface CaptionsPanelProps {
  station: Station | null;
  language: string;
  visible: boolean;
  enabled: boolean;
  paused: boolean;
  chunkSeconds: number;
  onClose: () => void;
  onAudioUrlChange: (url: string | null) => void;
  onPauseAudio: () => void;
  onResumeAudio: () => void;
  playback: {
    currentTime: number;
    playing: boolean;
    receivedAtMs: number;
  };
}

interface KaraokeState {
  chunkSeq: number | null;
  wordIndex: number;
}

type FeedItem =
  | { kind: 'chunk'; chunk: CaptionChunk }
  | { kind: 'music'; seq: number; count: number };

interface WordLookup {
  word: string;
  status: 'loading' | 'ready' | 'error';
  entry?: VocabEntry;
  saved?: boolean;
  message?: string;
}

const IDLE_KARAOKE: KaraokeState = { chunkSeq: null, wordIndex: -1 };
const MUSIC_TEXT = '♪ music ♪';
const SYNC_MARGIN_MS = 8_000;

/** Strip surrounding punctuation: tapping "¡Sacude!" looks up "Sacude". */
function cleanWord(raw: string): string {
  return raw.replace(/^[\s\p{P}\p{S}]+/u, '').replace(/[\s\p{P}\p{S}]+$/u, '');
}

export function CaptionsPanel({
  chunkSeconds,
  enabled,
  language,
  onAudioUrlChange,
  onClose,
  onPauseAudio,
  onResumeAudio,
  paused,
  playback,
  station,
  visible,
}: CaptionsPanelProps) {
  const [chunks, setChunks] = useState<CaptionChunk[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [karaoke, setKaraoke] = useState<KaraokeState>(IDLE_KARAOKE);
  const [syncReady, setSyncReady] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [bufferVersion, setBufferVersion] = useState(0);
  const [lookup, setLookup] = useState<WordLookup | null>(null);
  const bufferRef = useRef<{ bufferedMs: number; atMs: number } | null>(null);
  const sessionStartRef = useRef<number | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const delaySeconds = chunkSeconds + 5;
  const stationName = station?.name ?? '';

  useEffect(() => {
    setChunks([]);
    setError(null);
    setSessionId(null);
    setKaraoke(IDLE_KARAOKE);
    setSyncReady(false);
    setSyncProgress(0);
    setLookup(null);
    bufferRef.current = null;
    sessionStartRef.current = null;
  }, [station?.id]);

  useEffect(() => {
    if (!visible || !enabled || paused || !station) {
      setPending(false);
      setSessionId(null);
      setKaraoke(IDLE_KARAOKE);
      setSyncReady(false);
      setSyncProgress(0);
      bufferRef.current = null;
      sessionStartRef.current = null;
      onAudioUrlChange(null);
      return;
    }

    const stationId = station.id;
    let cancelled = false;
    let session: string | null = null;
    let controller: AbortController | null = null;

    async function loop() {
      setPending(true);
      try {
        // Not abortable: an aborted create leaks the session server-side
        // because we never learn the id we would need to delete.
        const created = await startCaptionSession(stationId, language);
        session = created.sessionId;
        if (cancelled) {
          // Cleanup ran before the id arrived; release the session ourselves.
          void stopCaptionSession(created.sessionId).catch(() => undefined);
          return;
        }
        setSessionId(created.sessionId);
        setSyncReady(false);
        setSyncProgress(0);
        bufferRef.current = null;
        sessionStartRef.current = Date.now();
        setError(null);

        let after = 0;
        while (!cancelled) {
          controller = new AbortController();
          const response = await pollCaptionSession(created.sessionId, after, controller.signal);
          if (cancelled) return;
          if (typeof response.audioBufferedMs === 'number') {
            bufferRef.current = { bufferedMs: response.audioBufferedMs, atMs: Date.now() };
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
        if (cancelled || (error instanceof Error && error.name === 'AbortError')) return;
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
  }, [enabled, language, onAudioUrlChange, paused, station, visible]);

  useEffect(() => {
    if (syncReady || !sessionId) return;
    const buffer = bufferRef.current;
    if (!buffer) return;
    const bufferedNow = buffer.bufferedMs + (Date.now() - buffer.atMs);
    const remainingMs = delaySeconds * 1000 + SYNC_MARGIN_MS - bufferedNow;
    if (remainingMs <= 0) {
      setSyncReady(true);
      return;
    }
    const timer = setTimeout(() => setSyncReady(true), remainingMs);
    return () => clearTimeout(timer);
  }, [bufferVersion, delaySeconds, sessionId, syncReady]);

  useEffect(() => {
    if (!sessionId || syncReady) return;
    const targetMs = delaySeconds * 1000 + SYNC_MARGIN_MS;
    const timer = setInterval(() => {
      const buffer = bufferRef.current;
      const bufferedNow = buffer
        ? buffer.bufferedMs + (Date.now() - buffer.atMs)
        : sessionStartRef.current !== null
          ? Math.max(0, Date.now() - sessionStartRef.current - 3_000)
          : 0;
      setSyncProgress(Math.min(1, bufferedNow / targetMs));
    }, 250);
    return () => clearInterval(timer);
  }, [delaySeconds, sessionId, syncReady]);

  useEffect(() => {
    if (!sessionId || paused || !visible || !syncReady) {
      onAudioUrlChange(null);
      return;
    }
    onAudioUrlChange(captionSessionAudioUrl(sessionId, delaySeconds));
    return () => onAudioUrlChange(null);
  }, [delaySeconds, onAudioUrlChange, paused, sessionId, syncReady, visible]);

  useEffect(() => {
    if (!sessionId || paused || !visible || !syncReady) {
      setKaraoke(IDLE_KARAOKE);
      return;
    }
    const timer = setInterval(() => {
      const elapsedSinceStatusSeconds = playback.playing ? Math.min(Date.now() - playback.receivedAtMs, 600) / 1000 : 0;
      const sessionMs = sessionTimeAt(playback.currentTime + elapsedSinceStatusSeconds);
      const chunk = findActiveChunk(chunks, sessionMs);
      if (chunk?.words && chunk.words.length > 0) {
        const idx = findActiveWordIndex(chunk.words, sessionMs);
        setKaraoke((previous) =>
          previous.chunkSeq === chunk.seq && previous.wordIndex === idx ? previous : { chunkSeq: chunk.seq, wordIndex: idx },
        );
      } else if (chunk) {
        setKaraoke((previous) =>
          previous.chunkSeq === chunk.seq && previous.wordIndex === -1
            ? previous
            : { chunkSeq: chunk.seq, wordIndex: -1 },
        );
      } else {
        setKaraoke((previous) => (previous.chunkSeq === null && previous.wordIndex === -1 ? previous : IDLE_KARAOKE));
      }
    }, 150);
    return () => clearInterval(timer);
  }, [chunks, paused, playback.currentTime, playback.playing, playback.receivedAtMs, sessionId, syncReady, visible]);

  const handleWordTap = useCallback(
    (raw: string, context: string) => {
      const word = cleanWord(raw);
      if (word.length === 0) return;
      onPauseAudio();
      setLookup({ word, status: 'loading' });
      lookupWord(word, context, stationName, language)
        .then((response) =>
          setLookup((current) =>
            current?.word === word
              ? { ...current, status: 'ready', entry: response.entry, saved: response.saved }
              : current,
          ),
        )
        .catch((err: unknown) =>
          setLookup((current) =>
            current?.word === word
              ? {
                  ...current,
                  status: 'error',
                  message: err instanceof ApiError ? err.message : 'Translation failed. Try again.',
                }
              : current,
          ),
        );
    },
    [language, onPauseAudio, stationName],
  );

  const closeLookup = useCallback(
    (resume: boolean) => {
      setLookup(null);
      if (resume) onResumeAudio();
    },
    [onResumeAudio],
  );

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
  const wordCount = chunks.reduce((total, chunk) => total + chunk.text.split(/\s+/).filter(Boolean).length, 0);
  const activeChunkSeq = karaoke.chunkSeq;
  const activeWordIndex = karaoke.wordIndex;
  const status = syncReady ? `karaoke · audio ${delaySeconds}s behind live` : 'syncing audio to captions';

  if (!visible || !station) return null;

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>Live captions</Text>
          <Text style={styles.title} numberOfLines={1}>
            {station.name}
          </Text>
        </View>
        <Pressable style={styles.closeButton} onPress={onClose}>
          <Text style={styles.closeText}>×</Text>
        </Pressable>
      </View>
      {!syncReady && !error && (
        <View style={styles.syncRow}>
          <Text style={styles.syncText}>Syncing audio</Text>
          <View style={styles.syncTrack}>
            <View style={[styles.syncFill, { width: `${Math.round(syncProgress * 100)}%` }]} />
          </View>
          <Text style={styles.syncPercent}>{Math.round(syncProgress * 100)}%</Text>
        </View>
      )}
      <ScrollView
        ref={scrollRef}
        style={styles.feed}
        contentContainerStyle={styles.feedContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {chunks.length === 0 && !pending && !paused && !error && (
          <Text style={styles.empty}>Listening for speech...</Text>
        )}
        {feedItems.map((item, index) => {
          if (item.kind === 'music') {
            return (
              <Text key={`music-${item.seq}`} style={styles.music}>
                {MUSIC_TEXT}
              </Text>
            );
          }
          const isLatest = index === feedItems.length - 1;
          const isPlaying = item.chunk.seq === activeChunkSeq;
          return (
            <Text key={item.chunk.seq} style={[styles.chunk, isLatest && styles.latest, isPlaying && styles.playingChunk]}>
              {renderChunkBody(item.chunk, isPlaying, isPlaying ? activeWordIndex : -1, handleWordTap)}
            </Text>
          );
        })}
        {paused && <Text style={styles.paused}>Paused while the quiz captures this station.</Text>}
        {error && <Text style={styles.error}>{error}</Text>}
        {pending && <Text style={styles.pending}>...</Text>}
      </ScrollView>
      {lookup && (
        <View style={styles.lookupSheet}>
          <Text style={styles.lookupWord}>{lookup.word}</Text>
          {lookup.status === 'loading' && <Text style={styles.lookupMuted}>translating…</Text>}
          {lookup.status === 'error' && <Text style={styles.lookupErrorText}>{lookup.message}</Text>}
          {lookup.status === 'ready' && lookup.entry && (
            <>
              <Text style={styles.lookupTranslation}>{lookup.entry.translation}</Text>
              {lookup.entry.note ? <Text style={styles.lookupNote}>{lookup.entry.note}</Text> : null}
              <Text style={styles.lookupSaved}>
                {lookup.saved
                  ? `✓ Saved to your vocab${lookup.entry.timesLookedUp > 1 ? ` · looked up ${lookup.entry.timesLookedUp}×` : ''}`
                  : 'Sign in to save words you look up'}
              </Text>
            </>
          )}
          <View style={styles.lookupActions}>
            <Pressable style={[styles.lookupButton, styles.lookupResume]} onPress={() => closeLookup(true)}>
              <Text style={styles.lookupResumeText}>▶ Resume</Text>
            </Pressable>
            <Pressable style={styles.lookupButton} onPress={() => closeLookup(false)}>
              <Text style={styles.lookupCloseText}>Close</Text>
            </Pressable>
          </View>
        </View>
      )}
      <View style={styles.footer}>
        <Text style={styles.footerText}>{wordCount} words</Text>
        <Text style={[styles.footerText, syncReady && styles.footerLive]}>{status}</Text>
      </View>
    </View>
  );
}

type WordTapHandler = (raw: string, context: string) => void;

function renderChunkBody(
  chunk: CaptionChunk,
  isCurrentChunk: boolean,
  activeWordIndex: number,
  onWord: WordTapHandler,
) {
  const words = chunk.words;
  if (isCurrentChunk && words && words.length > 0) {
    return words.map((word, index) => {
      const stateStyle =
        index < activeWordIndex ? styles.wordPast : index === activeWordIndex ? styles.wordCurrent : styles.wordFuture;
      return (
        <Text key={`${chunk.seq}-${index}`}>
          <Text style={[styles.word, stateStyle]} onPress={() => onWord(word.word, chunk.text)}>
            {word.word}
          </Text>
          {index < words.length - 1 ? ' ' : ''}
        </Text>
      );
    });
  }
  // Non-karaoke chunks: split plain text on whitespace so each token stays
  // tappable for lookup even without word-level timing.
  return chunk.text.split(/(\s+)/).map((token, index) => {
    if (!/\S/.test(token)) return token;
    return (
      <Text key={`${chunk.seq}-${index}`} onPress={() => onWord(token, chunk.text)}>
        {token}
      </Text>
    );
  });
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 168,
    maxHeight: 380,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(9, 14, 29, 0.92)',
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.09)',
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: '#54e6c3',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1.6,
  },
  title: {
    color: '#f7fbff',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 2,
  },
  closeButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  closeText: {
    color: '#dbe7ff',
    fontSize: 22,
    lineHeight: 24,
  },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.09)',
  },
  syncText: {
    color: '#d7dff2',
    fontSize: 12,
    fontWeight: '800',
  },
  syncTrack: {
    flex: 1,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  syncFill: {
    height: 7,
    borderRadius: 4,
    backgroundColor: '#54e6c3',
  },
  syncPercent: {
    width: 34,
    textAlign: 'right',
    color: '#7f8ba6',
    fontSize: 12,
    fontWeight: '800',
  },
  feed: {
    minHeight: 136,
  },
  feedContent: {
    padding: 14,
  },
  empty: {
    color: '#7f8ba6',
    fontSize: 13,
  },
  chunk: {
    color: '#b8c4de',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 10,
  },
  latest: {
    color: '#f7fbff',
    fontSize: 16,
  },
  playingChunk: {
    color: '#d7dff2',
  },
  music: {
    color: '#7f8ba6',
    fontStyle: 'italic',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 10,
  },
  word: {
    fontSize: 16,
    lineHeight: 24,
  },
  wordPast: {
    color: '#7f8ba6',
  },
  wordFuture: {
    color: '#d7dff2',
  },
  // No fontWeight change here: bolding the active word widens it and
  // reflows the whole paragraph on every word advance (visible jitter).
  wordCurrent: {
    color: '#052019',
    backgroundColor: '#54e6c3',
    borderRadius: 5,
    overflow: 'hidden',
  },
  paused: {
    color: '#ffe59d',
    fontSize: 13,
  },
  error: {
    color: '#ff9aac',
    fontSize: 13,
  },
  pending: {
    color: '#54e6c3',
    fontSize: 20,
    lineHeight: 22,
  },
  lookupSheet: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.09)',
    backgroundColor: 'rgba(5, 32, 25, 0.55)',
    gap: 6,
  },
  lookupWord: {
    color: '#54e6c3',
    fontSize: 17,
    fontWeight: '900',
  },
  lookupMuted: {
    color: '#7f8ba6',
    fontSize: 13,
    fontStyle: 'italic',
  },
  lookupErrorText: {
    color: '#ff9aac',
    fontSize: 13,
  },
  lookupTranslation: {
    color: '#f7fbff',
    fontSize: 15,
    fontWeight: '700',
  },
  lookupNote: {
    color: '#aebbd5',
    fontSize: 13,
    lineHeight: 18,
  },
  lookupSaved: {
    color: '#54e6c3',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 2,
  },
  lookupActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  lookupButton: {
    flex: 1,
    minHeight: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
  },
  lookupResume: {
    backgroundColor: '#54e6c3',
    borderColor: '#54e6c3',
  },
  lookupResumeText: {
    color: '#052019',
    fontWeight: '900',
  },
  lookupCloseText: {
    color: '#dbe7ff',
    fontWeight: '800',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.09)',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  footerText: {
    color: '#7f8ba6',
    fontSize: 11,
  },
  footerLive: {
    color: '#54e6c3',
  },
});
