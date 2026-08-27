/** Wire types shared with the frontend (kept structurally identical by hand). */

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
  /** Whether the station is likely to contain speech worth quizzing on. */
  kind: StationKind;
  /** Radio Browser's own liveness check at cache time. */
  reachable: boolean;
}

export interface StationsResponse {
  stations: Station[];
  language: string;
  fetchedAt: number;
  /** True when we are serving a cache entry we failed to refresh. */
  stale: boolean;
}

export type Difficulty = 'beginner' | 'intermediate';

export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

/** A question as the client sees it — no answer key. */
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
  /** A nearby-in-spirit talk station to try instead, when we can find one. */
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

export interface CaptionChunk {
  seq: number;
  text: string;
  capturedAt: string;
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
  /** ffmpeg unlocks HLS (.m3u8) and AAC stations for quizzes. */
  ffmpegAvailable: boolean;
}
