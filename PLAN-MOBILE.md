# Language Globe — Mobile App (Expo / React Native)

Bring the existing web experience to the phone as a third workspace,
`mobile/`, sharing the existing Fastify server (`server/`). Feature parity
with the web app: 3D globe, live radio, comprehension quizzes, progress
stats. The server is untouched except where explicitly noted.

## Architecture

- `mobile/` is an Expo app (TypeScript, expo-router or a simple single-screen
  + modals structure — this app has one main view, don't over-navigate).
- It talks to the same REST API as `frontend/` (`/api/stations`,
  `/api/health`, `/api/quiz/start`, `/api/quiz/submit`, `/api/stats`).
- API base URL resolution, in order:
  1. `EXPO_PUBLIC_API_URL` env var if set,
  2. in dev, derive the host from Expo's `Constants.expoConfig.hostUri`
     (the Metro host is the same machine running the server) with port 8787,
  3. fall back to `http://localhost:8787`.
- NOTE for the server: it currently binds 127.0.0.1. Add `HOST` env support
  (default stays 127.0.0.1; `HOST=0.0.0.0` exposes it on the LAN for the
  phone) and mention it in the README. Also ensure CORS allows any origin in
  dev (mobile fetches come from a non-web origin; verify @fastify/cors setup
  covers this).

## The globe (centerpiece — invest here)

- Render with `three` + `three-globe` (the DOM-free core under
  react-globe.gl) on `expo-gl`, driven by a manual render loop
  (`GLView.onContextCreate`, `Renderer` from `expo-three`).
- Reuse the day/night terminator shader from
  `frontend/src/components/GlobeView.tsx` (plain GLSL, no DOM dependency)
  and the same `solar.ts` subsolar-point math — copy it into
  `mobile/src/lib/solar.ts` (keep the same tests-passing implementation;
  duplication is fine for now, do NOT restructure the frontend workspace).
- Textures: same unpkg three-globe example textures (blue marble, night
  lights, topology). Load with expo-compatible texture loading
  (`TextureLoader` from expo-three or THREE.TextureLoader with remote URLs).
- Station pins as three-globe points (same popularity sizing, same
  talk/music/unknown colors as `KIND_COLORS` on the web). Playing station
  gets a pulsing ring.
- Touch: one-finger drag rotates, pinch zooms (altitude clamp), tap selects
  the nearest station within a small screen-space radius (raycast against
  the globe, then nearest station by great-circle distance; a plain
  raycaster against point sprites is too fiddly on touch).
- Idle auto-rotation when nothing is playing.
- Starfield or dark gradient background; match the web app's dark, glassy
  aesthetic.
- If expo-gl + three-globe proves genuinely unworkable, the fallback is a
  WebView embedding the web globe — but exhaust the native path first and
  record findings in SESSION.md.

## Radio player

- `expo-audio` for playback of the station `url` (icecast MP3/AAC and HLS
  both play natively on iOS/Android through the system player).
- Configure background audio (iOS `UIBackgroundModes: audio` via app.json
  plugins config) so radio keeps playing with the screen off.
- Bottom player bar mirroring the web: station name, flag, place, local
  time, tags, play/pause, quiz button. Mark dead stations and fall back
  gracefully on stream errors.

## Quiz + stats

- Same flows and API contracts as `frontend/src/components/QuizPanel.tsx`
  and `StatsPanel.tsx`: difficulty picker, 60s capture countdown (the phone
  keeps playing the same stream), answering, grading review with transcript,
  not-enough-speech path with the suggested talk station.
- Stats screen: accuracy over time (use `react-native-svg` + a lightweight
  chart or victory-native; keep it simple), passport country grid, streak.
- Reuse types by copying `frontend/src/types.ts` into `mobile/src/types.ts`
  (a shared package is not worth the metro/workspace friction yet — note
  this as future work in SESSION.md).

## Constraints

- Workspaces: `mobile` is already added to the root package.json workspaces
  and its dependencies are pre-installed — do NOT run `npm install` for new
  packages without checking SESSION.md notes; if a package is genuinely
  missing, record it in SESSION.md and code against it anyway.
- TypeScript strict. `npx tsc --noEmit` inside `mobile/` must pass.
- Verify the bundle compiles with `npx expo export --platform ios` (headless
  bundling check — no simulator needed). Do not launch simulators, do not
  run `expo start`, do not leave any long-lived process running.
- Do NOT git commit or push.
- Update README.md with a Mobile section: how to run (`npm run dev:server`
  with `HOST=0.0.0.0`, `npx expo start` in mobile/, scan QR with Expo Go),
  and the EXPO_PUBLIC_API_URL override.
- Append a handoff entry to SESSION.md when done.
