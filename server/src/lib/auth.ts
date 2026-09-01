import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AuthUser } from '../types.js';

type BetterDatabase = Database.Database;

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const MIN_PASSWORD_LENGTH = 8;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SALT_BYTES = 16;
const TOKEN_BYTES = 32;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type AuthErrorCode =
  | 'invalid_username'
  | 'invalid_password'
  | 'username_taken'
  | 'invalid_credentials';

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

export interface SignupInput {
  username: string;
  password: string;
  displayName?: string;
  now?: Date;
}

export interface LoginInput {
  username: string;
  password: string;
  now?: Date;
}

export interface AuthSession {
  user: AuthUser;
  token: string;
}

export interface AuthStore {
  signup(input: SignupInput): AuthSession;
  login(input: LoginInput): AuthSession;
  logout(token: string): void;
  resolveSession(token: string, now?: Date): AuthUser | null;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
}

interface SessionRow {
  token_hash: string;
  user_id: string;
  expires_at: string;
}

function hashPassword(password: string, salt: Buffer = randomBytes(SALT_BYTES)): string {
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const sep = stored.indexOf(':');
  if (sep <= 0) return false;
  const saltHex = stored.slice(0, sep);
  const hashHex = stored.slice(sep + 1);
  if (saltHex.length === 0 || hashHex.length === 0 || hashHex.length % 2 !== 0) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = scryptSync(password, salt, expected.length, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

function normalizeDisplayName(raw: string | undefined, username: string): string {
  const trimmed = raw?.trim() ?? '';
  if (trimmed.length === 0) return username;
  return trimmed.slice(0, 40);
}

function toUser(row: UserRow): AuthUser {
  return { id: row.id, username: row.username, displayName: row.display_name };
}

function assertUsername(username: string): void {
  if (!USERNAME_RE.test(username)) {
    throw new AuthError(
      'invalid_username',
      'Username must be 3–20 characters: lowercase letters, digits, or underscore.',
    );
  }
}

function assertPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError('invalid_password', 'Password must be at least 8 characters.');
  }
}

/**
 * Own the `users` + `sessions` tables. If this DB still has the original
 * single-user `users(id INTEGER, name TEXT)` table, rename it aside and create
 * the account schema. Existing quiz/vocab/favorites rows (user_id = 1) stay
 * put — they are not copied onto new accounts.
 */
function ensureAuthSchema(db: BetterDatabase): void {
  const cols = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
  if (cols.length === 0) {
    db.exec(`
      CREATE TABLE users (
        id            TEXT PRIMARY KEY,
        username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name  TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at    TEXT NOT NULL
      );
    `);
  } else if (!cols.some((col) => col.name === 'username')) {
    db.exec(`
      ALTER TABLE users RENAME TO users_legacy;
      CREATE TABLE users (
        id            TEXT PRIMARY KEY,
        username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name  TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at    TEXT NOT NULL
      );
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);
}

/**
 * SQLite-backed accounts + sessions. Pure over a Database instance so tests
 * can use an in-memory DB, matching the favorites store.
 */
export function createAuthStore(db: BetterDatabase): AuthStore {
  ensureAuthSchema(db);

  const insertUser = db.prepare(
    `INSERT INTO users (id, username, display_name, password_hash, created_at)
     VALUES (@id, @username, @display_name, @password_hash, @created_at)`,
  );
  const findByUsername = db.prepare(
    `SELECT id, username, display_name, password_hash FROM users WHERE username = ? COLLATE NOCASE`,
  );
  const findById = db.prepare(
    `SELECT id, username, display_name, password_hash FROM users WHERE id = ?`,
  );
  const insertSession = db.prepare(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
     VALUES (@token_hash, @user_id, @created_at, @expires_at)`,
  );
  const findSession = db.prepare(
    `SELECT token_hash, user_id, expires_at FROM sessions WHERE token_hash = ?`,
  );
  const deleteSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');

  function issueSession(user: AuthUser, now: Date): string {
    const token = randomBytes(TOKEN_BYTES).toString('hex');
    insertSession.run({
      token_hash: hashToken(token),
      user_id: user.id,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    });
    return token;
  }

  return {
    signup({ username: rawUsername, password, displayName, now = new Date() }) {
      const username = normalizeUsername(rawUsername);
      assertUsername(username);
      assertPassword(password);

      const user: UserRow = {
        id: randomUUID(),
        username,
        display_name: normalizeDisplayName(displayName, username),
        password_hash: hashPassword(password),
      };

      try {
        insertUser.run({
          id: user.id,
          username: user.username,
          display_name: user.display_name,
          password_hash: user.password_hash,
          created_at: now.toISOString(),
        });
      } catch (error) {
        if (error instanceof Error && /UNIQUE/i.test(error.message)) {
          throw new AuthError('username_taken', 'That username is already taken.');
        }
        throw error;
      }

      const publicUser = toUser(user);
      return { user: publicUser, token: issueSession(publicUser, now) };
    },

    login({ username: rawUsername, password, now = new Date() }) {
      const username = normalizeUsername(rawUsername);
      const row = findByUsername.get(username) as UserRow | undefined;
      if (!row || !verifyPassword(password, row.password_hash)) {
        throw new AuthError('invalid_credentials', 'Invalid username or password.');
      }
      const user = toUser(row);
      return { user, token: issueSession(user, now) };
    },

    logout(token) {
      if (typeof token !== 'string' || token.length === 0) return;
      deleteSession.run(hashToken(token));
    },

    resolveSession(token, now = new Date()) {
      if (typeof token !== 'string' || token.length === 0) return null;
      const session = findSession.get(hashToken(token)) as SessionRow | undefined;
      if (!session) return null;
      if (new Date(session.expires_at).getTime() <= now.getTime()) {
        deleteSession.run(session.token_hash);
        return null;
      }
      const row = findById.get(session.user_id) as UserRow | undefined;
      return row ? toUser(row) : null;
    },
  };
}
