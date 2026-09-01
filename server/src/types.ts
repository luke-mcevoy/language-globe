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

export interface CaptionWord {
  word: string;
  /** ms since session start when this word starts (session time axis). */
  startMs: number;
  /** ms since session start when this word ends. */
  endMs: number;
}

export interface CaptionChunk {
  seq: number;
  text: string;
  capturedAt: string;
  /** ms since session start when this chunk's window began. */
  startMs: number;
  /** ms since session start when this chunk's window ended. */
  endMs: number;
  /**
   * Per-word timings on the SESSION time axis. Omitted when the transcription
   * provider does not report word-level detail — the client then falls back to
   * chunk-level highlighting.
   */
  words?: CaptionWord[];
}

export interface CaptionSessionCreatedResponse {
  sessionId: string;
  chunkSeconds: number;
  audioContentType: string;
}

export interface CaptionPollResponse {
  chunks: CaptionChunk[];
  /** Post-burst audio the sync relay has buffered; null until the first byte lands. */
  audioBufferedMs?: number | null;
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
  transcribeProvider: 'local-whisper' | 'unavailable';
  quizProvider: 'ollama' | 'unavailable';
  /** ffmpeg unlocks HLS (.m3u8) and AAC stations for quizzes. */
  ffmpegAvailable: boolean;
}

/**
 * A saved station. `station` is always populated: hydrated from the live
 * Radio Browser index when possible, otherwise reconstructed from the stored
 * snapshot and flagged `missing`.
 */
export interface Favorite {
  createdAt: string;
  missing: boolean;
  station: Station;
}

export interface FavoritesResponse {
  favorites: Favorite[];
}

/** One word the user looked up from the captions ("words I didn't know"). */
export interface VocabEntry {
  id: number;
  word: string;
  translation: string;
  note: string;
  context: string;
  stationName: string;
  timesLookedUp: number;
  createdAt: string;
  lastLookedUpAt: string;
}

export interface VocabResponse {
  words: VocabEntry[];
}

export interface VocabLookupResponse {
  entry: VocabEntry;
  /** False for anonymous lookups: translated but not stored anywhere. */
  saved: boolean;
}

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
}

export interface MeResponse {
  user: AuthUser | null;
}

export interface ListeningNow {
  stationName: string;
  country: string;
}

export interface LeaderboardEntry {
  userId: string;
  username: string;
  displayName: string;
  streakDays: number;
  quizCount: number;
  accuracy7d: number | null;
  vocabCount: number;
  countriesCount: number;
  listeningNow: ListeningNow | null;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
}

export interface FriendListening {
  userId: string;
  username: string;
  displayName: string;
  stationId: string;
  stationName: string;
  country: string;
  lat: number;
  lon: number;
  startedAt: string;
}

export interface FriendsListeningResponse {
  friends: FriendListening[];
}
