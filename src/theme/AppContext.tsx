import { createContext, useContext } from 'react';
import type { Translations } from '../lib/locales';
import { getTranslations } from '../lib/locales';
import type { Language } from '../lib/preferences';
import { lightPalette } from './palette';
import type { Palette } from './palette';
import { createStyles } from './styles';
import type { AppStyles } from './styles';

export type AppContextValue = {
  styles: AppStyles;
  palette: Palette;
  t: Translations;
  language: Language;
  isDark: boolean;
  /** 'none' when the system asks to reduce motion. */
  modalAnimation: 'none' | 'slide';
};

const AppContext = createContext<AppContextValue>({
  styles: createStyles(lightPalette), palette: lightPalette, t: getTranslations('pt-BR'), language: 'pt-BR', isDark: false, modalAnimation: 'slide',
});

export const AppContextProvider = AppContext.Provider;

export function useApp(): AppContextValue {
  return useContext(AppContext);
}
