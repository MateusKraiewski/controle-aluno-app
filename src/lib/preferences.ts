import Storage from 'expo-sqlite/kv-store';

export type Language = 'pt-BR' | 'pt-PT' | 'en' | 'es';
export type ThemePreference = 'system' | 'light' | 'dark';

const LANGUAGE_KEY = 'aula-em-dia.language.v1';
const THEME_KEY = 'aula-em-dia.theme.v1';

export async function loadPreferences() {
  const [language, theme] = await Promise.all([Storage.getItem(LANGUAGE_KEY), Storage.getItem(THEME_KEY)]);
  return {
    language: isLanguage(language) ? language : 'pt-BR' as Language,
    theme: isTheme(theme) ? theme : 'system' as ThemePreference,
  };
}

export async function saveLanguage(language: Language) {
  await Storage.setItem(LANGUAGE_KEY, language);
}

export async function saveTheme(theme: ThemePreference) {
  await Storage.setItem(THEME_KEY, theme);
}

function isLanguage(value: string | null): value is Language {
  return value === 'pt-BR' || value === 'pt-PT' || value === 'en' || value === 'es';
}

function isTheme(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}
