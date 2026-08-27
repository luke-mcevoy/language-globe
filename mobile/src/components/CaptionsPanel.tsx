import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError, pollCaptionSession, startCaptionSession, stopCaptionSession } from '../lib/api';
import type { CaptionChunk, Station } from '../types';

interface CaptionsPanelProps {
  station: Station | null;
  visible: boolean;
  enabled: boolean;
  paused: boolean;
  chunkSeconds: number;
  onClose: () => void;
}

export function CaptionsPanel({ chunkSeconds, enabled, onClose, paused, station, visible }: CaptionsPanelProps) {
  const [chunks, setChunks] = useState<CaptionChunk[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    setChunks([]);
    setError(null);
  }, [station?.id]);

  useEffect(() => {
    if (!visible || !enabled || paused || !station) {
      setPending(false);
      return;
    }

    const stationId = station.id;
    let cancelled = false;
    let session: string | null = null;
    let controller: AbortController | null = null;

    async function loop() {
      setPending(true);
      try {
        controller = new AbortController();
        const created = await startCaptionSession(stationId, controller.signal);
        session = created.sessionId;
        if (cancelled) {
          // Cleanup ran before the id arrived; release the session ourselves.
          void stopCaptionSession(created.sessionId).catch(() => undefined);
          return;
        }
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
        if (cancelled || (error instanceof Error && error.name === 'AbortError')) return;
        setError(error instanceof ApiError ? error.message : 'Could not load captions.');
        setPending(false);
      }
    }

    void loop();
    return () => {
      cancelled = true;
      controller?.abort();
      if (session) void stopCaptionSession(session).catch(() => undefined);
    };
  }, [enabled, paused, station, visible]);

  if (!visible || !station) return null;

  const wordCount = chunks.reduce((total, chunk) => total + chunk.text.split(/\s+/).filter(Boolean).length, 0);

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
      <ScrollView
        ref={scrollRef}
        style={styles.feed}
        contentContainerStyle={styles.feedContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {chunks.length === 0 && !pending && !paused && !error && (
          <Text style={styles.empty}>Waiting for the next spoken chunk...</Text>
        )}
        {chunks.map((chunk, index) => (
          <Text
            key={chunk.seq}
            style={[
              styles.chunk,
              index === chunks.length - 1 && styles.latest,
              chunk.text.includes('music') && styles.music,
            ]}
          >
            {chunk.text}
          </Text>
        ))}
        {paused && <Text style={styles.paused}>Paused while the quiz captures this station.</Text>}
        {error && <Text style={styles.error}>{error}</Text>}
        {pending && <Text style={styles.pending}>...</Text>}
      </ScrollView>
      <View style={styles.footer}>
        <Text style={styles.footerText}>{wordCount} words</Text>
        <Text style={styles.footerText}>session polling · ~{chunkSeconds}s capture windows</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 168,
    maxHeight: 300,
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
  music: {
    color: '#7f8ba6',
    fontStyle: 'italic',
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
});
