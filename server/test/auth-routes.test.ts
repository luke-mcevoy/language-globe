import cookie from '@fastify/cookie';
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthStore } from '../src/lib/auth.js';
import { SESSION_COOKIE } from '../src/lib/resolveUser.js';
import { registerAuthRoutes } from '../src/routes/auth.js';
import { registerFavoriteRoutes } from '../src/routes/favorites.js';
import { registerVocabRoutes } from '../src/routes/vocab.js';

function cookieFrom(response: { headers: { 'set-cookie'?: string | string[] } }): string {
  const raw = response.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return first?.split(';')[0] ?? '';
}

async function buildApp(): Promise<FastifyInstance> {
  const db = new Database(':memory:');
  const app = Fastify({ logger: false });
  await app.register(cookie);
  app.decorate('authStore', createAuthStore(db));
  await registerAuthRoutes(app);
  await registerVocabRoutes(app);
  await registerFavoriteRoutes(app);
  await app.ready();
  return app;
}

describe('auth routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('signs up, returns the user on /me, then logout clears the session', async () => {
    const signup = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { username: 'alice', password: 'password1', displayName: 'Alice' },
    });
    expect(signup.statusCode).toBe(201);
    expect(signup.json()).toMatchObject({
      user: { username: 'alice', displayName: 'Alice' },
    });
    const cookieHeader = cookieFrom(signup);
    expect(cookieHeader.startsWith(`${SESSION_COOKIE}=`)).toBe(true);

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookieHeader },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: { username: 'alice', displayName: 'Alice' },
    });

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: cookieHeader },
    });
    expect(logout.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookieHeader },
    });
    expect(after.json()).toEqual({ user: null });
  });

  it('returns 409 when the username is taken', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { username: 'alice', password: 'password1' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { username: 'alice', password: 'password2' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: 'username_taken' });
  });

  it('returns 401 on vocab and favorites when anonymous', async () => {
    const vocab = await app.inject({ method: 'GET', url: '/api/vocab' });
    expect(vocab.statusCode).toBe(401);
    expect(vocab.json()).toEqual({ error: 'account_required' });

    const favorites = await app.inject({ method: 'GET', url: '/api/favorites' });
    expect(favorites.statusCode).toBe(401);
    expect(favorites.json()).toEqual({ error: 'account_required' });
  });

  it('lets a signed-up user read an empty vocab list', async () => {
    const signup = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { username: 'alice', password: 'password1' },
    });
    const vocab = await app.inject({
      method: 'GET',
      url: '/api/vocab',
      headers: { cookie: cookieFrom(signup) },
    });
    expect(vocab.statusCode).toBe(200);
    expect(vocab.json()).toEqual({ words: [] });
  });
});
