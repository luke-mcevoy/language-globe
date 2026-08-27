import { describe, expect, it } from 'vitest';
import { subsolarPoint } from './solar';
import { flagEmoji, formatCompact, formatPercent, localTimeAt, shortDate } from './format';

describe('subsolarPoint', () => {
  it('puts the sun over the equator at the March equinox', () => {
    const { lat } = subsolarPoint(new Date('2026-03-20T12:00:00Z'));
    expect(Math.abs(lat)).toBeLessThan(1);
  });

  it('reaches the tropics at the solstices', () => {
    expect(subsolarPoint(new Date('2026-06-21T12:00:00Z')).lat).toBeCloseTo(23.4, 0);
    expect(subsolarPoint(new Date('2026-12-21T12:00:00Z')).lat).toBeCloseTo(-23.4, 0);
  });

  it('tracks the prime meridian at UTC noon', () => {
    const { lng } = subsolarPoint(new Date('2026-06-21T12:00:00Z'));
    expect(Math.abs(lng)).toBeLessThan(5);
  });

  it('moves 15 degrees west per hour', () => {
    const noon = subsolarPoint(new Date('2026-06-21T12:00:00Z')).lng;
    const later = subsolarPoint(new Date('2026-06-21T15:00:00Z')).lng;
    expect(noon - later).toBeCloseTo(45, 0);
  });

  it('keeps longitude inside [-180, 180]', () => {
    for (let hour = 0; hour < 24; hour++) {
      const { lng } = subsolarPoint(new Date(Date.UTC(2026, 7, 26, hour)));
      expect(lng).toBeGreaterThanOrEqual(-180);
      expect(lng).toBeLessThanOrEqual(180);
    }
  });
});

describe('formatting helpers', () => {
  it('turns country codes into flags', () => {
    expect(flagEmoji('ES')).toBe('🇪🇸');
    expect(flagEmoji('mx')).toBe('🇲🇽');
    expect(flagEmoji('')).toBe('🌐');
    expect(flagEmoji('XYZ')).toBe('🌐');
  });

  it('shifts local time by longitude', () => {
    const noonUtc = new Date('2026-08-26T12:00:00Z');
    expect(localTimeAt(0, noonUtc)).toBe('12:00');
    expect(localTimeAt(-75, noonUtc)).toBe('07:00');
    expect(localTimeAt(150, noonUtc)).toBe('22:00');
  });

  it('formats percentages and compact numbers', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(0.755, 1)).toBe('75.5%');
    expect(formatCompact(999)).toBe('999');
    expect(formatCompact(1500)).toBe('1.5k');
    expect(formatCompact(2_400_000)).toBe('2.4M');
  });

  it('shortens ISO dates for chart ticks', () => {
    expect(shortDate('2026-08-26')).toBe('26 Aug');
  });
});
