const REGIONAL_INDICATOR_A = 0x1f1e6;
const LETTER_A = 'A'.charCodeAt(0);

/** ISO-3166 alpha-2 to flag emoji. Returns a globe for anything unexpected. */
export function flagEmoji(countryCode: string): string {
  const code = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '🌐';
  return String.fromCodePoint(
    ...[...code].map((letter) => REGIONAL_INDICATOR_A + (letter.charCodeAt(0) - LETTER_A)),
  );
}

/**
 * Approximate wall-clock time at a longitude. Real timezones follow borders,
 * not meridians, so this is deliberately labelled "solar time" in the UI —
 * it is a feel-of-place detail, not a schedule.
 */
export function localTimeAt(lon: number, now: Date = new Date()): string {
  const offsetHours = Math.round(lon / 15);
  const shifted = new Date(now.getTime() + offsetHours * 3_600_000);
  const hours = String(shifted.getUTCHours()).padStart(2, '0');
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** Rough day/night flag for a longitude, used to tint the station's clock. */
export function isDaytimeAt(lon: number, now: Date = new Date()): boolean {
  const hour = Number(localTimeAt(lon, now).slice(0, 2));
  return hour >= 7 && hour < 20;
}

export function formatPercent(value: number | null, digits = 0): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatCompact(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

/** "2026-08-26" -> "26 Aug", for chart ticks. */
export function shortDate(isoDate: string): string {
  const [, month, day] = isoDate.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthIndex = Number(month) - 1;
  return `${Number(day)} ${months[monthIndex] ?? ''}`.trim();
}

export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
