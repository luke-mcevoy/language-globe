/**
 * Subsolar point maths for the day/night terminator on the globe.
 *
 * NOAA's low-precision solar position algorithm: accurate to a fraction of a
 * degree, which is far beyond what a shader blending two Earth textures needs.
 */

export interface SubsolarPoint {
  /** Latitude of the point where the sun is directly overhead, in degrees. */
  lat: number;
  /** Longitude of that point, in degrees, normalised to [-180, 180]. */
  lng: number;
}

const DEG = 180 / Math.PI;

function normaliseLongitude(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

export function subsolarPoint(date: Date = new Date()): SubsolarPoint {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((date.getTime() - startOfYear) / 86_400_000);
  const hoursUtc = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;

  // Fractional year, in radians.
  const g = ((2 * Math.PI) / 365) * (dayOfYear + (hoursUtc - 12) / 24);

  // Equation of time, in minutes: how far true solar noon drifts from mean noon.
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));

  // Solar declination, in radians.
  const declination =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);

  return {
    lat: declination * DEG,
    lng: normaliseLongitude(-15 * (hoursUtc + eqTime / 60 - 12)),
  };
}
