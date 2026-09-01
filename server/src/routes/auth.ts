import type { FastifyInstance } from 'fastify';
import { AuthError } from '../lib/auth.js';
import { resolveUser, SESSION_COOKIE, sessionCookieOptions } from '../lib/resolveUser.js';
import type { MeResponse } from '../types.js';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

interface AuthBody {
  username?: unknown;
  password?: unknown;
  displayName?: unknown;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function clientIp(request: { ip: string }): string {
  return request.ip || 'unknown';
}

/**
 * Tiny in-memory login throttle: 10 attempts / 15 min per IP. A Map is enough
 * for a self-hosted instance; it resets on process restart.
 */
function createLoginRateLimit() {
  const attempts = new Map<string, number[]>();

  return function rateLimited(ip: string, now = Date.now()): boolean {
    const recent = (attempts.get(ip) ?? []).filter((at) => now - at < LOGIN_WINDOW_MS);
    if (recent.length >= LOGIN_MAX_ATTEMPTS) {
      attempts.set(ip, recent);
      return true;
    }
    recent.push(now);
    attempts.set(ip, recent);
    return false;
  };
}

function statusFor(error: AuthError): number {
  switch (error.code) {
    case 'username_taken':
      return 409;
    case 'invalid_credentials':
      return 401;
    default:
      return 400;
  }
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const loginRateLimited = createLoginRateLimit();

  app.post<{ Body: AuthBody }>('/api/auth/signup', async (request, reply) => {
    const username = readString(request.body?.username);
    const password = readString(request.body?.password);
    const displayName = readString(request.body?.displayName) || undefined;

    try {
      const { user, token } = request.server.authStore.signup({ username, password, displayName });
      void reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions);
      return reply.status(201).send({ user });
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.status(statusFor(error)).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.post<{ Body: AuthBody }>('/api/auth/login', async (request, reply) => {
    if (loginRateLimited(clientIp(request))) {
      return reply.status(429).send({ error: 'rate_limited', message: 'Too many login attempts. Try again later.' });
    }

    const username = readString(request.body?.username);
    const password = readString(request.body?.password);

    try {
      const { user, token } = request.server.authStore.login({ username, password });
      void reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions);
      return { user };
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.status(statusFor(error)).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string') request.server.authStore.logout(token);
    void reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  app.get('/api/auth/me', async (request): Promise<MeResponse> => ({
    user: resolveUser(request),
  }));
}
