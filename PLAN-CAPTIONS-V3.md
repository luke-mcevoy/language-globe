# Captions v3 — word-level karaoke highlighting in Sync mode

Goal: in Sync mode, the word currently being spoken is highlighted in the
caption feed, one to one, like karaoke. Builds directly on the captions v2
session + delayed-audio relay (see PLAN-CAPTIONS-V2.md; assume it is
merged and working).

## Server — word timestamps from the provider layer

- Extend the transcription provider interface to optionally return
  `words: { word: string; startMs: number; endMs: number }[]` per chunk,
  where times are relative to the CHUNK start. The session then republishes
  them relative to the SESSION start (chunkOffsetMs + wordStartMs) so the
  client has one time axis.
- local-whisper:
  - whisper-server: request word-level detail (OpenAI-compatible
    `response_format=verbose_json` with word granularity if the build
    supports it; otherwise fall back to whisper-cli for caption chunks).
  - whisper-cli fallback: `-ojf` (full JSON output) gives token-level
    timestamps — merge tokens into words (tokens starting with a space
    begin a new word; strip punctuation-only tokens). Alternatively
    `-ml 1` emits one word per segment with timings. Choose whichever
    proves more robust; unit-test the token->word merge with a fixture of
    real whisper-cli JSON output.
- openai provider: `timestamp_granularities: ["word"]` with
  `response_format: "verbose_json"` on whisper-1 returns words directly.
- If word data is unavailable (provider variant, error), the chunk still
  works with text only — the client degrades to chunk-level highlighting
  (v2 behavior). `words` is optional everywhere.
- Caption session GET responses include the words array per chunk.

## Client (web required, mobile if straightforward)

- Sync mode already plays audio at a known delay D behind the session
  clock. Playback position on the session time axis =
  (now - audioStartWallClock) or better: anchor on the audio element's
  currentTime plus the relay's known starting offset. Re-anchor at each
  chunk boundary to cancel drift (MP3 frame granularity and VBR make pure
  currentTime drift over minutes).
- Render caption text word by word (spans). The word whose
  [startMs, endMs) window contains the current session-axis position gets
  a highlight (accent color + subtle glow); already-spoken words in the
  current chunk dim toward the normal text color; future words stay muted.
  Use requestAnimationFrame or a 100ms interval — cheap either way.
- In Live mode (non-delayed), keep plain chunk rendering — do not attempt
  word highlighting there (the words on screen were spoken ~15s ago; a
  moving highlight would be misleading).
- Auto-scroll keeps the highlighted word visible (unless user scrolled up,
  same rule as v2).

## Constraints

- Word timing accuracy is what whisper gives (~±0.1-0.3s typical). Do not
  fake smoothness by interpolating beyond word boundaries.
- typecheck + build + tests green everywhere; mobile tsc clean.
- Do NOT git commit; no processes left running; append SESSION.md entry.
