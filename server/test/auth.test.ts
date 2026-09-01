import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthError, createAuthStore, type AuthStore } from '../src/lib/auth.js';

function freshStore(): { store: AuthStore; db: Database.Database } {
  const db = new Database(':memory:');
  return { store: createAuthStore(db), db };
}

describe('authStore', () => {
  let db: Database.Database;
  let store: AuthStore;

  beforeEach(() => {
    ({ store, db } = freshStore());
  });

  afterEach(() => db.close());

  it('signs up a user and resolves the issued session', () => {
    const { user, token } = store.signup({
      username: 'alice',
      password: 'password1',
      displayName: 'Alice',
    });

    expect(user.username).toBe('alice');
    expect(user.displayName).toBe('Alice');
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(store.resolveSession(token)).toEqual(user);
  });

  it('defaults displayName to the username and lowercases it', () => {
    const { user } = store.signup({ username: 'Bob_1', password: 'password1' });
    expect(user.username).toBe('bob_1');
    expect(user.displayName).toBe('bob_1');
  });

  it('logs in with the same password and rejects a wrong one', () => {
    store.signup({ username: 'alice', password: 'password1' });

    const ok = store.login({ username: 'Alice', password: 'password1' });
    expect(ok.user.username).toBe('alice');
    expect(store.resolveSession(ok.token)?.username).toBe('alice');

    expect(() => store.login({ username: 'alice', password: 'wrong-pass' })).toThrow(AuthError);
    try {
      store.login({ username: 'alice', password: 'wrong-pass' });
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe('invalid_credentials');
    }
  });

  it('treats an expired session as missing', () => {
    const now = new Date('2026-08-01T00:00:00.000Z');
    const { token } = store.signup({ username: 'alice', password: 'password1', now });

    expect(store.resolveSession(token, now)).not.toBeNull();
    const afterExpiry = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);
    expect(store.resolveSession(token, afterExpiry)).toBeNull();
    // Expired row is deleted so a later resolve with the original clock stays gone.
    expect(store.resolveSession(token, now)).toBeNull();
  });

  it('logout drops the session', () => {
    const { token } = store.signup({ username: 'alice', password: 'password1' });
    store.logout(token);
    expect(store.resolveSession(token)).toBeNull();
  });

  it('rejects a taken username and a short password', () => {
    store.signup({ username: 'alice', password: 'password1' });
    expect(() => store.signup({ username: 'Alice', password: 'password2' })).toThrow(AuthError);
    try {
      store.signup({ username: 'alice', password: 'password2' });
    } catch (error) {
      expect((error as AuthError).code).toBe('username_taken');
    }
    try {
      store.signup({ username: 'carol', password: 'short' });
    } catch (error) {
      expect((error as AuthError).code).toBe('invalid_password');
    }
  });

  it('leaves a legacy single-user table untouched and still accepts new accounts', () => {
    const legacy = new Database(':memory:');
    legacy.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO users (id, name, created_at) VALUES (1, 'you', '2026-01-01T00:00:00.000Z');
      CREATE TABLE quizzes (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TEXT);
      INSERT INTO quizzes (id, user_id, created_at) VALUES ('old', 1, '2026-01-01T00:00:00.000Z');
    `);

    const auth = createAuthStore(legacy);
    const { user } = auth.signup({ username: 'alice', password: 'password1' });
    expect(user.id).not.toBe('1');

    const leftover = legacy.prepare('SELECT user_id FROM quizzes WHERE id = ?').get('old') as { user_id: number };
    expect(leftover.user_id).toBe(1);
    const legacyUser = legacy.prepare('SELECT id, name FROM users_legacy WHERE id = 1').get() as {
      id: number;
      name: string;
    };
    expect(legacyUser).toEqual({ id: 1, name: 'you' });
    legacy.close();
  });
});
