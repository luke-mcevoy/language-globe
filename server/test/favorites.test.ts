import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFavoritesStore, type FavoritesStore } from '../src/lib/favorites.js';
import type { Station } from '../src/types.js';

function makeStation(overrides: Partial<Station> = {}): Station {
  return {
    id: 'station-1',
    name: 'Radio Nacional',
    url: 'https://example.com/stream.mp3',
    homepage: 'https://example.com',
    favicon: '',
    tags: ['news'],
    country: 'Spain',
    countryCode: 'ES',
    state: '',
    language: 'spanish',
    lat: 40.4,
    lon: -3.7,
    clickcount: 100,
    votes: 20,
    codec: 'MP3',
    bitrate: 128,
    kind: 'talk',
    reachable: true,
    ...overrides,
  };
}

/**
 * `favorites` references `users(id)`, so tests need the users table around
 * even though the FK is not enforced without a PRAGMA. Real code always has
 * it because db.ts creates it before the store.
 */
function freshStore(): FavoritesStore {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
    INSERT INTO users (id, name, created_at) VALUES (1, 'you', '2026-01-01T00:00:00.000Z');
  `);
  return createFavoritesStore(db);
}

describe('favoritesStore', () => {
  let store: FavoritesStore;

  beforeEach(() => {
    store = freshStore();
  });

  it('starts empty and reports has() = false for anything', () => {
    expect(store.list(1)).toEqual([]);
    expect(store.has(1, 'station-1')).toBe(false);
  });

  it('adds a station and lists it back with the snapshot fields', () => {
    const now = new Date('2026-08-27T10:00:00.000Z');
    const record = store.add({ station: makeStation(), userId: 1, now });

    expect(record).toMatchObject({
      station_id: 'station-1',
      station_name: 'Radio Nacional',
      country: 'Spain',
      country_code: 'ES',
      lat: 40.4,
      lon: -3.7,
      kind: 'talk',
      url: 'https://example.com/stream.mp3',
      created_at: '2026-08-27T10:00:00.000Z',
    });
    expect(store.has(1, 'station-1')).toBe(true);
    expect(store.list(1)).toHaveLength(1);
  });

  it('is idempotent on re-add: refreshes the snapshot but keeps created_at', () => {
    const first = store.add({
      station: makeStation({ name: 'Old Name' }),
      userId: 1,
      now: new Date('2026-08-01T00:00:00.000Z'),
    });
    const second = store.add({
      station: makeStation({ name: 'New Name', country: 'Argentina', countryCode: 'AR' }),
      userId: 1,
      now: new Date('2026-08-27T00:00:00.000Z'),
    });

    expect(second.created_at).toBe(first.created_at);
    expect(second.station_name).toBe('New Name');
    expect(second.country).toBe('Argentina');
    expect(store.list(1)).toHaveLength(1);
  });

  it('removes a station and reports whether anything was removed', () => {
    store.add({ station: makeStation(), userId: 1 });

    expect(store.remove(1, 'station-1')).toBe(true);
    expect(store.remove(1, 'station-1')).toBe(false);
    expect(store.list(1)).toEqual([]);
    expect(store.has(1, 'station-1')).toBe(false);
  });

  it('lists newest first so the panel shows recent picks at the top', () => {
    store.add({
      station: makeStation({ id: 'a', name: 'A' }),
      userId: 1,
      now: new Date('2026-08-01T00:00:00.000Z'),
    });
    store.add({
      station: makeStation({ id: 'b', name: 'B' }),
      userId: 1,
      now: new Date('2026-08-15T00:00:00.000Z'),
    });
    store.add({
      station: makeStation({ id: 'c', name: 'C' }),
      userId: 1,
      now: new Date('2026-08-02T00:00:00.000Z'),
    });

    expect(store.list(1).map((row) => row.station_id)).toEqual(['b', 'c', 'a']);
  });

  it('scopes list/has/remove to a single user_id', () => {
    // Fresh DB with two user rows so this test does not lean on the shared
    // `store` (which only has user 1).
    const second = 2;
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO users (id, name, created_at) VALUES (1, 'you', '2026-01-01T00:00:00.000Z');
      INSERT INTO users (id, name, created_at) VALUES (2, 'them', '2026-01-01T00:00:00.000Z');
    `);
    const shared = createFavoritesStore(db);

    shared.add({ station: makeStation({ id: 'mine' }), userId: 1 });
    shared.add({ station: makeStation({ id: 'theirs' }), userId: second });

    expect(shared.list(1).map((r) => r.station_id)).toEqual(['mine']);
    expect(shared.list(second).map((r) => r.station_id)).toEqual(['theirs']);
    expect(shared.has(1, 'theirs')).toBe(false);
    expect(shared.remove(1, 'theirs')).toBe(false);
    expect(shared.list(second)).toHaveLength(1);
  });
});
