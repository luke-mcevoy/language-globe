# Language Globe

**Spin a 3D Earth, tune into live radio anywhere in the world, and learn a language from what's actually on the air right now.**

Live streams get synced karaoke captions with word-by-word highlighting, any word you don't know is one click away from a translation, and a comprehension quiz is generated from the last minute of whatever you were listening to. Sign in to save vocab, favorites, quiz history, and to follow friends. The target language is configurable and defaults to Spanish.

New visitors get a six-step welcome tour (replay it anytime with **?** in the header).

![Live karaoke captions following a merengue station in Ecuador](docs/media/demo-karaoke.gif)

## What it does

### 1,400+ live stations on a 3D globe

Every pin is a real radio station streaming right now, colored by content type. Click a pin — or hit **Surprise me** — and you're listening within seconds, with the station's local time and genre in the player. Dead streams are dimmed.

The legend in the corner is a filter: click **talk / news**, **music**, or **unlabelled** to solo that kind; click more to add them; **show all** clears it. **Surprise me** respects the filter.

### Synced karaoke captions

Press **CC** and the app buffers the stream for a few seconds so it can transcribe *ahead* of what you hear. Captions appear as cinematic subtitles over the globe — words light up one-by-one exactly as they're spoken. Timing comes from whisper.cpp's DTW-aligned token timestamps, not interpolation. Music passages collapse to a ♪ marker.

![Word-level karaoke highlighting on a live stream](docs/media/karaoke.png)

### Click a word you don't know

Clicking any caption word pauses the radio and pops up the English translation with a short grammar note (part of speech, dictionary form). Signed-in users save the word to their vocab list automatically; looking it up again just bumps a counter. Anonymous visitors still get the translation, with a prompt to sign in to save.

![Clicking "Dios" pauses the stream and shows the translation](docs/media/word-lookup.png)

### Comprehension quizzes from live radio

**Quiz me** captures the next 60 seconds of audio, transcribes it, and generates four multiple-choice questions about what was just said — graded server-side against the transcript, which you can review afterwards.

![A generated quiz about a live Colombian radio program](docs/media/quiz.png)

### Accounts, progress, and friends

Create a username on this server (no email). Signed-in you get:

- **Favorites** — star a station; gold pins on the globe; list under Favorites
- **Progress** — accuracy over time, daily streaks, countries you've quizzed in, saved vocab
- **Friends** — follow people, see who's listening live as gold pins, compete on the leaderboard

![Progress panel with stats, passport, and the vocab list](docs/media/progress.png)

## Local models only

The app runs strictly on models on your machine. If a local model is missing, that feature is disabled — there is no cloud fallback.

| Task | Local model |
| --- | --- |
| Transcription + word timing | whisper.cpp (`whisper-server`, DTW alignment) |
| Quiz generation | Ollama (`qwen2.5:7b-instruct`) |
| Word translation | Ollama (`qwen2.5:7b-instruct`) |

Install whisper.cpp (a ggml model at `WHISPER_MODEL_PATH`, plus `whisper-server` or `whisper-cli`) for captions. Install Ollama and run `ollama pull qwen2.5:7b-instruct` for quizzes and word lookup.

## Setup

```bash
npm install
cp server/.env.example server/.env
npm run dev
```

The Vite frontend runs on `http://127.0.0.1:5173` and proxies API requests to the Fastify server on `http://127.0.0.1:8787`.

The globe, station search, player, and stats work with no configuration. Captions need whisper.cpp (`WHISPER_MODEL_PATH` plus `whisper-server` or `whisper-cli`). Quizzes and word lookup need Ollama at `OLLAMA_URL`. Favorites, vocab saves, quiz history, and friends need an account (sign up in the app).

Useful environment settings:

```bash
TARGET_LANGUAGE=spanish
WHISPER_MODEL_PATH=models/ggml-large-v3-turbo.bin
# Or point at a whisper-server you already started (typical for Docker + Metal):
# WHISPER_SERVER_URL=http://127.0.0.1:8788
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:7b-instruct
CAPTURE_SECONDS=60
DB_PATH=data/language-globe.sqlite
PORT=8787
HOST=127.0.0.1
```

`ffmpeg` is recommended for capture from HLS, AAC, Ogg, or unlabeled radio streams. Plain MP3/M4A/WAV/WebM streams can be captured directly.

## Docker

Every merge to `main` publishes a ready-to-run image to GitHub Container Registry (`.github/workflows/docker.yml`). The container serves the web UI and the API on one port and bundles ffmpeg:

```bash
docker run -p 8787:8787 ghcr.io/luke-mcevoy/language-globe:latest
# open http://localhost:8787
```

The globe, live radio, accounts, favorites, and stats work with no extra models. For **captions**, run whisper-server on the host (Metal on a Mac) and point the container at it. For **quizzes and translation**, point `OLLAMA_URL` at a reachable Ollama:

```bash
# Host: whisper.cpp with DTW word timing (required for karaoke)
whisper-server -m server/models/ggml-large-v3-turbo.bin -l es \
  --port 8788 --host 127.0.0.1 --dtw large.v3.turbo --no-flash-attn

docker run --name language-globe -p 8890:8787 \
  -e WHISPER_SERVER_URL=http://host.docker.internal:8788 \
  -e OLLAMA_URL=http://host.docker.internal:11434 \
  -v language-globe-data:/data \
  --restart unless-stopped \
  ghcr.io/luke-mcevoy/language-globe:latest
# open http://localhost:8890
```

To build the image yourself: `docker build -t language-globe .`

## Sharing it on the internet

The app is meant to run on your machine so captions and quizzes can use local GPU models. A Cloudflare quick tunnel publishes `localhost` over HTTPS without opening ports:

```bash
cloudflared tunnel --url http://localhost:8890 --protocol quic --edge-ip-version 4
```

Friends open the `https://….trycloudflare.com` URL. Your Mac has to stay awake; if the laptop sleeps, the site goes down. Quick-tunnel URLs change if the tunnel process restarts (`grep trycloudflare /tmp/lg-tunnel.log` shows the current one). A stable hostname needs a Cloudflare account and a domain.

On iPhone Safari, add the page from the share sheet or just use the URL — the web UI is laid out for phones (the Expo app in `mobile/` is the native client).

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
  cinematic karaoke captions   <-->     POST /api/captions/session   (+ poll, delayed audio relay)
  word lookup popover          <-->     POST /api/vocab/lookup, GET /api/vocab
  quiz panel                   <-->     POST /api/quiz/start, POST /api/quiz/submit
  stats / passport             <-->     GET  /api/stats
  accounts                     <-->     POST /api/auth/signup, /login, /logout; GET /api/auth/me
  favorites                    <-->     GET/PUT/DELETE /api/favorites/:stationId
  friends / leaderboard        <-->     /api/social/follow, /presence, /leaderboard, /friends-listening
```

Stations come from Radio Browser and are cached for six hours in memory and SQLite. The server stores accounts, quizzes, transcripts, answer keys, graded results, vocab lookups, favorites, and follows locally. Grading is server-side so progress can be aggregated over time.

## Roadmap

v1 (current): globe, live radio, karaoke captions, quizzes, accounts, favorites, friends, phone web layout.  
v2: shareable challenge links, more target languages.  
v3: stable public hostname that does not depend on a laptop staying awake.
