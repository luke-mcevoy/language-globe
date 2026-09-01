import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthUser } from '../types.js';

export const SESSION_COOKIE = 'lg_session';
export const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_MAX_AGE_SEC,
  secure: 'auto' as const,
};

/** Session user when a valid `lg_session` cookie is present; otherwise null. */
export function resolveUser(request: FastifyRequest): AuthUser | null {
  const token = request.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string' || token.length === 0) return null;
  return request.server.authStore.resolveSession(token);
}

/**
 * Require a signed-in account. Sends `{ error: 'account_required' }` and
 * returns undefined when the request is anonymous.
 */
export function requireUser(request: FastifyRequest, reply: FastifyReply): AuthUser | undefined {
  const user = resolveUser(request);
  if (!user) {
    void reply.status(401).send({ error: 'account_required' });
    return undefined;
  }
  return user;
}
