# Captions v2 — no repeated text, optional synced (delayed) playback

Two problems with captions v1, both rooted in how icecast works:

1. REPEATED TEXT (bug): each caption chunk opens a fresh connection to the
   stream, and icecast sends a burst-on-connect buffer (the last ~10-30s of
   audio) to every new connection. Consecutive chunks therefore overlap and
   the same sentences appear multiple times in the feed.
2. CAPTIONS TRAIL AUDIO (physics): a chunk cannot be transcribed until it
   has been fully spoken, so the feed runs ~chunk-length behind what the
   user hears.

## Fix 1 — persistent capture session (server)

Replace per-chunk connections with a caption session:

- POST /api/captions/session { stationId } -> { sessionId }. The server
  opens ONE connection to the stream (reuse capture.ts connection logic,
  including playlist/HLS handling) and continuously slices the byte stream
  into consecutive `captionChunkSeconds` windows: each window is written to
  a temp file, transcribed via the provider layer, appended to an in-memory
  ring of results ({ seq, text, capturedAt }), then deleted. No byte is
  captured twice; the burst buffer is consumed once at session start and
  should be DISCARDED (drop bytes for the first ~2s wall-clock after
  connect vs bytes-received delta, or simply drop the first partial window)
  so the session starts near-live rather than 30s in the past.
- GET /api/captions/session/:id?after=<seq> long-polls (up to ~25s) and
  returns chunks with seq > after. Client polls with the last seq it has.
- DELETE /api/captions/session/:id stops the capture and frees resources.
  Sessions also auto-expire after 10 minutes without a poll (timer reset on
  each poll) and there is a small cap (2) on concurrent sessions.
- Keep the stateless POST /api/captions endpoint for compatibility until
  both clients are migrated in this same change, then remove it.
- Unit-test the session store: slicing sequence numbers, after= filtering,
  expiry, cap.

## Fix 2 — Sync mode (client, web first)

Toggle inside the captions panel: "Live" vs "Synced" (default Synced).

- Synced mode: the client delays AUDIO playback by one chunk length +
  transcription margin (captionChunkSeconds + ~5s) so the newest caption
  chunk corresponds to the audio currently playing. Implementation on web:
  fetch the same stream through a server relay endpoint that serves from
  the caption session's already-buffered bytes with a configurable delay
  (GET /api/captions/session/:id/audio?delay=<s>, chunked transfer) — the
  session already holds the bytes, so no second upstream connection is
  needed. The audio element simply plays that URL while synced mode is on,
  and switches back to the direct stream URL for live mode.
- Highlight the caption chunk currently "playing" in synced mode.
- Show the mode and effective delay in the panel footer (e.g. "synced —
  audio delayed 20s"), replacing the "~15s behind live" hint.
- Mobile: implement the same session polling; synced audio mode may follow
  in a later change if expo-audio makes the relay approach awkward — if
  deferred, note it in SESSION.md.

## Constraints

- Providers layer (local whisper / openai) is used unchanged for the
  actual transcription.
- typecheck + build + tests green everywhere; mobile tsc clean.
- Do NOT git commit; no processes left running; append SESSION.md entry.
