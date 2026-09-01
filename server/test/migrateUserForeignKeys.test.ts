import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrateLegacyUserForeignKeys } from '../src/lib/migrateUserForeignKeys.js';

describe('migrateLegacyUserForeignKeys', () => {
  it('lets a UUID account favorite after the users_legacy rename', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE users_legacy (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO users_legacy (id, name, created_at) VALUES (1, 'you', '2026-01-01T00:00:00.000Z');
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO users (id, username, display_name, password_hash, created_at)
        VALUES ('e863ecb6-eaf1-4b22-8502-dc0ee069d62c', 'lmcevoy1', 'lmcevoy1', 'x', '2026-01-01T00:00:00.000Z');
      CREATE TABLE favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users_legacy(id),
        station_id TEXT NOT NULL,
        station_name TEXT NOT NULL,
        country TEXT NOT NULL DEFAULT '',
        country_code TEXT NOT NULL DEFAULT '',
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        kind TEXT NOT NULL,
        url TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (user_id, station_id)
      );
    `);

    const uuid = 'e863ecb6-eaf1-4b22-8502-dc0ee069d62c';
    const insert = db.prepare(
      `INSERT INTO favorites (user_id, station_id, station_name, country, country_code, lat, lon, kind, url, created_at)
       VALUES (?, 'st-1', 'Radio Nacional', 'Spain', 'ES', 40, -3, 'talk', 'http://x', '2026-01-01T00:00:00.000Z')`,
    );
    expect(() => insert.run(uuid)).toThrow(/FOREIGN KEY/);

    migrateLegacyUserForeignKeys(db);

    const insertAfter = db.prepare(
      `INSERT INTO favorites (user_id, station_id, station_name, country, country_code, lat, lon, kind, url, created_at)
       VALUES (?, 'st-1', 'Radio Nacional', 'Spain', 'ES', 40, -3, 'talk', 'http://x', '2026-01-01T00:00:00.000Z')`,
    );
    expect(() => insertAfter.run(uuid)).not.toThrow();
    const row = db.prepare('SELECT user_id, station_id FROM favorites').get() as {
      user_id: string;
      station_id: string;
    };
    expect(row).toEqual({ user_id: uuid, station_id: 'st-1' });
  });
});
