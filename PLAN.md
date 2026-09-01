# Language Globe — Live Radio, Quizzes, and Progress Tracking

A webapp for language learners: a beautiful 3D globe of the Earth where you tune
into live radio anywhere in the world in your target language (Spanish first),
take AI comprehension quizzes on 60-second clips of what you just heard, and
track your progress over time.

This repo is `github.com/luke-mcevoy/language-globe`. Target language is a
config parameter (default `spanish`) used by the station query and quiz
prompts — never hardcode "spanish" in logic, only in config defaults.

## Architecture

```
frontend (Vite + React + TS)          server (Node + Fastify + TS)
  3D globe (react-globe.gl)    <-->     GET  /api/stations   (Radio Browser cache)
  audio player (hls.js)        <-->     POST /api/quiz/start (capture -> transcribe -> questions)
  quiz panel                   <-->     POST /api/quiz/submit (grade + store)
  stats / passport view        <-->     GET  /api/stats      (SQLite aggregates)
```

Monorepo layout: `frontend/` and `server/` as npm workspaces (root package.json
with `npm run dev` running both via concurrently).

## Stack (decided — do not substitute)

- Frontend: Vite + React + TypeScript, `react-globe.gl` for the globe,
  `hls.js` for HLS streams, `recharts` for the stats chart.
- Backend: Node + TypeScript, Fastify, `better-sqlite3` for persistence,
  whisper.cpp for transcription and Ollama (`qwen2.5:7b-instruct`) for
  quiz generation and word translation. Features disable cleanly when a
  local model is missing.
- Stations: Radio Browser API (free, no key). Query
  `https://all.api.radio-browser.info/json/stations/search` with
  `language=<target>&has_geo_info=true&hidebroken=true&order=clickcount&reverse=true`,
  limit ~1500. Set a descriptive User-Agent header (Radio Browser asks for one),
  e.g. `language-globe/0.1`. Cache the result on the server for 6 hours
  (in-memory + SQLite fallback so restarts don't refetch).
- Local models: whisper.cpp (`WHISPER_MODEL_PATH`) and Ollama
  (`OLLAMA_URL` / `OLLAMA_MODEL`). Commit a `server/.env.example`.
  Everything except captions, quizzes, and word lookup must work without
  them. The UI must show a friendly disabled state that names the missing
  local model (server exposes `GET /api/health` including `quizEnabled`
  and `captionsEnabled`).

## Features

### 1. Beautiful 3D globe (this is the centerpiece — invest in it)
- react-globe.gl with: NASA Blue Marble day texture and night city-lights
  texture (use the ones bundled/CDN'd with globe.gl examples:
  `//unpkg.com/three-globe/example/img/earth-blue-marble.jpg`,
  `earth-night.jpg`, `earth-topology.png`), a starfield background,
  atmosphere glow (globe.gl's atmosphere with tuned color/altitude).
- Day/night: compute the current subsolar point from the real UTC time and
  render a day/night terminator (globe.gl supports custom globe material;
  a simple approach is a shader mixing day and night textures by sun
  direction — implement this, it is the wow factor).
- Stations as glowing pins/points, sized by popularity (clickcount), colored
  by quiz-friendliness (talk/news = one color, music = another). The playing
  station pulses (animated ring).
- Hover tooltip: station name, city/country, genre tags, local time at the
  station (from geo lon or country timezone).
- Click a station to tune in. Smooth camera flight to the station.
- "Surprise me" button: pick a random station, prefer countries the user has
  not yet visited (from stats), fly the camera there and start playing.
- Slow idle auto-rotation when nothing is selected.

### 2. Radio player
- HTML5 `<audio>` playing the station's `url_resolved` directly. If the URL
  is `.m3u8`/HLS, use hls.js. Handle stream errors gracefully (show "station
  offline, try another" and mark the station dim).
- Bottom player bar: station name, place, country flag emoji, genre tags,
  local time at station, play/pause, volume, and the "Quiz me" button.

### 3. Comprehension quiz (needs Ollama + whisper.cpp)
- POST /api/quiz/start { stationId, difficulty }: server opens the station's
  stream URL with fetch, buffers ~60 seconds of the raw MP3/AAC bytes
  (respect ICY/icecast: strip metadata if `icy-metaint` is present, or
  simply request without `Icy-MetaData` header so no metadata is interleaved),
  writes to a temp file with correct extension inferred from content-type,
  sends to local whisper.cpp transcription (language hint = target language).
  While capturing, the frontend shows a "listening along with you — keep
  listening!" countdown (the user hears the same content live).
- Music detection: if the transcript is very short relative to 60s of audio
  (< ~40 words) treat it as music/low-speech: return
  `{ kind: "not_enough_speech", transcript }` and the UI suggests switching
  to a talk/news station (offer one).
- Otherwise generate 4 multiple-choice questions from the transcript via the
  LLM (JSON mode / structured output): question, 4 options, correct index,
  brief explanation. Difficulty ladder: "beginner" = questions and options in
  English; "intermediate" = questions in the target language.
- POST /api/quiz/submit { quizId, answers }: grade server-side, store the
  result in SQLite, return per-question correctness + explanations + the full
  transcript for review. The UI shows score, lets the user read the
  transcript, and highlights what they missed.
- Store quizzes and transcripts server-side (SQLite) keyed by quizId so
  grading cannot be spoofed and history is reviewable.

### 4. Progress tracking (SQLite, single-user for now)
- Tables: `users` (single row for now, id 1 — exists so future social version
  is a migration not a redesign), `quiz_results` (user, station id/name,
  country code, difficulty, n questions, n correct, transcript word count,
  created_at), plus `stations_cache`.
- GET /api/stats: accuracy over time (last 30 days, daily), overall accuracy,
  totals, per-country breakdown (attempts + accuracy), countries visited,
  current daily streak.
- Stats view (modal or side panel): accuracy-over-time line chart (recharts),
  per-country table, "listening passport" — grid of country flags visited
  with quiz counts, and streak display.

## UI/design bar

Dark, elegant, space-like. The globe fills the screen; UI floats over it in
glassy panels (backdrop-blur). One accent color used sparingly. Good
typography (system font stack or Inter). No component library needed — hand
CSS is fine, but it must look intentional, not default. Loading and error
states everywhere (stations loading, stream failing, quiz capturing,
transcribing, generating).

## Constraints

- TypeScript strict everywhere; no `any` unless unavoidable.
- Do NOT run long-lived dev servers as your final verification step (this is
  a headless session — it would hang). Verify with `npm run build` in both
  workspaces and `tsc --noEmit`, plus unit tests where cheap (the quiz
  grading and stats aggregation logic are good test targets; vitest).
- Do NOT git commit/push — the supervising session handles git.
- Write a README.md: what it is, setup (npm install, .env, npm run dev),
  architecture sketch, roadmap note (v2: shareable challenge links,
  v3: friends + leaderboards, other languages).
- .gitignore: node_modules, dist, .env, SQLite db files, temp audio.
- Keep the server's temp audio files cleaned up after transcription.
