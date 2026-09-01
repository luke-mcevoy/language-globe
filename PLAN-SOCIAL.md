# PLAN-SOCIAL.md — accounts + friends so a deployed instance is multi-user

Goal: the owner deploys the container; friends sign up with a username and
password and use the app; everyone's progress is their own; a Friends panel
shows a leaderboard and who is listening to what right now.

Constraints (binding):
- Self-hosted only: no auth SaaS, no email verification, no OAuth. SQLite +
  cookies. Password hashing with `node:crypto` scrypt (no new hashing dep).
- Local models rule is unchanged — nothing here may call a paid API.
- Anonymous users can still tune stations and read live captions. An account
  is required for: saving quiz results, stats/passport, vocab list,
  favorites, and all social features.
- Existing single-user rows (user_id = 'default') are left untouched; new
  accounts start fresh. Do not write a migration.

## Phase 1 — server: accounts and per-user data (touch only `server/`)

1. `server/src/lib/auth.ts`:
   - `users` table: `id` (uuid), `username` UNIQUE COLLATE NOCASE (3-20
     chars, `[a-z0-9_]`), `display_name`, `password_hash`, `created_at`.
   - scrypt hashing (`crypto.scryptSync`, per-user 16-byte salt, N=16384,
     stored as `salt:hex`), constant-time compare.
   - `sessions` table: `token_hash` (sha256 of a 32-byte random token),
     `user_id`, `created_at`, `expires_at` (30 days). Store only the hash.
   - `createAuthStore(db)` with `signup/login/logout/resolveSession` +
     unit tests against an in-memory Database, mirroring
     `server/src/lib/favorites.ts` conventions.
2. Cookie plumbing: add `@fastify/cookie`. Session cookie `lg_session`,
   httpOnly, SameSite=Lax, path=/, maxAge 30d, `secure: 'auto'`.
3. `server/src/routes/auth.ts`:
   - POST `/api/auth/signup` { username, password, displayName? } → 201 +
     sets cookie; 409 on taken username; validate lengths (password ≥ 8).
   - POST `/api/auth/login` → 200 + cookie; 401 invalid; apply a tiny
     in-memory rate limit (10 attempts / 15 min per IP) — a Map is fine.
   - POST `/api/auth/logout` → clears cookie, deletes session row.
   - GET `/api/auth/me` → `{ user: { id, username, displayName } | null }`.
4. Request identity: a small `resolveUser(request)` helper (decorator or
   plain function) used by routes; returns the session user or null.
5. Make existing per-user routes account-aware: quiz submit/history, stats,
   vocab, favorites currently use the hardcoded default user id — switch
   them to the session user; respond 401 with a clear
   `{ error: 'account_required' }` when anonymous. Health and stations and
   captions endpoints stay public.
6. Wire types: add `AuthUser`, `MeResponse` to `server/src/types.ts` (and
   mirror into `frontend/src/types.ts` + `mobile/src/types.ts` — types
   files only, no UI work in this phase).
7. Tests: auth store (signup/login/session expiry/wrong password), route
   tests for signup→me→logout flow and for a 401 on vocab/favorites when
   anonymous (mirror existing route-test patterns). All existing tests must
   stay green: some assume the default user — update them to sign up a test
   user and pass its cookie where needed.

## Phase 2 — server: friends, presence, leaderboard (touch only `server/`)

1. `server/src/lib/social.ts`:
   - `follows` table: `user_id`, `followed_id`, `created_at`,
     UNIQUE(user_id, followed_id). Follow by exact username; no requests.
   - `createSocialStore(db)`: `follow/unfollow/following(userId)`.
2. Presence (in-memory, not persisted): `Map<userId, { stationId,
   stationName, country, startedAt, lastSeenAt }>`; entries expire after
   90 s without a heartbeat.
   - POST `/api/social/presence` { stationId } (authed) — the client sends
     it on play and every 60 s; DELETE on stop.
3. GET `/api/social/leaderboard` (authed): for me + everyone I follow:
   `{ userId, username, displayName, streakDays, quizCount, accuracy7d,
   vocabCount, countriesCount, listeningNow: { stationName, country } |
   null }`, sorted by streak then quizCount. Reuse existing stats queries;
   add small aggregate queries where missing.
4. POST `/api/social/follow` { username } (authed) → 404 unknown username,
   204 ok; DELETE `/api/social/follow/:username`.
5. GET `/api/social/friends-listening` (authed): the presence entries of
   followed users, with station geo (lat/lon from the station index) so the
   UI can draw globe pins.
6. Tests: follow/unfollow/leaderboard shape/presence expiry (fake clock).
7. Wire types mirrored to frontend/mobile types files.

## Phase 3 — web UI (only after the captions presentation work has landed)

1. Auth: HUD shows "Sign in" when anonymous → glass modal with
   login/signup tabs; after auth, show the username and a sign-out menu.
   On 401 `account_required` anywhere, open this modal with a friendly
   nudge ("Create a free account on this server to save your progress").
2. Friends panel: HUD button next to Progress. Add-friend input (exact
   username), list rows: display name, streak 🔥 n, quizzes, accuracy,
   vocab count, and "listening to <station>, <country>" when live; unfollow
   on hover. Leaderboard order.
3. Presence heartbeat from `useRadio` while playing (authed only).
4. Globe: friend pins — gold-ringed dot at the friend's current station
   with a small username label; clicking tunes to that station. Reuse the
   favorites pin pathway in `GlobeView`.
5. Playwright verification with two signed-up users (two browser contexts):
   user A follows B, sees B's presence row and globe pin while B plays a
   station. Screenshots for the record.

## Phase 4 — mobile parity (later, separate dispatch)

Mirror Phase 3 in React Native: auth screen, friends panel, heartbeat.

## Verification (every phase)

- `npm run typecheck` and `npm test` from repo root — clean.
- Phase 1/2 must not touch `frontend/src` (beyond `types.ts`), `mobile/`
  (beyond `src/types.ts`), or anything the captions redesign is editing
  (`frontend/src/components/CaptionsPanel.tsx`, `frontend/src/styles.css`,
  `frontend/src/App.tsx`).
- No `git commit`; leave no processes running; append a SESSION.md entry.
