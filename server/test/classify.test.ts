import { describe, expect, it } from 'vitest';
import { classifyStation, parseTags } from '../src/lib/classify.js';
import { cleanTranscript, countWords } from '../src/lib/text.js';

describe('classifyStation', () => {
  it('recognises talk stations across languages', () => {
    expect(classifyStation(['noticias', 'actualidad'])).toBe('talk');
    expect(classifyStation(['news', 'public radio'])).toBe('talk');
    expect(classifyStation([], 'Radio Nacional Noticias')).toBe('talk');
  });

  it('recognises music stations', () => {
    expect(classifyStation(['reggaeton', 'hits'])).toBe('music');
    expect(classifyStation(['música', 'baladas'])).toBe('music');
  });

  it('prefers talk when a station is tagged as both', () => {
    expect(classifyStation(['music', 'news'])).toBe('talk');
  });

  it('falls back to unknown', () => {
    expect(classifyStation([])).toBe('unknown');
    expect(classifyStation(['fm', '99.9'])).toBe('unknown');
  });
});

describe('parseTags', () => {
  it('splits, trims and caps the tag list', () => {
    expect(parseTags(' news , talk ,, sports ')).toEqual(['news', 'talk', 'sports']);
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags('a,b,c,d,e,f,g,h,i,j')).toHaveLength(8);
  });
});

describe('transcript helpers', () => {
  it('counts words', () => {
    expect(countWords('  hola   qué tal ')).toBe(3);
    expect(countWords('   ')).toBe(0);
  });

  it('strips transcription boilerplate so music is not mistaken for speech', () => {
    const cleaned = cleanTranscript('Subtítulos realizados por la comunidad de Amara.org [Música] Buenas tardes.');
    expect(cleaned).toBe('Buenas tardes.');
    expect(countWords(cleaned)).toBe(2);
  });
});
