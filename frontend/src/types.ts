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

export interface LearningLanguage {
  id: string;
  name: string;
  nativeName: string;
  code: string;
}

export interface HealthResponse {
  ok: true;
  quizEnabled: boolean;
  captionsEnabled: boolean;
  targetLanguage: string;
  languages: LearningLanguage[];
  captureSeconds: number;
  captionChunkSeconds: number;
  transcribeProvider: 'local-whisper' | 'unavailable';
  quizProvider: 'ollama' | 'unavailable';
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
