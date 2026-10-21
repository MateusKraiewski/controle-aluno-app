import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Pressable, Text, View, useColorScheme } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { SQLiteProvider } from 'expo-sqlite';
import { TabBar } from './src/components/TabBar';
import type { TabKey } from './src/components/TabBar';
import { ErrorText } from './src/components/ErrorText';
import { initializeDatabase } from './src/db/database';
import type { Lesson } from './src/features/lessons/types';
import { getTranslations } from './src/lib/locales';
import { loadPreferences, saveLanguage, saveTheme } from './src/lib/preferences';
import type { Language, ThemePreference } from './src/lib/preferences';
import { AgendaScreen } from './src/screens/AgendaScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { LessonEditorModal } from './src/screens/LessonEditorModal';
import type { EditorTarget } from './src/screens/LessonEditorModal';
import { SettingsModal } from './src/screens/SettingsModal';
import { SubjectsScreen } from './src/screens/SubjectsScreen';
import { AppContextProvider } from './src/theme/AppContext';
import { darkPalette, lightPalette } from './src/theme/palette';
import { createStyles } from './src/theme/styles';

function AppShell() {
  const systemScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const [language, setLanguage] = useState<Language>('pt-BR');
  const [themePreference, setThemePreference] = useState<ThemePreference>('system');
  const [tab, setTab] = useState<TabKey>('agenda');
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  // Bumped after every write so visible screens re-read their bounded queries.
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [reduceMotion, setReduceMotion] = useState(false);
  const isDark = themePreference === 'dark' || (themePreference === 'system' && systemScheme === 'dark');
  const context = useMemo(() => {
    const palette = isDark ? darkPalette : lightPalette;
    return { styles: createStyles(palette), palette, t: getTranslations(language), language, isDark, modalAnimation: reduceMotion ? 'none' as const : 'slide' as const };
  }, [isDark, language, reduceMotion]);
  const { styles, t } = context;

  useEffect(() => {
    loadPreferences().then((preferences) => {
      setLanguage(preferences.language);
      setThemePreference(preferences.theme);
    }).catch(() => undefined);
  }, []);

  // Modal slide animations follow the system "reduce motion" setting.
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  const changed = useCallback(() => setRevision((value) => value + 1), []);
  const openLesson = useCallback((lesson: Lesson) => setEditor({ mode: 'edit', id: lesson.id }), []);
  const addLesson = useCallback((localDate: string) => setEditor({ mode: 'create', localDate }), []);
  const closeEditor = useCallback(() => setEditor(null), []);

  async function changeLanguage(next: Language) {
    setLanguage(next);
    try { await saveLanguage(next); } catch { setError(getTranslations(next).saveError); }
  }
  async function changeTheme(next: ThemePreference) {
    setThemePreference(next);
    try { await saveTheme(next); } catch { setError(t.saveError); }
  }

  return (
    <AppContextProvider value={context}>
      {/* Android 15 draws edge to edge: the green header extends under the status bar and the tab bar clears the gesture area. */}
      <View style={[styles.safe, { paddingBottom: insets.bottom }]}>
        <StatusBar style="light" />
        <View style={[styles.hero, { paddingTop: 18 + insets.top }]}>
          <View style={styles.heroTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.brand}>AULA EM DIA</Text>
              <Text style={styles.heroTitle}>{t.tagline}</Text>
            </View>
            <View style={styles.heroActions}>
              <View style={styles.offlinePill} accessible accessibilityLabel={t.offline}><View style={styles.onlineDot} /><Text style={styles.offlineText}>{t.offline}</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel={t.settings} onPress={() => setShowSettings(true)} style={styles.settingsButton}>
                <Text style={styles.settingsIcon} importantForAccessibility="no" accessibilityElementsHidden>⚙</Text>
              </Pressable>
            </View>
          </View>
        </View>
        {!!error && <View style={{ paddingHorizontal: 21 }}><ErrorText message={error} /></View>}
        {tab === 'agenda' && <AgendaScreen revision={revision} onOpen={openLesson} onAdd={addLesson} onChanged={changed} />}
        {tab === 'history' && <HistoryScreen revision={revision} onOpen={openLesson} />}
        {tab === 'subjects' && <SubjectsScreen revision={revision} onChanged={changed} />}
        <TabBar active={tab} onChange={setTab} />
        <LessonEditorModal target={editor} onClose={closeEditor} onChanged={changed} />
        <SettingsModal
          visible={showSettings}
          themePreference={themePreference}
          onClose={() => setShowSettings(false)}
          onLanguage={(next) => void changeLanguage(next)}
          onTheme={(next) => void changeTheme(next)}
          onDataChanged={changed}
        />
      </View>
    </AppContextProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SQLiteProvider databaseName="aula-em-dia.db" onInit={initializeDatabase}>
        <AppShell />
      </SQLiteProvider>
    </SafeAreaProvider>
  );
}
