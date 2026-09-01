import type Database from 'better-sqlite3';
import type { Station, StationKind } from '../types.js';

type BetterDatabase = Database.Database;

export interface FavoriteRecord {
  station_id: string;
  station_name: string;
  country: string;
  country_code: string;
  lat: number;
  lon: number;
  kind: StationKind;
  url: string;
  created_at: string;
}

export interface FavoriteInput {
  station: Station;
  userId: string;
  now?: Date;
}

export interface FavoritesStore {
  list(userId: string): FavoriteRecord[];
  add(input: FavoriteInput): FavoriteRecord;
  remove(userId: string, stationId: string): boolean;
  has(userId: string, stationId: string): boolean;
}

/**
 * SQLite-backed favorites store. Kept pure over a Database instance so tests
 * can use an in-memory DB without booting the whole server.
 */
export function createFavoritesStore(db: BetterDatabase): FavoritesStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS favorites (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id),
      station_id   TEXT    NOT NULL,
      station_name TEXT    NOT NULL,
      country      TEXT    NOT NULL DEFAULT '',
      country_code TEXT    NOT NULL DEFAULT '',
      lat          REAL    NOT NULL,
      lon          REAL    NOT NULL,
      kind         TEXT    NOT NULL,
      url          TEXT    NOT NULL,
      created_at   TEXT    NOT NULL,
      UNIQUE (user_id, station_id)
    );

    CREATE INDEX IF NOT EXISTS idx_favorites_user_created
      ON favorites(user_id, created_at);
  `);

  const listStmt = db.prepare(
    `SELECT station_id, station_name, country, country_code, lat, lon, kind, url, created_at
     FROM favorites WHERE user_id = ? ORDER BY created_at DESC`,
  );

  // Idempotent add: re-favoriting an existing station refreshes the snapshot
  // (so a renamed station updates the stored name) but keeps the original
  // created_at so it stays where the user expects in the list.
  const upsertStmt = db.prepare(
    `INSERT INTO favorites
       (user_id, station_id, station_name, country, country_code, lat, lon, kind, url, created_at)
     VALUES (@user_id, @station_id, @station_name, @country, @country_code, @lat, @lon, @kind, @url, @created_at)
     ON CONFLICT(user_id, station_id) DO UPDATE SET
       station_name = excluded.station_name,
       country      = excluded.country,
       country_code = excluded.country_code,
       lat          = excluded.lat,
       lon          = excluded.lon,
       kind         = excluded.kind,
       url          = excluded.url
     RETURNING station_id, station_name, country, country_code, lat, lon, kind, url, created_at`,
  );

  const removeStmt = db.prepare('DELETE FROM favorites WHERE user_id = ? AND station_id = ?');

  const hasStmt = db.prepare(
    'SELECT 1 AS present FROM favorites WHERE user_id = ? AND station_id = ? LIMIT 1',
  );

  return {
    list(userId) {
      return listStmt.all(userId) as FavoriteRecord[];
    },
    add({ station, userId, now = new Date() }) {
      const row = upsertStmt.get({
        user_id: userId,
        station_id: station.id,
        station_name: station.name,
        country: station.country,
        country_code: station.countryCode,
        lat: station.lat,
        lon: station.lon,
        kind: station.kind,
        url: station.url,
        created_at: now.toISOString(),
      }) as FavoriteRecord;
      return row;
    },
    remove(userId, stationId) {
      const info = removeStmt.run(userId, stationId);
      return info.changes > 0;
    },
    has(userId, stationId) {
      return hasStmt.get(userId, stationId) !== undefined;
    },
  };
}
