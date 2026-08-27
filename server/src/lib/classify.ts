import type { StationKind } from '../types.js';

/**
 * Tag/name fragments that suggest a station is mostly speech, and therefore
 * worth quizzing on. Multilingual on purpose: Radio Browser tags are written
 * by whoever submitted the station.
 */
const TALK_HINTS = [
  'news',
  'talk',
  'talkshow',
  'spoken',
  'speech',
  'noticias',
  'noticia',
  'hablado',
  'informacion',
  'información',
  'informativo',
  'actualidad',
  'debate',
  'tertulia',
  'entrevista',
  'politic',
  'política',
  'public radio',
  'current affairs',
  'sport',
  'deporte',
  'religio',
  'cultura',
  'culture',
  'educa',
  'ciencia',
  'science',
  'documental',
  'podcast',
  'magazine',
  'radio hablada',
  'all news',
  'community',
];

const MUSIC_HINTS = [
  'music',
  'musica',
  'música',
  'pop',
  'rock',
  'jazz',
  'classical',
  'clasica',
  'clásica',
  'salsa',
  'reggaeton',
  'reggae',
  'cumbia',
  'ranchera',
  'bachata',
  'merengue',
  'flamenco',
  'electronic',
  'dance',
  'house',
  'techno',
  'hits',
  'top 40',
  'oldies',
  'baladas',
  'romantica',
  'romántica',
  'country',
  'hip hop',
  'rap',
  'indie',
  'metal',
  'folk',
  'tango',
  'blues',
  'soul',
  'lounge',
  'chill',
  'ambient',
  'k-pop',
  'latino',
  'variety',
];

function matches(haystack: string, hints: string[]): boolean {
  return hints.some((hint) => haystack.includes(hint));
}

/**
 * Talk wins ties: a "news + music" station still has speech to quiz on, and
 * the cost of a wrong guess is one dud quiz, not a broken app.
 */
export function classifyStation(tags: string[], name = ''): StationKind {
  const haystack = [...tags, name].join(' ').toLowerCase();
  if (haystack.length === 0) return 'unknown';
  if (matches(haystack, TALK_HINTS)) return 'talk';
  if (matches(haystack, MUSIC_HINTS)) return 'music';
  return 'unknown';
}

export function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .slice(0, 8);
}
