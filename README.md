# Language Globe

Language Globe is a language-learning web app for tuning into live radio around the world. It shows a 3D Earth with station pins, plays live streams in the browser, generates comprehension quizzes from the last minute of audio when an OpenAI API key is configured, and tracks quiz progress in a local SQLite database.

The target language is configurable and defaults to Spanish.

## Setup

```bash
npm install
cp server/.env.example server/.env
npm run dev
```

The Vite frontend runs on `http://127.0.0.1:5173` and proxies API requests to the Fastify server on `http://127.0.0.1:8787`.

Quizzes are optional. Without `OPENAI_API_KEY`, the globe, station search, player, and stats UI still work, and the app shows a friendly disabled quiz state. To enable quizzes, add this to `server/.env` and restart:

```bash
OPENAI_API_KEY=your_key_here
```

Useful environment settings:

```bash
TARGET_LANGUAGE=spanish
OPENAI_QUIZ_MODEL=gpt-4o-mini
OPENAI_TRANSCRIBE_MODEL=whisper-1
CAPTURE_SECONDS=60
DB_PATH=data/language-globe.sqlite
PORT=8787
HOST=127.0.0.1
```

`ffmpeg` is recommended for quiz capture from HLS, AAC, Ogg, or unlabeled radio streams. Plain MP3/M4A/WAV/WebM streams can be captured directly.

## Mobile

The Expo app lives in `mobile/` and uses the same Fastify API. For phone testing, expose the server on your LAN:

```bash
HOST=0.0.0.0 npm run dev:server
cd mobile
npx expo start
```

Scan the QR code with Expo Go. The app resolves the API URL from `EXPO_PUBLIC_API_URL` first, then from Expo's dev host with port `8787`, then falls back to `http://localhost:8787`.

Use an explicit override when the automatic LAN address is not right:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:8787 npx expo start
```

## Scripts

```bash
npm run typecheck
npm run build
npm test
npm run dev
npm start
```

## Architecture

```text
frontend (Vite + React + TS)          server (Node + Fastify + TS)
  3D globe (react-globe.gl)    <-->     GET  /api/stations
  audio player (hls.js)        <-->     GET  /api/health
  quiz panel                   <-->     POST /api/quiz/start
  stats / passport view        <-->     POST /api/quiz/submit
                                      GET  /api/stats
```

Stations come from Radio Browser and are cached for six hours in memory and SQLite. The server stores quizzes, transcripts, answer keys, and graded results locally so grading is server-side and progress can be aggregated over time.

## Roadmap

v2: shareable challenge links.  
v3: friends, leaderboards, and more target languages.
