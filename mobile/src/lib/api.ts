import Constants from 'expo-constants';
import type {
  CaptionsResponse,
  Difficulty,
  HealthResponse,
  QuizStartResponse,
  QuizSubmitResponse,
  StationsResponse,
  StatsResponse,
} from '../types';

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

function apiBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const hostUri = (Constants.expoConfig as { hostUri?: string } | null)?.hostUri;
  const host = hostUri?.split(':')[0];
  if (__DEV__ && host) return `http://${host}:8787`;

  return 'http://localhost:8787';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError('offline', 'Cannot reach the Language Globe server.', 0);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
    throw new ApiError(
      body?.error ?? 'request_failed',
      body?.message ?? `Request failed (${response.status})`,
      response.status,
    );
  }

  return (await response.json()) as T;
}

export const getHealth = (): Promise<HealthResponse> => request<HealthResponse>('/api/health');

export const getStations = (): Promise<StationsResponse> => request<StationsResponse>('/api/stations');

export const getStats = (): Promise<StatsResponse> => request<StatsResponse>('/api/stats');

export const getCaptions = (stationId: string, signal?: AbortSignal): Promise<CaptionsResponse> =>
  request<CaptionsResponse>('/api/captions', {
    method: 'POST',
    body: JSON.stringify({ stationId }),
    signal,
  });

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
