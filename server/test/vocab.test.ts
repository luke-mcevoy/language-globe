import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createVocabStore, normalizeWord, type VocabStore } from '../src/lib/vocab.js';
import { parseWordTranslation } from '../src/lib/prompts.js';

describe('normalizeWord', () => {
  it('lowercases and strips surrounding punctuation', () => {
    expect(normalizeWord('¡Sacude!')).toBe('sacude');
    expect(normalizeWord('  "Hola",')).toBe('hola');
    expect(normalizeWord('años')).toBe('años');
  });

  it('keeps inner punctuation so hyphenated words stay whole', () => {
    expect(normalizeWord('vis-à-vis')).toBe('vis-à-vis');
  });

  it('returns empty for punctuation-only tokens', () => {
    expect(normalizeWord('—')).toBe('');
    expect(normalizeWord('...')).toBe('');
  });
});

describe('vocab store', () => {
  let db: Database.Database;
  let store: VocabStore;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
             INSERT INTO users (id, name, created_at) VALUES (1, 'you', '2026-01-01T00:00:00Z');`);
    store = createVocabStore(db);
  });

  afterEach(() => db.close());

  const input = {
    userId: '1',
    word: 'sacude',
    translation: 'shakes',
    note: 'verb, from sacudir (to shake)',
    context: 'el viento sacude los árboles',
    stationName: 'Radio Uno',
  };

  it('records a first lookup', () => {
    const record = store.record({ ...input, now: new Date('2026-08-26T10:00:00Z') });
    expect(record.word).toBe('sacude');
    expect(record.translation).toBe('shakes');
    expect(record.times_looked_up).toBe(1);
    expect(record.created_at).toBe('2026-08-26T10:00:00.000Z');
  });

  it('treats re-lookups of the same word as one entry with a bumped counter', () => {
    store.record({ ...input, now: new Date('2026-08-26T10:00:00Z') });
    const second = store.record({
      ...input,
      word: '¡Sacude!',
      context: 'otra frase con sacude',
      now: new Date('2026-08-26T11:00:00Z'),
    });
    expect(second.times_looked_up).toBe(2);
    expect(second.context).toBe('otra frase con sacude');
    // First-seen date survives the update.
    expect(second.created_at).toBe('2026-08-26T10:00:00.000Z');
    expect(second.last_looked_up_at).toBe('2026-08-26T11:00:00.000Z');
    expect(store.list('1')).toHaveLength(1);
  });

  it('lists newest lookups first', () => {
    store.record({ ...input, word: 'uno', now: new Date('2026-08-26T10:00:00Z') });
    store.record({ ...input, word: 'dos', now: new Date('2026-08-26T11:00:00Z') });
    expect(store.list('1').map((row) => row.word)).toEqual(['dos', 'uno']);
  });

  it('scopes entries to the user and removes by id', () => {
    const record = store.record(input);
    expect(store.list('2')).toHaveLength(0);
    expect(store.remove('2', record.id)).toBe(false);
    expect(store.remove('1', record.id)).toBe(true);
    expect(store.list('1')).toHaveLength(0);
  });
});

describe('parseWordTranslation', () => {
  it('accepts a valid payload and trims fields', () => {
    expect(parseWordTranslation({ translation: ' shakes ', note: ' verb ' })).toEqual({
      translation: 'shakes',
      note: 'verb',
    });
  });

  it('tolerates a missing note', () => {
    expect(parseWordTranslation({ translation: 'shakes' })).toEqual({ translation: 'shakes', note: '' });
  });

  it('rejects payloads without a translation', () => {
    expect(parseWordTranslation({ note: 'verb' })).toBeNull();
    expect(parseWordTranslation({ translation: '   ' })).toBeNull();
    expect(parseWordTranslation(null)).toBeNull();
    expect(parseWordTranslation('shakes')).toBeNull();
  });
});
