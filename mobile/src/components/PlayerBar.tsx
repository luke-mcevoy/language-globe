import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { flagEmoji, isDaytimeAt, localTimeAt } from '../lib/format';
import type { Radio } from '../hooks/useRadio';

interface PlayerBarProps {
  radio: Radio;
  captionsEnabled: boolean;
  captionsOpen: boolean;
  quizEnabled: boolean;
  quizOpen: boolean;
  onCaptions: () => void;
  onQuiz: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  idle: 'Nothing playing',
  loading: 'Connecting...',
  playing: 'On air',
  paused: 'Paused',
  error: 'Stream failed',
};

export function PlayerBar({ captionsEnabled, captionsOpen, onCaptions, onQuiz, quizEnabled, quizOpen, radio }: PlayerBarProps) {
  const now = useClock();
  const { station, status } = radio;

  if (!station) {
    return (
      <View style={[styles.bar, styles.emptyBar]}>
        <Text style={styles.emptyText}>Pick a glowing station or tap Surprise.</Text>
      </View>
    );
  }

  const place = [station.state, station.country].filter(Boolean).join(', ');
  const daytime = isDaytimeAt(station.lon, now);

  return (
    <View style={styles.bar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={status === 'playing' ? 'Pause' : 'Play'}
        style={({ pressed }) => [styles.playButton, pressed && styles.pressed]}
        onPress={status === 'error' ? radio.retry : radio.toggle}
      >
        <Text style={styles.playIcon}>{status === 'playing' ? 'II' : status === 'error' ? '↻' : '▶'}</Text>
      </Pressable>

      <View style={styles.identity}>
        <View style={styles.nameRow}>
          <View style={[styles.pulse, styles[`pulse_${status}`] ?? styles.pulse_idle]} />
          <Text style={styles.name} numberOfLines={1}>
            {station.name}
          </Text>
          <Text style={styles.codec}>{station.codec || 'stream'}</Text>
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {flagEmoji(station.countryCode)} {place || 'Unknown location'} · {daytime ? 'sun' : 'moon'}{' '}
          {localTimeAt(station.lon, now)} local
        </Text>
        <Text style={[styles.status, status === 'error' && styles.statusError]} numberOfLines={1}>
          {radio.error ?? STATUS_LABEL[status] ?? ''}
        </Text>
        {station.tags.length > 0 && (
          <Text style={styles.tags} numberOfLines={1}>
            {station.tags.slice(0, 3).join(' · ')}
          </Text>
        )}
      </View>

      <View style={styles.controls}>
        <Pressable style={styles.smallButton} onPress={radio.toggleMute} accessibilityRole="button">
          <Text style={styles.smallButtonText}>{radio.muted ? 'Muted' : `${Math.round(radio.volume * 100)}%`}</Text>
        </Pressable>
        <View style={styles.volumeRow}>
          <Pressable style={styles.volumeButton} onPress={() => radio.setVolume(radio.volume - 0.1)}>
            <Text style={styles.volumeText}>-</Text>
          </Pressable>
          <Pressable style={styles.volumeButton} onPress={() => radio.setVolume(radio.volume + 0.1)}>
            <Text style={styles.volumeText}>+</Text>
          </Pressable>
        </View>
        <Pressable
          style={[styles.ccButton, captionsOpen && styles.ccButtonActive, !captionsEnabled && styles.disabled]}
          onPress={onCaptions}
          disabled={!captionsEnabled}
          accessibilityRole="button"
          accessibilityState={{ selected: captionsOpen, disabled: !captionsEnabled }}
        >
          <Text style={[styles.ccText, captionsOpen && styles.ccTextActive]}>CC</Text>
        </Pressable>
        <Pressable
          style={[styles.quizButton, (!quizEnabled || quizOpen) && styles.disabled]}
          onPress={onQuiz}
          disabled={!quizEnabled || quizOpen}
          accessibilityRole="button"
          accessibilityState={{ disabled: !quizEnabled || quizOpen }}
        >
          <Text style={styles.quizText}>Quiz</Text>
        </Pressable>
      </View>
    </View>
  );
}

function useClock(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 24,
    minHeight: 126,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(9, 14, 29, 0.88)',
    borderRadius: 18,
    padding: 12,
    flexDirection: 'row',
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 20,
  },
  emptyBar: {
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#c6d0e7',
    fontSize: 14,
  },
  playButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#54e6c3',
  },
  pressed: {
    opacity: 0.78,
  },
  playIcon: {
    color: '#07101a',
    fontWeight: '800',
    fontSize: 17,
  },
  identity: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  pulse: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  pulse_idle: {
    backgroundColor: '#65708b',
  },
  pulse_loading: {
    backgroundColor: '#ffe59d',
  },
  pulse_playing: {
    backgroundColor: '#54e6c3',
  },
  pulse_paused: {
    backgroundColor: '#8d7dff',
  },
  pulse_error: {
    backgroundColor: '#ff6f91',
  },
  name: {
    flex: 1,
    color: '#f7fbff',
    fontSize: 16,
    fontWeight: '800',
  },
  codec: {
    color: '#7f8ba6',
    fontSize: 10,
    textTransform: 'uppercase',
  },
  meta: {
    color: '#b8c4de',
    fontSize: 12,
    marginTop: 5,
  },
  status: {
    color: '#7f8ba6',
    fontSize: 12,
    marginTop: 5,
  },
  statusError: {
    color: '#ff9aac',
  },
  tags: {
    color: '#98a4bf',
    fontSize: 11,
    marginTop: 5,
  },
  controls: {
    width: 72,
    gap: 7,
  },
  smallButton: {
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  smallButtonText: {
    color: '#dbe7ff',
    fontSize: 11,
    fontWeight: '700',
  },
  volumeRow: {
    flexDirection: 'row',
    gap: 6,
  },
  volumeButton: {
    flex: 1,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  volumeText: {
    color: '#dbe7ff',
    fontSize: 16,
    fontWeight: '700',
  },
  quizButton: {
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8d7dff',
  },
  quizText: {
    color: '#ffffff',
    fontWeight: '800',
  },
  ccButton: {
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  ccButtonActive: {
    backgroundColor: '#54e6c3',
  },
  ccText: {
    color: '#dbe7ff',
    fontWeight: '900',
    fontSize: 12,
  },
  ccTextActive: {
    color: '#07101a',
  },
  disabled: {
    opacity: 0.45,
  },
});
