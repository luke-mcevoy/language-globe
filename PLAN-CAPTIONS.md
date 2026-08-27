# Live captions — rolling Spanish transcription of the playing station

Goal: while listening, the user can toggle "Live captions" and see the
Spanish words scroll on screen shortly after they are spoken, so they can
read along with what they hear. Requires OPENAI_API_KEY (same flag as
quizzes: hidden/disabled when `quizEnabled` is false).

## How it works (keep it this simple)

Rolling chunk loop, client-driven — no websockets, no server sessions:

1. Client (captions on): POST /api/captions { stationId } and await.
2. Server: reuse `captureStream(station.url, CAPTION_CHUNK_SECONDS)` from
   services/capture.ts with a ~15 second chunk (new config
   `captionChunkSeconds`, default 15), transcribe with the existing
   `transcribe()` (same language hint), return
   `{ text, chunkSeconds, capturedAt }`. Clean up the temp file (same
   pattern as the quiz route). Reuse CaptureError -> 502 mapping.
3. Client: append the text to the caption feed and immediately issue the
   next request while displaying the previous chunk. The feed runs
   ~chunk-length behind live; show a subtle "~15s behind live" hint once.
4. Toggle off / station change / quiz starts -> abort the in-flight fetch
   (AbortController) and stop looping. Do not caption while a quiz capture
   is running (the quiz owns the stream then; captions auto-pause and say
   so, then resume after).

Notes:
- Concurrency guard: captions open a second connection to the same stream
  (the audio element has one already). That is fine for icecast, but do not
  let caption requests stack: one in flight at a time, enforced client-side
  (server statelessness is fine).
- Empty/near-empty transcript chunk (music, jingles): render a dim
  "♪ music ♪" marker instead of blank text; keep looping.
- Keep the last ~40 chunks in the feed, oldest trimmed; auto-scroll pinned
  to the bottom unless the user has scrolled up.

## Web UI

- A "CC" toggle button in the player bar next to the quiz button (disabled
  with a tooltip when quizzes/captions are unavailable — no key).
- Captions render in a glassy panel above the player bar: scrolling feed of
  chunks, newest highlighted; word count and "behind live" hint in a muted
  footer. Esc or the toggle closes it. Matches the existing dark aesthetic.
- While a chunk is pending: a subtle pulsing ellipsis at the feed's bottom.

## Mobile UI (mobile/ workspace)

- Same feature in the mobile player: a CC toggle; captions as an overlay
  panel above the player bar. Reuse the same /api/captions endpoint and the
  same client-side loop/abort pattern.
- If the mobile workspace's player structure makes this heavy, ship web
  first and record what is missing in SESSION.md.

## Constraints

- Do NOT change the quiz flow's behavior; captions share helpers
  (captureStream, transcribe) but no shared mutable state.
- New config: `captionChunkSeconds` (env CAPTION_CHUNK_SECONDS, default 15),
  surfaced in /api/health as `captionsEnabled` (same condition as
  quizEnabled) and `captionChunkSeconds`.
- Unit-test the caption text handling that is cheap to test (e.g. the
  music-marker threshold decision if implemented server-side).
- typecheck + build + tests must pass in every workspace touched.
- Do NOT git commit or push; do not leave processes running.
- Append a SESSION.md handoff entry.
