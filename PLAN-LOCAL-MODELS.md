# Local models — free transcription and quiz generation

Goal: run transcription (the dominant cost) and quiz generation locally on
this machine, with OpenAI as an automatic fallback. After this change the
app should work fully with NO OpenAI key at all when local tooling is
present.

## Tooling already installed on this machine (do not install anything)

- `whisper-cli` (whisper.cpp via Homebrew, Metal-accelerated)
- Whisper model at `server/models/ggml-large-v3-turbo.bin`
- Ollama running as a service on http://127.0.0.1:11434 with model
  `qwen2.5:7b-instruct`
- ffmpeg (already used by capture.ts)

If any of these are missing at runtime the provider is simply reported
unavailable — never install from server code.

## Provider abstraction (server)

New `server/src/services/providers.ts` (or similar):

- Transcription providers: `local-whisper` and `openai`.
  - local-whisper: prefer `whisper-server` (installed at
    /opt/homebrew/bin/whisper-server) — spawn it once lazily on first use
    (`whisper-server -m <model> -l <lang> --port 8788 --host 127.0.0.1`),
    then POST each clip's WAV to its /inference endpoint (multipart field
    `file`, `response_format=json`). Keeping the model resident makes each
    chunk ~1-2s instead of ~10s of model load per whisper-cli run — this is
    what makes live captions feel live. Manage the child process: restart
    if it dies, kill on server shutdown. Fall back to one-shot `whisper-cli
    -m <model> -l <lang> -np -nt -f <wav>` if the server binary is missing.
  - Either path: convert the captured clip to 16 kHz mono WAV with ffmpeg
    first (same spawn pattern as capture.ts), clean up the wav, hard
    timeout (60s) with SIGKILL, same style as the existing ffmpeg guard.
  - openai: the existing transcribe().
  - VERIFIED on this machine end to end: 30s live COPE Sevilla capture ->
    ffmpeg wav -> whisper-cli with ggml-large-v3-turbo gave a clean Spanish
    transcript (19s including model load); ollama qwen2.5:7b-instruct with
    a JSON-schema `format` returned 2 valid, correct MCQs in 9s.
- Quiz-generation providers: `ollama` and `openai`.
  - ollama: POST http://127.0.0.1:11434/api/chat with model
    qwen2.5:7b-instruct, `format` set to the same JSON schema used for
    OpenAI structured output, `stream: false`, temperature 0.4. Parse
    through the existing parseGeneratedQuestions() — it already drops
    malformed entries. If fewer than 2 usable questions come back, retry
    once, then fall back.
- Selection config (env, all default `auto`):
  - TRANSCRIBE_PROVIDER=auto|local|openai
  - QUIZ_PROVIDER=auto|ollama|openai
  - `auto`: prefer local when available (probe once at boot: binary+model
    file for whisper; GET /api/tags for ollama with 2s timeout), else
    openai when a key exists.
  - On a local provider runtime failure, fall back to openai for that
    request when a key exists; surface a clear error when neither works.
- /api/health additions: `transcribeProvider`, `quizProvider` (the resolved
  choice), and quizEnabled/captionsEnabled become "some provider available"
  rather than "OpenAI key present".
- Log one line at boot stating the resolved providers.

## UI

- Web + mobile: wherever the "add OPENAI_API_KEY" disabled-state message
  appears, update copy to reflect reality: quizzes/captions run locally
  when local models are installed; the key is only one of the options.
  Health now tells the client whether features are enabled — the client
  should rely on that flag, not on assumptions about keys.

## Tests

- Unit-test provider selection logic (auto/local/openai matrix) with the
  probes stubbed.
- Unit-test the ollama response parsing path (fixture JSON -> questions).

## Constraints

- Do not regress the OpenAI path — it must keep working unchanged when
  selected.
- typecheck + build + tests green in all workspaces; mobile tsc clean.
- Do NOT git commit; no processes left running; append SESSION.md entry.
