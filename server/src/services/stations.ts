import { config } from '../config.js';
import { readStationsCache, writeStationsCache } from '../db.js';
import { classifyStation, parseTags } from '../lib/classify.js';
import type { Station, StationsResponse } from '../types.js';

const SEARCH_URL = 'https://all.api.radio-browser.info/json/stations/search';
const STATION_LIMIT = 1500;

interface RadioBrowserStation {
  stationuuid?: string;
  name?: string;
  url?: string;
  url_resolved?: string;
  homepage?: string;
  favicon?: string;
  tags?: string;
  country?: string;
  countrycode?: string;
  state?: string;
  language?: string;
  votes?: number;
  clickcount?: number;
  codec?: string;
  bitrate?: number;
  geo_lat?: number | null;
  geo_long?: number | null;
  lastcheckok?: number;
}

function normalise(raw: RadioBrowserStation): Station | null {
  const id = raw.stationuuid;
  const url = raw.url_resolved || raw.url;
  const lat = raw.geo_lat;
  const lon = raw.geo_long;

  // Without an id, a playable URL, or coordinates there is nothing to put on
  // the globe, so drop the entry rather than rendering a broken pin.
  if (!id || !url || typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  const tags = parseTags(raw.tags);
  const name = (raw.name ?? '').trim() || 'Unnamed station';

  return {
    id,
    name,
    url,
    homepage: raw.homepage ?? '',
    favicon: raw.favicon ?? '',
    tags,
    country: raw.country ?? '',
    countryCode: (raw.countrycode ?? '').toUpperCase(),
    state: raw.state ?? '',
    language: raw.language ?? '',
    lat,
    lon,
    clickcount: raw.clickcount ?? 0,
    votes: raw.votes ?? 0,
    codec: (raw.codec ?? '').toUpperCase(),
    bitrate: raw.bitrate ?? 0,
    kind: classifyStation(tags, name),
    reachable: raw.lastcheckok !== 0,
  };
}

/**
 * Radio Browser regularly lists the same station under several uuids (one per
 * stream URL). Keep the most-clicked copy of each name+country pair.
 */
function dedupe(stations: Station[]): Station[] {
  const best = new Map<string, Station>();
  for (const station of stations) {
    const key = `${station.name.toLowerCase()}|${station.countryCode}`;
    const existing = best.get(key);
    if (!existing || station.clickcount > existing.clickcount) best.set(key, station);
  }
  return [...best.values()].sort((a, b) => b.clickcount - a.clickcount);
}

async function fetchFromRadioBrowser(language: string): Promise<Station[]> {
  const params = new URLSearchParams({
    language,
    has_geo_info: 'true',
    hidebroken: 'true',
    order: 'clickcount',
    reverse: 'true',
    limit: String(STATION_LIMIT),
  });

  const response = await fetch(`${SEARCH_URL}?${params.toString()}`, {
    headers: { 'User-Agent': config.userAgent, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Radio Browser responded ${response.status}`);

  const payload = (await response.json()) as RadioBrowserStation[];
  if (!Array.isArray(payload)) throw new Error('Radio Browser returned an unexpected payload');

  return dedupe(payload.map(normalise).filter((station): station is Station => station !== null));
}

interface CacheEntry {
  stations: Station[];
  fetchedAt: number;
}

const memoryCache = new Map<string, CacheEntry>();
/** Collapses concurrent cold-start requests into one upstream fetch. */
const inflight = new Map<string, Promise<Station[]>>();

function cacheKey(language: string): string {
  return `stations:${language}`;
}

function loadFromSqlite(language: string): CacheEntry | null {
  const row = readStationsCache(cacheKey(language));
  if (!row) return null;
  try {
    const stations = JSON.parse(row.payload) as Station[];
    if (!Array.isArray(stations)) return null;
    return { stations, fetchedAt: row.fetchedAt };
  } catch {
    return null;
  }
}

export async function getStations(language = config.targetLanguage): Promise<StationsResponse> {
  const key = cacheKey(language);
  const cached = memoryCache.get(key) ?? loadFromSqlite(language);
  if (cached) memoryCache.set(key, cached);

  const fresh = cached !== null && cached !== undefined && Date.now() - cached.fetchedAt < config.stationsCacheTtlMs;
  if (cached && fresh) {
    return { stations: cached.stations, language, fetchedAt: cached.fetchedAt, stale: false };
  }

  let pending = inflight.get(key);
  if (!pending) {
    pending = fetchFromRadioBrowser(language);
    inflight.set(key, pending);
    pending.finally(() => inflight.delete(key));
  }

  try {
    const stations = await pending;
    const fetchedAt = Date.now();
    memoryCache.set(key, { stations, fetchedAt });
    writeStationsCache(key, JSON.stringify(stations), fetchedAt);
    return { stations, language, fetchedAt, stale: false };
  } catch (error) {
    // A stale cache beats an empty globe; only a cold failure is fatal.
    if (cached) return { stations: cached.stations, language, fetchedAt: cached.fetchedAt, stale: true };
    throw error;
  }
}

export async function findStation(stationId: string, language?: string): Promise<Station | undefined> {
  if (language) {
    const { stations } = await getStations(language);
    const hit = stations.find((station) => station.id === stationId);
    if (hit) return hit;
  }
  for (const entry of memoryCache.values()) {
    const hit = entry.stations.find((station) => station.id === stationId);
    if (hit) return hit;
  }
  const { stations } = await getStations();
  return stations.find((station) => station.id === stationId);
}

/**
 * Best talk-radio alternative when the current station turns out to be music:
 * same country if possible, otherwise the most popular talk station anywhere.
 */
export function suggestTalkStation(stations: Station[], near: Station | undefined): Station | null {
  const talk = stations.filter((station) => station.kind === 'talk' && station.id !== near?.id);
  if (talk.length === 0) return null;
  const sameCountry = near ? talk.filter((station) => station.countryCode === near.countryCode) : [];
  const pool = sameCountry.length > 0 ? sameCountry : talk;
  return pool[0] ?? null;
}
