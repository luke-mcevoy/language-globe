import type { LearningLanguage } from '../types';
import { titleCase } from './format';

export const LANGUAGE_STORAGE_KEY = 'lg-language';

export function readStoredLanguage(): string | null {
  try {
    const raw = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    const id = raw?.trim().toLowerCase() ?? '';
    return id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

export function writeStoredLanguage(id: string): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, id);
  } catch {
    // Private mode / quota — keep the in-memory choice.
  }
}

export function languageLabel(id: string, languages: LearningLanguage[] | undefined): string {
  return languages?.find((language) => language.id === id)?.name ?? titleCase(id);
}
