import type { LearningLanguage } from '../types';
import { titleCase } from './format';

export function languageLabel(id: string, languages: LearningLanguage[] | undefined): string {
  return languages?.find((language) => language.id === id)?.name ?? titleCase(id);
}
