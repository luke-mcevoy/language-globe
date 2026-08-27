import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { flagEmoji, formatCompact, formatPercent, shortDate } from '../lib/format';
import type { StatsResponse } from '../types';

interface StatsPanelProps {
  visible: boolean;
  stats: StatsResponse | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

export function StatsPanel({ visible, stats, loading, error, onClose }: StatsPanelProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>Your progress</Text>
              <Text style={styles.title}>Listening passport</Text>
            </View>
            <Pressable style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>
          {loading && <Center title="Reading your history..." />}
          {error && !loading && <Center title="Could not load your stats" detail={error} />}
          {stats && !loading && !error && <StatsBody stats={stats} />}
        </View>
      </View>
    </Modal>
  );
}

function StatsBody({ stats }: { stats: StatsResponse }) {
  if (stats.totals.quizzes === 0) {
    return (
      <Center
        title="No quizzes yet"
        detail="Tune into a talk station, tap Quiz, and your accuracy, streak and passport will start filling in."
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <View style={styles.tiles}>
        <Tile label="Quizzes" value={String(stats.totals.quizzes)} />
        <Tile label="Accuracy" value={formatPercent(stats.totals.accuracy)} />
        <Tile label="Streak" value={`${stats.streak.current}d`} />
        <Tile label="Countries" value={String(stats.totals.countriesVisited)} />
        <Tile label="Words" value={formatCompact(stats.totals.wordsHeard)} />
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Accuracy, last 30 days</Text>
          <Text style={styles.sectionNote}>{stats.daily.filter((day) => day.accuracy !== null).length} days</Text>
        </View>
        <AccuracyChart stats={stats} />
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Passport</Text>
          <Text style={styles.sectionNote}>{stats.countries.length} stamped</Text>
        </View>
        <View style={styles.passport}>
          {stats.countries.map((country) => (
            <View style={styles.stamp} key={country.countryCode}>
              <Text style={styles.flag}>{flagEmoji(country.countryCode)}</Text>
              <Text style={styles.code}>{country.countryCode}</Text>
              <Text style={styles.count}>{country.attempts} quiz</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>By country</Text>
        {stats.countries.map((country) => (
          <View style={styles.countryRow} key={country.countryCode}>
            <Text style={styles.countryName} numberOfLines={1}>
              {flagEmoji(country.countryCode)} {country.country}
            </Text>
            <Text style={styles.countryMeta}>
              {country.attempts} · {formatPercent(country.accuracy)}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function AccuracyChart({ stats }: { stats: StatsResponse }) {
  const width = 320;
  const height = 178;
  const pad = 28;
  const points = stats.daily
    .map((day, index) => {
      if (day.accuracy === null) return null;
      const x = pad + (index / Math.max(1, stats.daily.length - 1)) * (width - pad * 1.5);
      const y = pad + (1 - day.accuracy) * (height - pad * 2);
      return { x, y, day };
    })
    .filter((point): point is { x: number; y: number; day: StatsResponse['daily'][number] } => point !== null);

  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');

  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
      {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
        const y = pad + (1 - tick) * (height - pad * 2);
        return (
          <Line key={tick} x1={pad} x2={width - 16} y1={y} y2={y} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
        );
      })}
      <SvgText x={pad} y={height - 8} fill="#7f8ba6" fontSize={10}>
        {shortDate(stats.daily[0]?.date ?? '')}
      </SvgText>
      <SvgText x={width - 58} y={height - 8} fill="#7f8ba6" fontSize={10}>
        {shortDate(stats.daily[stats.daily.length - 1]?.date ?? '')}
      </SvgText>
      {path.length > 0 && <Path d={path} fill="none" stroke="#54e6c3" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />}
      {points.map((point) => (
        <Circle key={point.day.date} cx={point.x} cy={point.y} r={3.4} fill="#54e6c3" />
      ))}
    </Svg>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
    </View>
  );
}

function Center({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.centerTitle}>{title}</Text>
      {detail && <Text style={styles.centerDetail}>{detail}</Text>}
    </View>
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
  body: {
    padding: 18,
    paddingTop: 0,
    gap: 18,
  },
  center: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 12,
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
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tile: {
    width: '31%',
    minWidth: 92,
    borderRadius: 16,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  tileLabel: {
    color: '#8f9bb6',
    fontSize: 11,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  tileValue: {
    color: '#f7fbff',
    fontSize: 21,
    fontWeight: '900',
    marginTop: 6,
  },
  section: {
    gap: 12,
  },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    color: '#f7fbff',
    fontSize: 16,
    fontWeight: '800',
  },
  sectionNote: {
    color: '#8f9bb6',
    fontSize: 12,
  },
  passport: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  stamp: {
    width: 86,
    borderRadius: 14,
    padding: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  flag: {
    fontSize: 26,
  },
  code: {
    color: '#f7fbff',
    fontWeight: '900',
    marginTop: 3,
  },
  count: {
    color: '#8f9bb6',
    fontSize: 11,
    marginTop: 2,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    paddingVertical: 10,
    gap: 12,
  },
  countryName: {
    flex: 1,
    color: '#dbe7ff',
    fontSize: 14,
  },
  countryMeta: {
    color: '#54e6c3',
    fontWeight: '800',
  },
});
