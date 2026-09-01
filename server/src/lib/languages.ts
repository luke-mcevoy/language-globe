export interface LearningLanguage {
  /** Radio Browser search name, e.g. `italian`. */
  id: string;
  name: string;
  nativeName: string;
  /** ISO-639-1 hint for whisper.cpp. */
  code: string;
}

/**
 * Languages the picker offers. Radio Browser uses the English `id` as the
 * `language=` query; whisper and Ollama use `code` / `name`.
 */
export const LEARNING_LANGUAGES: readonly LearningLanguage[] = [
  { id: 'spanish', name: 'Spanish', nativeName: 'Español', code: 'es' },
  { id: 'italian', name: 'Italian', nativeName: 'Italiano', code: 'it' },
  { id: 'french', name: 'French', nativeName: 'Français', code: 'fr' },
  { id: 'portuguese', name: 'Portuguese', nativeName: 'Português', code: 'pt' },
  { id: 'german', name: 'German', nativeName: 'Deutsch', code: 'de' },
  { id: 'english', name: 'English', nativeName: 'English', code: 'en' },
  { id: 'catalan', name: 'Catalan', nativeName: 'Català', code: 'ca' },
  { id: 'dutch', name: 'Dutch', nativeName: 'Nederlands', code: 'nl' },
  { id: 'polish', name: 'Polish', nativeName: 'Polski', code: 'pl' },
  { id: 'russian', name: 'Russian', nativeName: 'Русский', code: 'ru' },
  { id: 'turkish', name: 'Turkish', nativeName: 'Türkçe', code: 'tr' },
  { id: 'greek', name: 'Greek', nativeName: 'Ελληνικά', code: 'el' },
  { id: 'swedish', name: 'Swedish', nativeName: 'Svenska', code: 'sv' },
  { id: 'arabic', name: 'Arabic', nativeName: 'العربية', code: 'ar' },
  { id: 'japanese', name: 'Japanese', nativeName: '日本語', code: 'ja' },
  { id: 'korean', name: 'Korean', nativeName: '한국어', code: 'ko' },
  { id: 'chinese', name: 'Chinese', nativeName: '中文', code: 'zh' },
  { id: 'hindi', name: 'Hindi', nativeName: 'हिन्दी', code: 'hi' },
  { id: 'romanian', name: 'Romanian', nativeName: 'Română', code: 'ro' },
  { id: 'hungarian', name: 'Hungarian', nativeName: 'Magyar', code: 'hu' },
] as const;

const BY_ID = new Map(LEARNING_LANGUAGES.map((language) => [language.id, language]));

/** Extra whisper codes we still understand if someone sets TARGET_LANGUAGE. */
const EXTRA_CODES: Record<string, string> = {
  mandarin: 'zh',
  norwegian: 'no',
  danish: 'da',
  finnish: 'fi',
  czech: 'cs',
  ukrainian: 'uk',
  vietnamese: 'vi',
  indonesian: 'id',
  thai: 'th',
  hebrew: 'he',
};

export function isLearningLanguage(id: string): boolean {
  return BY_ID.has(id.toLowerCase());
}

export function languageCode(language: string): string | undefined {
  const id = language.toLowerCase();
  return BY_ID.get(id)?.code ?? EXTRA_CODES[id];
}

export function normalizeLanguage(raw: string | undefined, fallback: string): string {
  const id = (raw ?? '').trim().toLowerCase();
  if (isLearningLanguage(id)) return id;
  const fallbackId = fallback.trim().toLowerCase();
  return isLearningLanguage(fallbackId) ? fallbackId : 'spanish';
}
