import { describe, expect, it } from 'vitest';
import { MUSIC_CAPTION_TEXT, captionText } from '../src/lib/captions.js';

describe('captionText', () => {
  it('keeps speech chunks', () => {
    expect(captionText('Buenos días desde Madrid.')).toBe('Buenos días desde Madrid.');
  });

  it('uses a music marker for empty or near-empty chunks', () => {
    expect(captionText('')).toBe(MUSIC_CAPTION_TEXT);
    expect(captionText('Radio Madrid')).toBe(MUSIC_CAPTION_TEXT);
  });
});
