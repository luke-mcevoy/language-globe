import { countWords } from './text.js';

export const MUSIC_CAPTION_TEXT = '♪ music ♪';
export const MIN_CAPTION_WORDS = 3;

export function captionText(transcript: string): string {
  const trimmed = transcript.trim();
  return countWords(trimmed) >= MIN_CAPTION_WORDS ? trimmed : MUSIC_CAPTION_TEXT;
}
