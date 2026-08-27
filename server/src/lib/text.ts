/**
 * Word count used both for the music/low-speech heuristic and for the
 * "words heard" stat. Deliberately naive but stable across languages that
 * separate words with whitespace.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Transcription models hallucinate boilerplate on near-silent or musical
 * audio ("Subtítulos realizados por...", "Thanks for watching!"). Strip the
 * common ones so the low-speech heuristic isn't fooled by them.
 */
const HALLUCINATION_PATTERNS: RegExp[] = [
  // Each phrase is consumed up to the end of its sentence, so domains like
  // "Amara.org" inside the credit do not terminate the match early.
  /sub(?:t[ií]tulos|titles)\b[^\n]*?(?:amara\.org|\.(?=\s|$)|$)/gi,
  /(?:thanks?|thank you) for watching[^\n]*?(?:\.(?=\s|$)|$)/gi,
  /gracias por (?:ver|mirar|escuchar)[^\n]*?(?:\.(?=\s|$)|$)/gi,
  /\bwww\.\S+/gi,
  /\[\s*(?:m[úu]sica|music|applause|aplausos)\s*\]/gi,
];

export function cleanTranscript(text: string): string {
  let out = text;
  for (const pattern of HALLUCINATION_PATTERNS) out = out.replace(pattern, ' ');
  return out.replace(/\s+/g, ' ').trim();
}
