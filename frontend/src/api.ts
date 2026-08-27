import type {
  CaptionPollResponse,
  CaptionSessionCreatedResponse,
  Difficulty,
  Favorite,
  FavoritesResponse,
  HealthResponse,
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
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
    throw new ApiError(body?.error ?? 'request_failed', body?.message ?? `Request failed (${response.status})`, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const getHealth = (): Promise<HealthResponse> => request<HealthResponse>('/api/health');

export const getStations = (): Promise<StationsResponse> => request<StationsResponse>('/api/stations');

export const getStats = (): Promise<StatsResponse> => request<StatsResponse>('/api/stats');

export const startCaptionSession = (stationId: string, signal?: AbortSignal): Promise<CaptionSessionCreatedResponse> =>
  request<CaptionSessionCreatedResponse>('/api/captions/session', {
    method: 'POST',
    body: JSON.stringify({ stationId }),
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

export const startQuiz = (stationId: string, difficulty: Difficulty): Promise<QuizStartResponse> =>
  request<QuizStartResponse>('/api/quiz/start', {
    method: 'POST',
    body: JSON.stringify({ stationId, difficulty }),
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

export const lookupWord = (word: string, context: string, stationName: string): Promise<VocabLookupResponse> =>
  request<VocabLookupResponse>('/api/vocab/lookup', {
    method: 'POST',
    body: JSON.stringify({ word, context, stationName }),
  });

export const getVocab = (): Promise<VocabResponse> => request<VocabResponse>('/api/vocab');

export const removeVocabWord = (id: number): Promise<void> =>
  request<void>(`/api/vocab/${id}`, { method: 'DELETE' });
