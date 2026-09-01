import type {
  AuthUser,
  CaptionPollResponse,
  CaptionSessionCreatedResponse,
  Difficulty,
  Favorite,
  FavoritesResponse,
  FriendsListeningResponse,
  HealthResponse,
  LeaderboardResponse,
  MeResponse,
  QuizStartResponse,
  QuizSubmitResponse,
  StationsResponse,
  StatsResponse,
  VocabLookupResponse,
  VocabResponse,
} from './types';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const ACCOUNT_REQUIRED_NUDGE = 'Create a free account on this server to save your progress';

type AccountRequiredHandler = (nudge: string) => void;

let accountRequiredHandler: AccountRequiredHandler | null = null;

/** App registers this so any authed-only 401 opens the sign-in modal. */
export function setAccountRequiredHandler(handler: AccountRequiredHandler | null): void {
  accountRequiredHandler = handler;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: init?.credentials ?? 'same-origin',
      // Only claim a JSON body when there is one: Fastify rejects a JSON
      // content-type with an empty body (400), which silently broke every
      // body-less DELETE (caption session cleanup, unfavorite).
      headers: init?.body ? { 'Content-Type': 'application/json', ...init?.headers } : init?.headers,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('offline', 'Cannot reach the Language Globe server. Is `npm run dev` running?', 0);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
    if (response.status === 401 && body?.error === 'account_required') {
      accountRequiredHandler?.(ACCOUNT_REQUIRED_NUDGE);
    }
    throw new ApiError(body?.error ?? 'request_failed', body?.message ?? `Request failed (${response.status})`, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const getHealth = (): Promise<HealthResponse> => request<HealthResponse>('/api/health');

export const getStations = (language?: string): Promise<StationsResponse> => {
  const query = language ? `?language=${encodeURIComponent(language)}` : '';
  return request<StationsResponse>(`/api/stations${query}`);
};

export const getStats = (): Promise<StatsResponse> => request<StatsResponse>('/api/stats');

export const startCaptionSession = (
  stationId: string,
  language?: string,
  signal?: AbortSignal,
): Promise<CaptionSessionCreatedResponse> =>
  request<CaptionSessionCreatedResponse>('/api/captions/session', {
    method: 'POST',
    body: JSON.stringify({ stationId, ...(language ? { language } : {}) }),
    signal,
  });

export const pollCaptionSession = (
  sessionId: string,
  after: number,
  signal?: AbortSignal,
): Promise<CaptionPollResponse> =>
  request<CaptionPollResponse>(`/api/captions/session/${encodeURIComponent(sessionId)}?after=${after}`, { signal });

export const stopCaptionSession = (sessionId: string): Promise<void> =>
  request<void>(`/api/captions/session/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });

export const captionSessionAudioUrl = (sessionId: string, delaySeconds: number): string =>
  `/api/captions/session/${encodeURIComponent(sessionId)}/audio?delay=${delaySeconds}`;

export const startQuiz = (stationId: string, difficulty: Difficulty, language?: string): Promise<QuizStartResponse> =>
  request<QuizStartResponse>('/api/quiz/start', {
    method: 'POST',
    body: JSON.stringify({ stationId, difficulty, ...(language ? { language } : {}) }),
  });

export const submitQuiz = (quizId: string, answers: (number | null)[]): Promise<QuizSubmitResponse> =>
  request<QuizSubmitResponse>('/api/quiz/submit', {
    method: 'POST',
    body: JSON.stringify({ quizId, answers }),
  });

export const getFavorites = (): Promise<FavoritesResponse> => request<FavoritesResponse>('/api/favorites');

export const addFavorite = (stationId: string): Promise<Favorite> =>
  request<Favorite>(`/api/favorites/${encodeURIComponent(stationId)}`, { method: 'PUT' });

export const removeFavorite = (stationId: string): Promise<void> =>
  request<void>(`/api/favorites/${encodeURIComponent(stationId)}`, { method: 'DELETE' });

export const lookupWord = (
  word: string,
  context: string,
  stationName: string,
  language?: string,
): Promise<VocabLookupResponse> =>
  request<VocabLookupResponse>('/api/vocab/lookup', {
    method: 'POST',
    body: JSON.stringify({ word, context, stationName, ...(language ? { language } : {}) }),
  });

export const getVocab = (): Promise<VocabResponse> => request<VocabResponse>('/api/vocab');

export const removeVocabWord = (id: number): Promise<void> =>
  request<void>(`/api/vocab/${id}`, { method: 'DELETE' });

export const getMe = (): Promise<MeResponse> => request<MeResponse>('/api/auth/me');

export const signup = (
  username: string,
  password: string,
  displayName?: string,
): Promise<{ user: AuthUser }> =>
  request<{ user: AuthUser }>('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      username,
      password,
      ...(displayName && displayName.trim().length > 0 ? { displayName: displayName.trim() } : {}),
    }),
  });

export const login = (username: string, password: string): Promise<{ user: AuthUser }> =>
  request<{ user: AuthUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

export const logout = (): Promise<void> => request<void>('/api/auth/logout', { method: 'POST' });

export const followUser = (username: string): Promise<void> =>
  request<void>('/api/social/follow', {
    method: 'POST',
    body: JSON.stringify({ username }),
  });

export const unfollowUser = (username: string): Promise<void> =>
  request<void>(`/api/social/follow/${encodeURIComponent(username)}`, { method: 'DELETE' });

export const getLeaderboard = (): Promise<LeaderboardResponse> =>
  request<LeaderboardResponse>('/api/social/leaderboard');

export const postPresence = (stationId: string): Promise<void> =>
  request<void>('/api/social/presence', {
    method: 'POST',
    body: JSON.stringify({ stationId }),
  });

export const deletePresence = (): Promise<void> =>
  request<void>('/api/social/presence', { method: 'DELETE' });

export const getFriendsListening = (): Promise<FriendsListeningResponse> =>
  request<FriendsListeningResponse>('/api/social/friends-listening');
