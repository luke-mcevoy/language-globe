/**
 * Word-level timestamp helpers for the transcription providers.
 *
 * Whisper.cpp gives per-token timings ({from, to} in ms) in its full JSON
 * output (whisper-cli -ojf). The tokens are subword units — a real "word"
 * spans one or more tokens, and the first token of each word begins with a
 * leading ASCII space. Punctuation tokens carry no space and belong to the
 * preceding word.
 *
 * OpenAI's whisper API and some whisper.cpp server builds already emit
 * word-level entries directly, so extractWords is used to normalize whichever
 * shape we get into { word, startMs, endMs }.
 */

export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
}

export interface WhisperCliToken {
  text?: unknown;
  offsets?: { from?: unknown; to?: unknown } | null;
}

export interface WhisperCliSegment {
  text?: unknown;
  offsets?: { from?: unknown; to?: unknown } | null;
  tokens?: WhisperCliToken[] | null;
}

interface FlatWord {
  word?: unknown;
  start?: unknown;
  end?: unknown;
  /** whisper.cpp uses `t0`/`t1` in centiseconds on some builds. */
  t0?: unknown;
  t1?: unknown;
  offsets?: { from?: unknown; to?: unknown } | null;
}

/**
 * whisper.cpp emits synthetic tokens for the model's internal state. They all
 * look like `[_...]` (BOS, EOT, timestamp markers, etc). Drop them so they do
 * not pollute the word list with fake zero-length "words".
 */
function isControlToken(text: string): boolean {
  // whisper.cpp emits synthetic tokens like `[_BEG_]`, `[_EOT_]`, `[_TT_50]`
  // (timestamp markers) and `[BLANK_AUDIO]` for silence. Anything of that
  // shape is model state, not spoken words.
  return text === '' || /^\[_.+\]$/.test(text) || text === '[BLANK_AUDIO]';
}

function isPunctuationOnly(text: string): boolean {
  return /^[\s\p{P}\p{S}]+$/u.test(text);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Merge whisper.cpp token-level output into word-level timings. Tokens whose
 * `text` begins with a space start a new word; other tokens append to the
 * current word. Punctuation-only tokens (`,`, `.`, `?`, etc) are folded into
 * the preceding word so the highlight does not flash on them.
 *
 * Times use whisper.cpp's `offsets.from/to` (ms since the START of the
 * transcribed clip). Output stays relative to that clip; the caller shifts
 * it onto the session time axis.
 */
export function mergeWhisperCliTokensToWords(segments: WhisperCliSegment[]): WordTiming[] {
  const words: WordTiming[] = [];
  let current: WordTiming | null = null;

  const pushCurrent = () => {
    if (!current) return;
    current.word = current.word.trim();
    if (current.word.length > 0) words.push(current);
    current = null;
  };

  for (const segment of segments ?? []) {
    const tokens = Array.isArray(segment?.tokens) ? segment.tokens : [];
    for (const token of tokens) {
      const rawText = typeof token?.text === 'string' ? token.text : '';
      if (isControlToken(rawText.trim())) continue;

      const startMs = numberOr(token?.offsets?.from, current?.endMs ?? 0);
      const endMs = numberOr(token?.offsets?.to, startMs);
      const startsWord = rawText.startsWith(' ') || current === null;

      if (startsWord) {
        pushCurrent();
        current = {
          word: rawText.trimStart(),
          startMs,
          endMs,
        };
      } else if (current) {
        current.word += rawText;
        current.endMs = Math.max(current.endMs, endMs);
      } else {
        // No current word yet and no leading space — treat as start.
        current = {
          word: rawText,
          startMs,
          endMs,
        };
      }

      if (isPunctuationOnly(current.word)) {
        // A word made only of punctuation should attach to the previous
        // real word (comma, period, etc). If there is no previous word
        // yet — e.g. whisper.cpp sometimes opens with a stray "." token —
        // drop it: a lone punctuation "word" would just flash the highlight
        // on a character no one speaks.
        const previous = words[words.length - 1];
        if (previous) {
          previous.word += current.word;
          previous.endMs = Math.max(previous.endMs, current.endMs);
        }
        current = null;
      }
    }
    pushCurrent();
  }
  pushCurrent();
  return words;
}

function normalizeSeconds(word: FlatWord): { startMs: number; endMs: number } | null {
  if (typeof word.start === 'number' && typeof word.end === 'number') {
    return { startMs: Math.round(word.start * 1000), endMs: Math.round(word.end * 1000) };
  }
  // Some builds use `t0`/`t1` in centiseconds (matches whisper.cpp internals).
  if (typeof word.t0 === 'number' && typeof word.t1 === 'number') {
    return { startMs: Math.round(word.t0 * 10), endMs: Math.round(word.t1 * 10) };
  }
  if (word.offsets && typeof word.offsets === 'object') {
    const from = word.offsets.from;
    const to = word.offsets.to;
    if (typeof from === 'number' && typeof to === 'number') {
      return { startMs: from, endMs: to };
    }
  }
  return null;
}

/**
 * Normalizes a `words` array from whichever shape the provider hands back
 * (OpenAI verbose_json, whisper.cpp server verbose_json, direct token list).
 * Returns null when no entries had usable timings so the caller can fall
 * back to chunk-level captions.
 *
 * whisper.cpp's server labels SUBWORD TOKENS as "words" ("Suscríbete" arrives
 * as "S", "us", "cr", "íb", "ete"), with a leading space marking genuine word
 * starts — trimming each entry would shatter words into fragments. When any
 * entry carries that leading-space marker we run the token merge instead;
 * OpenAI-style entries (real words, no space prefixes) keep the simple path.
 */
export function normalizeFlatWords(words: unknown): WordTiming[] | null {
  if (!Array.isArray(words) || words.length === 0) return null;

  const entries: { raw: string; startMs: number; endMs: number }[] = [];
  for (const raw of words) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as FlatWord;
    const wordText = typeof entry.word === 'string' ? entry.word : '';
    if (wordText.trim().length === 0 || isControlToken(wordText.trim())) continue;
    const times = normalizeSeconds(entry);
    if (!times) continue;
    entries.push({ raw: wordText, startMs: times.startMs, endMs: Math.max(times.startMs, times.endMs) });
  }
  if (entries.length === 0) return null;

  const tokenStyle = entries.some((entry) => /^\s/.test(entry.raw) && entry.raw.trim().length > 0);
  if (tokenStyle) {
    // A trailing space on the previous entry is also a word boundary; encode
    // it as a leading space so the token merge sees every boundary one way.
    const merged = mergeWhisperCliTokensToWords([
      {
        tokens: entries.map((entry, index) => {
          const previous = entries[index - 1];
          const boundary = previous !== undefined && /\s$/.test(previous.raw) && !/^\s/.test(entry.raw);
          return {
            text: boundary ? ` ${entry.raw}` : entry.raw,
            offsets: { from: entry.startMs, to: entry.endMs },
          };
        }),
      },
    ]);
    return merged.length > 0 ? merged : null;
  }

  const out = entries.map((entry) => ({ word: entry.raw.trim(), startMs: entry.startMs, endMs: entry.endMs }));
  return out.length > 0 ? out : null;
}
