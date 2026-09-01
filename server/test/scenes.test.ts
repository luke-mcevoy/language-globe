import { describe, expect, it } from 'vitest';
import { MUSIC_CAPTION_TEXT } from '../src/lib/captions.js';
import { CaptionSession } from '../src/services/captionSessions.js';
import { buildSceneDescriptionPrompt, parseSceneDescription } from '../src/services/openai.js';
import { fallbackScenePrompt } from '../src/services/scenes.js';
import type { Station } from '../src/types.js';

const station: Station = {
  id: 'station-1',
  name: 'Radio Test',
  url: 'https://example.com/live.mp3',
  homepage: '',
  favicon: '',
  tags: ['merengue', 'hits', 'news'],
  country: 'Ecuador',
  countryCode: 'EC',
  state: 'Guayas',
  language: 'Spanish',
  lat: -2,
  lon: -79,
  clickcount: 1,
  votes: 1,
  codec: 'MP3',
  bitrate: 128,
  kind: 'music',
  reachable: true,
};

describe('fallbackScenePrompt', () => {
  it('draws the station vibe from its tags and place', () => {
    const prompt = fallbackScenePrompt(station);
    expect(prompt).toContain('merengue hits');
    expect(prompt).toContain('Guayas, Ecuador');
    expect(prompt).toContain('no text');
  });

  it('degrades gracefully when the station has no tags or place', () => {
    const prompt = fallbackScenePrompt({ ...station, tags: [], state: '', country: '', kind: 'talk' });
    expect(prompt).toContain('talk radio');
    expect(prompt).toContain('a far-away city');
  });
});

describe('buildSceneDescriptionPrompt', () => {
  it('includes the transcript and the no-real-person rule', () => {
    const prompt = buildSceneDescriptionPrompt('hablamos de la fundación de La Serena', 'spanish');
    expect(prompt).toContain('la fundación de La Serena');
    expect(prompt).toContain('Never name or depict a real, identifiable person');
    expect(prompt).toContain('Spanish');
  });
});

describe('parseSceneDescription', () => {
  it('accepts a valid prompt and trims it', () => {
    expect(parseSceneDescription({ prompt: '  a lighthouse at dusk, stylized illustration  ' })).toBe(
      'a lighthouse at dusk, stylized illustration',
    );
  });

  it('rejects missing, non-string, or too-short prompts', () => {
    expect(parseSceneDescription({})).toBeNull();
    expect(parseSceneDescription({ prompt: 42 })).toBeNull();
    expect(parseSceneDescription({ prompt: 'short' })).toBeNull();
    expect(parseSceneDescription(null)).toBeNull();
  });
});

describe('CaptionSession.recentText', () => {
  it('joins spoken chunks, skips music markers, and caps the word count', () => {
    const session = new CaptionSession(station);
    session.appendResult('uno dos tres');
    session.appendResult(MUSIC_CAPTION_TEXT);
    session.appendResult('cuatro cinco seis');

    expect(session.recentText()).toBe('uno dos tres cuatro cinco seis');
    expect(session.recentText(2)).toBe('cinco seis');
  });

  it('returns an empty string for a music-only session', () => {
    const session = new CaptionSession(station);
    session.appendResult(MUSIC_CAPTION_TEXT);
    expect(session.recentText()).toBe('');
  });
});
