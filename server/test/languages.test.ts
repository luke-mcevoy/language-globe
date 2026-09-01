import { describe, expect, it } from 'vitest';
import { isLearningLanguage, languageCode, LEARNING_LANGUAGES, normalizeLanguage } from '../src/lib/languages.js';

describe('learning languages', () => {
  it('includes Italian and Spanish', () => {
    const ids = LEARNING_LANGUAGES.map((language) => language.id);
    expect(ids).toContain('spanish');
    expect(ids).toContain('italian');
  });

  it('maps Radio Browser names to whisper codes', () => {
    expect(languageCode('italian')).toBe('it');
    expect(languageCode('spanish')).toBe('es');
    expect(languageCode('mandarin')).toBe('zh');
    expect(languageCode('klingon')).toBeUndefined();
  });

  it('accepts known picker ids case-insensitively', () => {
    expect(isLearningLanguage('Italian')).toBe(true);
    expect(isLearningLanguage('klingon')).toBe(false);
  });

  it('normalizes a request or falls back', () => {
    expect(normalizeLanguage('Italian', 'spanish')).toBe('italian');
    expect(normalizeLanguage('  FR  ', 'spanish')).toBe('spanish');
    expect(normalizeLanguage(undefined, 'italian')).toBe('italian');
    expect(normalizeLanguage('nope', 'also-nope')).toBe('spanish');
  });
});
