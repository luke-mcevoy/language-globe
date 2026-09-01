import type { LearningLanguage } from '../types';

interface LanguagePickerProps {
  language: string;
  languages: LearningLanguage[];
  disabled?: boolean;
  onChange: (language: string) => void;
}

export function LanguagePicker({ language, languages, disabled, onChange }: LanguagePickerProps) {
  const options = languages.some((item) => item.id === language)
    ? languages
    : [{ id: language, name: language, nativeName: language, code: '' }, ...languages];

  return (
    <label className="language-picker glass">
      <span className="visually-hidden">Language to learn</span>
      <select
        value={language}
        disabled={disabled || languages.length === 0}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((item) => (
          <option key={item.id} value={item.id}>
            {item.nativeName} · {item.name}
          </option>
        ))}
      </select>
    </label>
  );
}
