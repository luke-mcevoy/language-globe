import { describe, expect, it } from 'vitest';
import { mergeWhisperCliTokensToWords, normalizeFlatWords } from '../src/lib/whisperWords.js';

describe('mergeWhisperCliTokensToWords', () => {
  it('merges leading-space tokens into whole words', () => {
    // Realistic fragment from whisper-cli -ojf: " Hola" starts a word,
    // "," attaches to it, " mundo" starts the next word, and "." attaches.
    const words = mergeWhisperCliTokensToWords([
      {
        offsets: { from: 0, to: 1200 },
        text: ' Hola, mundo.',
        tokens: [
          { text: ' Hola', offsets: { from: 100, to: 480 } },
          { text: ',', offsets: { from: 480, to: 520 } },
          { text: ' mundo', offsets: { from: 620, to: 1100 } },
          { text: '.', offsets: { from: 1100, to: 1150 } },
        ],
      },
    ]);

    expect(words).toEqual([
      { word: 'Hola,', startMs: 100, endMs: 520 },
      { word: 'mundo.', startMs: 620, endMs: 1150 },
    ]);
  });

  it('spans tokens across multiple segments and drops control tokens', () => {
    const words = mergeWhisperCliTokensToWords([
      {
        offsets: { from: 0, to: 800 },
        text: ' Buenos días',
        tokens: [
          { text: '[_BEG_]', offsets: { from: 0, to: 0 } },
          { text: ' Buen', offsets: { from: 200, to: 420 } },
          { text: 'os', offsets: { from: 420, to: 520 } },
          { text: ' días', offsets: { from: 600, to: 800 } },
        ],
      },
      {
        offsets: { from: 800, to: 1600 },
        text: ' Madrid',
        tokens: [
          { text: ' Madrid', offsets: { from: 900, to: 1400 } },
          { text: '[_TT_50]', offsets: { from: 1400, to: 1400 } },
        ],
      },
    ]);

    expect(words).toEqual([
      { word: 'Buenos', startMs: 200, endMs: 520 },
      { word: 'días', startMs: 600, endMs: 800 },
      { word: 'Madrid', startMs: 900, endMs: 1400 },
    ]);
  });

  it('returns an empty array when there are no tokens at all', () => {
    expect(mergeWhisperCliTokensToWords([])).toEqual([]);
    expect(mergeWhisperCliTokensToWords([{ text: ' Sólo el segmento', offsets: { from: 0, to: 500 }, tokens: [] }])).toEqual(
      [],
    );
  });

  it('folds a leading punctuation-only token into the following word instead of leaving a stray "."', () => {
    // Real-world quirk: whisper.cpp sometimes opens with a "." token before
    // the first real word. It should not turn into its own highlight slot.
    const words = mergeWhisperCliTokensToWords([
      {
        offsets: { from: 0, to: 400 },
        text: '. Hola',
        tokens: [
          { text: ' .', offsets: { from: 0, to: 40 } },
          { text: ' Hola', offsets: { from: 120, to: 400 } },
        ],
      },
    ]);
    // Leading "." alone has no previous word to attach to, so it is dropped
    // rather than becoming a phantom word. Only "Hola" survives.
    expect(words).toEqual([{ word: 'Hola', startMs: 120, endMs: 400 }]);
  });
});

describe('normalizeFlatWords', () => {
  it('normalizes the OpenAI verbose_json shape (word/start/end in seconds)', () => {
    expect(
      normalizeFlatWords([
        { word: 'Hola', start: 0.1, end: 0.48 },
        { word: 'mundo', start: 0.62, end: 1.1 },
      ]),
    ).toEqual([
      { word: 'Hola', startMs: 100, endMs: 480 },
      { word: 'mundo', startMs: 620, endMs: 1100 },
    ]);
  });

  it('accepts whisper.cpp offset-style entries in milliseconds', () => {
    expect(
      normalizeFlatWords([
        { word: ' Hola ', offsets: { from: 100, to: 480 } },
        { word: 'mundo', offsets: { from: 620, to: 1100 } },
      ]),
    ).toEqual([
      { word: 'Hola', startMs: 100, endMs: 480 },
      { word: 'mundo', startMs: 620, endMs: 1100 },
    ]);
  });

  it('merges whisper-server subword tokens labelled as words back into real words', () => {
    // Verbatim shape from a local whisper-server verbose_json response:
    // "¡Suscríbete al canal!" arrives as subword tokens with leading spaces
    // marking true word starts. Trimming each entry produced fragments like
    // "lleg ando" in the caption UI.
    expect(
      normalizeFlatWords([
        { word: ' ¡', start: 0.06, end: 0.38 },
        { word: 'S', start: 0.38, end: 0.76 },
        { word: 'us', start: 0.76, end: 1.52 },
        { word: 'cr', start: 1.52, end: 2.28 },
        { word: 'íb', start: 2.28, end: 3.04 },
        { word: 'ete', start: 3.04, end: 4.18 },
        { word: ' al', start: 4.18, end: 4.94 },
        { word: ' canal', start: 4.94, end: 6.84 },
        { word: '!', start: 6.84, end: 6.9 },
      ]),
    ).toEqual([
      // The lone opening "¡" is dropped (punctuation-only, no word before it).
      { word: 'Suscríbete', startMs: 380, endMs: 4180 },
      { word: 'al', startMs: 4180, endMs: 4940 },
      { word: 'canal!', startMs: 4940, endMs: 6900 },
    ]);
  });

  it('returns null when nothing is usable so callers can fall back to chunk-level captions', () => {
    expect(normalizeFlatWords(undefined)).toBeNull();
    expect(normalizeFlatWords([])).toBeNull();
    expect(normalizeFlatWords([{ word: '' }, { word: '[_BEG_]', start: 0, end: 0 }])).toBeNull();
  });
});
