# PLAN-LOCAL-ONLY.md — remove ambient scenes; local models only

Two coupled cleanups, one task. Rationale: the owner wants zero OpenAI API
spend (transcription cost) and no AI scene images. After this change the app
must run fully on local models: whisper.cpp for transcription, Ollama for quiz
generation and word translation. If a local model is missing, the feature is
cleanly DISABLED (health flags false, friendly UI copy) — never silently
routed to a paid API.

## Phase A — remove the ambient scene feature everywhere

Delete outright:
- `server/src/routes/scene.ts`
- `server/src/services/scenes.ts`
- `server/test/scenes.test.ts`
- `scene-server/` (the whole Python sidecar directory)

Server edits:
- `server/src/index.ts`: drop `registerSceneRoutes` and the `scenesEnabled`
  health field.
- `server/src/types.ts`: remove `scenesEnabled` from `HealthResponse`; remove
  `SceneResponse`.
- `server/src/config.ts`: remove `sceneServerUrl`.
- `server/src/services/openai.ts`: remove `SCENE_SCHEMA`,
  `buildSceneDescriptionPrompt`, `parseSceneDescription`, `describeScene`
  (Phase B restructures the rest of this file).
- `server/src/services/providers.ts`: remove `describeSceneOllama`,
  `describeScene`, and their imports.
- `server/src/services/captionSessions.ts`: remove `recentText()` — grep
  first; it exists only for the scene route. Remove its tests in
  `server/test/captionSessions.test.ts` if present.

Frontend edits:
- `frontend/src/components/CaptionsPanel.tsx`: remove the `scenesEnabled`
  prop, all scene state/refs/effects, and the scene `<figure>` block.
- `frontend/src/App.tsx`: stop passing `scenesEnabled`.
- `frontend/src/api.ts`: remove `generateScene`.
- `frontend/src/types.ts`: remove `SceneResponse`.
- `frontend/src/styles.css`: remove `.captions__scene*` rules and the
  `scene-fade` keyframes.

Mobile edits (mirror of web):
- `mobile/src/components/CaptionsPanel.tsx`: remove `scenesEnabled` prop,
  scene state, the scene fetch loop, the Animated cross-fade effect, the
  scene card JSX, and scene styles.
- `mobile/App.tsx`: stop passing `scenesEnabled`.
- `mobile/src/lib/api.ts`: remove `generateScene`.
- `mobile/src/types.ts`: remove `SceneResponse`.

Repo/docs:
- `.dockerignore`: drop the `scene-server/` line.
- `README.md`: remove the ambient-scenes feature section, its row in the
  local-models table, its sidecar instructions, and any scene screenshots
  from the demo section (leave the karaoke/vocab/quiz content).

## Phase B — local models only (remove all OpenAI usage)

The shared prompt builders live in `server/src/services/openai.ts` next to
the OpenAI client code. Restructure:

1. Create `server/src/lib/prompts.ts` holding everything provider-neutral
   currently in `openai.ts`: `QUESTION_SCHEMA`, `TRANSLATION_SCHEMA`,
   `buildQuizPrompt`, `buildTranslationPrompt`, `parseWordTranslation`,
   and the `TranscribeResult` / `WordTranslation` types. Update all imports
   (`providers.ts`, routes, tests).
2. Delete `server/src/services/openai.ts` and remove the `openai` package
   from `server/package.json` dependencies if present.
3. `server/src/services/providers.ts`:
   - Remove `openaiAvailable` from probes and state; drop the OpenAI
     branches in `resolveTranscribeProvider` / `resolveQuizProvider` (modes
     shrink to `auto`/`local` and `auto`/`ollama`; unknown values → auto).
     Provider unions become `'local-whisper' | 'unavailable'` and
     `'ollama' | 'unavailable'`.
   - `transcribeChunk`, `generateQuizQuestions`, `translateWord`: remove the
     OpenAI fallback arms — on local failure, rethrow.
4. `server/src/config.ts` and `server/.env.example`: remove `OPENAI_API_KEY`
   and any OpenAI model settings; keep whisper/Ollama settings.
5. `server/src/types.ts` (+ mirrored `frontend/src/types.ts`,
   `mobile/src/types.ts`): update provider union types on health.
6. User-facing disabled copy (web + mobile): where captions/quiz/lookup are
   disabled, the message should say which LOCAL model is missing and how to
   get it (whisper.cpp model path env / `ollama pull qwen2.5:7b-instruct`) —
   no OpenAI mentions anywhere in UI copy.
7. Tests: update `server/test` provider-resolution tests to the new
   local-only semantics; delete OpenAI-specific tests; keep/adjust the rest.
8. `README.md`: state plainly that the app is local-models-only and list the
   two dependencies (whisper.cpp + Ollama). Docker section: note that the
   published container currently ships WITHOUT whisper.cpp, so live captions
   are unavailable in the container until a later image bundles it; quizzes
   and lookups work by pointing `OLLAMA_URL` at a reachable Ollama.
9. Grep the whole repo for `openai` / `OPENAI` case-insensitively at the end;
   the only acceptable survivors are historical notes in SESSION.md.

## Verification (required)

- `npm run typecheck` and `npm test` from the repo root — clean.
- `npx tsc --noEmit` in `mobile/` — clean.
- `rg -i openai --glob '!SESSION.md' --glob '!PLAN-*.md'` returns nothing.
- Do NOT `git commit`; do not touch running dev servers or Docker containers.
