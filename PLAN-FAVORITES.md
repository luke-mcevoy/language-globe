# Favorites — let the profile save stations

Goal: the user can favorite stations and get back to them quickly, on web
and mobile. Favorites belong to the user row (users.id = 1 for now), same
future-proofing rule as quiz_results.

## Server

- New table `favorites`: id INTEGER PK, user_id (FK users), station_id TEXT,
  station_name, country, country_code, lat REAL, lon REAL, kind TEXT,
  url TEXT, created_at TEXT. UNIQUE(user_id, station_id).
  Snapshot the station fields so a favorite still renders if the station
  drops out of the Radio Browser index (mark it `missing` in that case).
- Routes:
  - GET  /api/favorites            -> { favorites: [...] } (joined against
    the current station index to refresh live fields + a `missing` flag)
  - PUT  /api/favorites/:stationId -> add (404 if station unknown)
  - DELETE /api/favorites/:stationId -> remove
- Unit tests for the favorites store logic (add/remove/idempotent add/list).

## Web UI

- Heart toggle in the player bar next to the station name (filled when
  favorited). Optimistic update, revert on error.
- A "Favorites" button in the top HUD (next to Progress) opening a glass
  panel listing favorites: flag, name, place, kind, local time; click to
  tune (flies the globe there); trash/heart to remove; empty state with a
  friendly hint. Esc closes.
- Favorited stations get a distinct look on the globe (e.g. warm gold pin
  color that overrides kind color, slightly larger radius).

## Mobile UI

- Same heart toggle in the mobile player bar; favorites list accessible
  from the HUD; tapping tunes. Match the existing mobile aesthetic.

## Constraints

- Keep the single-user assumption confined to the same place the rest of
  the code does it (CURRENT_USER_ID).
- typecheck + build + tests green in all workspaces (root npm run
  typecheck/build/test, plus npx tsc --noEmit in mobile/).
- Do NOT git commit; no processes left running; append SESSION.md entry.
