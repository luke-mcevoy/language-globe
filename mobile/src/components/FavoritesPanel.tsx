import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { flagEmoji, isDaytimeAt, localTimeAt, titleCase } from '../lib/format';
import type { Favorite, Station } from '../types';

interface FavoritesPanelProps {
  visible: boolean;
  favorites: Favorite[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onTune: (station: Station) => void;
  onRemove: (stationId: string) => void;
}

function useClock(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function FavoritesPanel({ error, favorites, loading, onClose, onRemove, onTune, visible }: FavoritesPanelProps) {
  const now = useClock();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>Your favorites</Text>
              <Text style={styles.title}>Saved stations</Text>
            </View>
            <Pressable style={styles.closeButton} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close favorites">
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>

          {loading && (
            <View style={styles.center}>
              <ActivityIndicator color="#54e6c3" />
              <Text style={styles.centerDetail}>Loading your favorites...</Text>
            </View>
          )}

          {error && !loading && (
            <View style={styles.center}>
              <Text style={styles.centerTitle}>Could not load favorites</Text>
              <Text style={styles.centerDetail}>{error}</Text>
            </View>
          )}

          {!loading && !error && favorites.length === 0 && (
            <View style={styles.center}>
              <Text style={styles.emptyMark}>♥</Text>
              <Text style={styles.centerTitle}>No favorites yet</Text>
              <Text style={styles.centerDetail}>
                Tap the heart in the player bar to save a station. Favorites show up here and glow gold on the globe.
              </Text>
            </View>
          )}

          {!loading && !error && favorites.length > 0 && (
            <ScrollView contentContainerStyle={styles.list}>
              {favorites.map((favorite) => {
                const { station } = favorite;
                const place = [station.state, station.country].filter(Boolean).join(', ');
                const daytime = isDaytimeAt(station.lon, now);
                return (
                  <View style={styles.row} key={station.id}>
                    <Pressable
                      style={({ pressed }) => [styles.tune, pressed && styles.pressed]}
                      onPress={() => onTune(station)}
                      accessibilityRole="button"
                      accessibilityLabel={`Tune to ${station.name}`}
                    >
                      <Text style={styles.flag}>{flagEmoji(station.countryCode)}</Text>
                      <View style={styles.body}>
                        <Text style={styles.name} numberOfLines={1}>
                          {station.name}
                        </Text>
                        <Text style={styles.meta} numberOfLines={1}>
                          {place || 'Unknown location'} · {daytime ? 'sun' : 'moon'} {localTimeAt(station.lon, now)}{' '}
                          · <Text style={styles.kindHint}>{titleCase(station.kind)}</Text>
                          {favorite.missing ? <Text style={styles.missing}> · offline in the index</Text> : null}
                        </Text>
                      </View>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
                      onPress={() => onRemove(station.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${station.name} from favorites`}
                    >
                      <Text style={styles.removeText}>♥</Text>
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.52)',
    padding: 14,
    justifyContent: 'center',
  },
  panel: {
    maxHeight: '88%',
    borderRadius: 22,
    backgroundColor: '#0a0f1d',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 18,
  },
  eyebrow: {
    color: '#54e6c3',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '700',
  },
  title: {
    color: '#f7fbff',
    fontSize: 22,
    fontWeight: '900',
    marginTop: 3,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  closeText: {
    color: '#dce7ff',
    fontSize: 26,
    lineHeight: 28,
  },
  list: {
    padding: 12,
    paddingTop: 0,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  tune: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  pressed: {
    opacity: 0.78,
  },
  flag: {
    fontSize: 24,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: '#f7fbff',
    fontSize: 15,
    fontWeight: '700',
  },
  meta: {
    color: '#8f9bb6',
    fontSize: 12,
    marginTop: 2,
  },
  kindHint: {
    color: '#c4cfe8',
    fontWeight: '700',
  },
  missing: {
    color: '#ff9aac',
  },
  remove: {
    width: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,207,106,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,207,106,0.35)',
  },
  removeText: {
    color: '#ffcf6a',
    fontSize: 20,
    fontWeight: '900',
  },
  center: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 10,
  },
  centerTitle: {
    color: '#f7fbff',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  centerDetail: {
    color: '#aebbd5',
    textAlign: 'center',
    lineHeight: 21,
  },
  emptyMark: {
    fontSize: 36,
    color: '#ffcf6a',
  },
});
