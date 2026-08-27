/** Mirrors server/src/types.ts — the API contract, kept in sync by hand. */

export type StationKind = 'talk' | 'music' | 'unknown';

export interface Station {
  id: string;
  name: string;
  url: string;
  homepage: string;
  favicon: string;
  tags: string[];
  country: string;
  countryCode: string;
  state: string;
  language: string;
  lat: number;
  lon: number;
  clickcount: number;
  votes: number;
  codec: string;
  bitrate: number;
  kind: StationKind;
  reachable: boolean;
}

export interface StationsResponse {
  stations: Station[];
  language: string;
  fetchedAt: number;
  stale: boolean;
}

export type Difficulty = 'beginner' | 'intermediate';

export interface ClientQuestion {
  question: string;
  options: string[];
}

export interface QuizStartedResponse {
  kind: 'quiz';
  quizId: string;
  difficulty: Difficulty;
  questions: ClientQuestion[];
  transcriptWords: number;
  stationName: string;
}

export interface NotEnoughSpeechResponse {
  kind: 'not_enough_speech';
  transcript: string;
  wordCount: number;
  suggestion: Station | null;
}

export type QuizStartResponse = QuizStartedResponse | NotEnoughSpeechResponse;

export interface GradedQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  chosenIndex: number | null;
  correct: boolean;
  explanation: string;
}

export interface QuizSubmitResponse {
  quizId: string;
  score: number;
  total: number;
  results: GradedQuestion[];
  transcript: string;
}

export interface CaptionWord {
  word: string;
  startMs: number;
  endMs: number;
}

export interface CaptionChunk {
  seq: number;
  text: string;
  capturedAt: string;
  startMs: number;
  endMs: number;
  words?: CaptionWord[];
}

export interface CaptionSessionCreatedResponse {
  sessionId: string;
  chunkSeconds: number;
  audioContentType: string;
}

export interface CaptionPollResponse {
  chunks: CaptionChunk[];
}

export interface DailyAccuracy {
  date: string;
  attempts: number;
  questions: number;
  correct: number;
  accuracy: number | null;
}

export interface CountryStat {
  countryCode: string;
  country: string;
  attempts: number;
  questions: number;
  correct: number;
  accuracy: number;
}

export interface StatsResponse {
  totals: {
    quizzes: number;
    questions: number;
    correct: number;
    accuracy: number | null;
    countriesVisited: number;
    wordsHeard: number;
  };
  streak: {
    current: number;
    longest: number;
    lastQuizDate: string | null;
  };
  daily: DailyAccuracy[];
  countries: CountryStat[];
}

export interface HealthResponse {
  ok: true;
  quizEnabled: boolean;
  captionsEnabled: boolean;
  targetLanguage: string;
  captureSeconds: number;
  captionChunkSeconds: number;
  transcribeProvider: string;
  quizProvider: string;
  ffmpegAvailable: boolean;
}

export interface Favorite {
  createdAt: string;
  missing: boolean;
  station: Station;
}

export interface FavoritesResponse {
  favorites: Favorite[];
}
