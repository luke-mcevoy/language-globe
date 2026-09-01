# Mobile parity — karaoke captions, word lookup, ambient scenes

Goal: bring `mobile/` (Expo RN app) to parity with the web app's three newest
features. **All server APIs already exist — do not touch `server/` or
`frontend/`.** The web implementations are the source of truth for behavior;
mirror them natively, don't redesign them.

The work is split into three phases that are dispatched as separate tasks.
Each phase must leave the app working on its own.

Shared context for every phase:

- Reference implementations:
  - `frontend/src/components/CaptionsPanel.tsx` (karaoke, lookup popover, scene card)
  - `frontend/src/lib/captionSync.ts` (`findActiveChunk`, `findActiveWordIndex`)
  - `frontend/src/components/StatsPanel.tsx` (`VocabSection`)
  - `frontend/src/api.ts` (endpoint shapes), `frontend/src/types.ts`
- Mobile files you will touch: `mobile/src/components/CaptionsPanel.tsx`,
  `mobile/src/components/StatsPanel.tsx`, `mobile/src/hooks/useRadio.ts`,
  `mobile/src/lib/api.ts`, `mobile/src/types.ts`, `mobile/App.tsx` (prop wiring).
- Types: copy `CaptionWord`/`words` on `CaptionChunk`, `VocabEntry`,
  `VocabResponse`, `VocabLookupResponse`, `SceneResponse` from
  `frontend/src/types.ts` into `mobile/src/types.ts` (keep field names identical;
  `HealthResponse.scenesEnabled` already exists there).
- Keep the existing mobile visual language (dark glass panels, `#54e6c3`
  accent, StyleSheet objects colocated in the component files).

## Phase 1 — synced karaoke captions

Today mobile polls the caption session and shows plain text chunks while the
LIVE stream plays — so captions trail the audio by ~15–20 s and there is no
word highlighting. Recreate the web's sync mode:

1. **Delayed audio.** After creating the caption session, keep polling
   `GET /api/captions/session/:id?after=seq`; the response's
   `audioBufferedMs` reports how much relay audio the server has buffered.
   With `delaySeconds = chunkSeconds + 5` and `SYNC_MARGIN_MS = 8000`
   (same constants as web), show a "Syncing audio · N%" progress row until
   `audioBufferedMs >= delaySeconds * 1000 + SYNC_MARGIN_MS`
   (extrapolate between polls with elapsed wall time, as the web panel does).
   Then switch playback to the relay:
   `GET {API_URL}/api/captions/session/:id/audio?delay={delaySeconds}` via the
   existing `player.replace({ uri })` in `mobile/src/hooks/useRadio.ts`.
   Add an `setAudioUrlOverride(url | null)` affordance to the hook mirroring
   the web `useRadio`: when an override is set, the player plays it instead of
   `station.url`; clearing it (panel closed, station changed) returns to the
   live stream. Closing the captions panel MUST restore the live stream.
2. **Session clock.** On the relay stream, playback position maps 1:1 to the
   chunk timeline: `sessionMs = player currentTime in seconds * 1000`.
   `useAudioPlayerStatus` only updates every ~500 ms, so run a ~150 ms
   interval that interpolates: `sessionMs = (status.currentTime + (playing ?
   (Date.now() - statusReceivedAtMs) / 1000 : 0)) * 1000`. Clamp
   interpolation at +600 ms past the last status to avoid runaway drift when
   status updates stall.
3. **Karaoke rendering.** Port `findActiveChunk` and `findActiveWordIndex`
   from `frontend/src/lib/captionSync.ts` into `mobile/src/lib/captionSync.ts`
   unchanged (they are pure). In the feed, render the currently-playing chunk
   as nested `<Text>` per word: past words dimmed (`#7f8ba6`), the active word
   as an accent "pill" (accent background `#54e6c3`, dark text `#052019`,
   small borderRadius), future words bright (`#d7dff2`). Other chunks render
   as plain text like today. Music chunks (`text === '♪ music ♪'`) render as
   the dimmed italic row they already do.
4. **Status row.** Footer shows `karaoke · audio {delaySeconds}s behind live`
   once synced (web wording).
5. Buffering the delay takes ~20–25 s after opening captions; audio is silent
   in that window by design (web behaves the same). Keep the progress row
   visible the whole time so it reads as loading, not broken.

## Phase 2 — tap a word to translate + vocab list

1. **API.** Add to `mobile/src/lib/api.ts`:
   `lookupWord(word, context, stationName)` → POST `/api/vocab/lookup`;
   `getVocab()` → GET `/api/vocab`; `removeVocabWord(id)` → DELETE
   `/api/vocab/{id}`. Same request/response shapes as `frontend/src/api.ts`.
2. **Tap.** Every word in every caption chunk (karaoke or plain — split plain
   text on whitespace) is tappable (nested `<Text onPress>`). On tap:
   - strip surrounding punctuation exactly like the web `cleanWord`
     (`/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu`); ignore empty results;
   - pause playback via the radio hook;
   - open a lookup sheet.
3. **Lookup sheet.** RN cannot cheaply anchor a popover to a nested text run,
   so use a fixed sheet docked to the bottom of the captions panel (inside the
   panel, above the footer): bold accent word, then translation +
   grammar note once loaded ("translating…" meanwhile; error text on failure),
   a "✓ Saved to your vocab" line (with "· looked up N×" when
   `timesLookedUp > 1`), and two buttons: **▶ Resume** (closes sheet, resumes
   playback) and **Close** (closes sheet, stays paused). The lookup call is
   `lookupWord(cleanedWord, chunk.text, station.name)` and saving happens
   server-side automatically.
4. **Vocab list.** In `mobile/src/components/StatsPanel.tsx`, add a
   "Words you looked up" section mirroring the web `VocabSection`: fetched on
   mount, newest first, each row = word (accent, bold) — translation — dimmed
   note, an "N×" count badge when > 1, and a small ✕ that removes the entry
   (optimistic update, `removeVocabWord`). Hide the section when the list is
   empty.

## Phase 3 — ambient scene card

1. **API.** Add `generateScene(sessionId)` → POST `/api/scene` to
   `mobile/src/lib/api.ts` (`SceneResponse.image` is a `data:image/png;base64`
   URL that RN `<Image source={{ uri }}>` renders directly).
2. **Card.** At the top of the captions panel feed, when
   `health.scenesEnabled` (already in `HealthResponse`) and a session exists:
   3:2 aspect-ratio rounded card. Request a scene immediately when the session
   starts, then every 45 s (`SCENE_INTERVAL_MS = 45_000`), one request in
   flight at a time; on failure just retry on the next tick (the sidecar may
   be warming up — first generation can take ~45 s, so use a generous fetch
   timeout). Cross-fade new images with `Animated` opacity (~1.4 s). Overlay
   the returned `prompt` on the bottom of the image (2-line clamp, dark
   gradient) — provenance, same as web.
3. Wire `scenesEnabled` from the health response through `App.tsx` to the
   panel. When disabled or no scene yet, render nothing (no placeholder box).

## Constraints (every phase)

- Do NOT modify `server/`, `frontend/`, or anything outside `mobile/`.
- Do NOT `git commit`, do NOT start dev servers/simulators or leave processes
  running. Work on the currently checked-out branch.
- Verify with `npx tsc --noEmit` in `mobile/` (must be clean) and run
  `npm test` from the repo root to prove nothing else broke.
- Append a short handoff entry to SESSION.md describing what you changed.
