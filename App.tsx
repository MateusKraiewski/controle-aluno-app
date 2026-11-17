import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Pressable, Text, View, useColorScheme } from 'react-native';
import { useLastNotificationResponse } from 'expo-notifications';
import { androidTopInset } from './src/theme/insets';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { TabBar } from './src/components/TabBar';
import type { TabKey } from './src/components/TabBar';
import { ErrorText } from './src/components/ErrorText';
import { initializeDatabase } from './src/db/database';
import type { Lesson } from './src/features/lessons/types';
import { getTranslations } from './src/lib/locales';
import { loadPreferences, loadRemindersEnabled, saveLanguage, saveRemindersEnabled, saveTheme } from './src/lib/preferences';
import { getReminderPermission, installReminderHandler, lessonIdFromResponse, requestReminderPermission, syncReminders } from './src/features/reminders/notifications';
import type { Language, ThemePreference } from './src/lib/preferences';
import { AgendaScreen } from './src/screens/AgendaScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { LessonEditorModal } from './src/screens/LessonEditorModal';
import type { EditorTarget } from './src/screens/LessonEditorModal';
import { SettingsModal } from './src/screens/SettingsModal';
import { SubjectsScreen } from './src/screens/SubjectsScreen';
import { LunchScreen } from './src/screens/LunchScreen';
import { AppContextProvider } from './src/theme/AppContext';
import { darkPalette, lightPalette } from './src/theme/palette';
import { createStyles } from './src/theme/styles';

installReminderHandler();

function AppShell() {
  const db = useSQLiteContext();
  const systemScheme = useColorScheme();
  const [language, setLanguage] = useState<Language>('pt-BR');
  const [themePreference, setThemePreference] = useState<ThemePreference>('system');
  const [tab, setTab] = useState<TabKey>('agenda');
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  // Bumped after every write so visible screens re-read their bounded queries.
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [reduceMotion, setReduceMotion] = useState(false);
  // null until the saved preference is read, so reminders are never cleared by mistake on start.
  const [remindersEnabled, setRemindersEnabled] = useState<boolean | null>(null);
  // Bumped when the app comes back to the front, so reminders are replanned for "now".
  const [foreground, setForeground] = useState(0);
  const lastResponse = useLastNotificationResponse();
  const handledResponse = useRef<string | null>(null);
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

  useEffect(() => {
    loadRemindersEnabled().then(setRemindersEnabled).catch(() => setRemindersEnabled(true));
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') setForeground((value) => value + 1); });
    return () => subscription.remove();
  }, []);

  // First run with reminders on: ask Android 13+ for the notification permission once.
  useEffect(() => {
    if (!remindersEnabled) return;
    getReminderPermission().then((permission) => {
      if (permission === 'undetermined') return requestReminderPermission(t).then(() => setForeground((value) => value + 1));
    }).catch(() => undefined);
    // Asked when the switch turns on, not again on language changes.
  }, [remindersEnabled]);

  // Every write (notes saved, lesson cancelled, holiday added…) replans the reminders, shortly after.
  useEffect(() => {
    if (remindersEnabled === null) return;
    const timer = setTimeout(() => { syncReminders(db, t, remindersEnabled).catch(() => undefined); }, 600);
    return () => clearTimeout(timer);
  }, [db, t, remindersEnabled, revision, foreground]);

  // Tapping a reminder opens the lesson it talks about.
  useEffect(() => {
    if (!lastResponse) return;
    const id = lastResponse.notification.request.identifier;
    if (handledResponse.current === id) return;
    handledResponse.current = id;
    const lessonId = lessonIdFromResponse(lastResponse);
    if (lessonId !== null) setEditor({ mode: 'edit', id: lessonId });
  }, [lastResponse]);

  const changed = useCallback(() => setRevision((value) => value + 1), []);
  const openLesson = useCallback((lesson: Lesson) => setEditor({ mode: 'edit', id: lesson.id }), []);
  const addLesson = useCallback((localDate: string) => setEditor({ mode: 'create', localDate }), []);
  const closeEditor = useCallback(() => setEditor(null), []);

  async function changeLanguage(next: Language) {
    setLanguage(next);
    try { await saveLanguage(next); } catch { setError(getTranslations(next).saveError); }
  }
  async function changeReminders(next: boolean) {
    setRemindersEnabled(next);
    try { await saveRemindersEnabled(next); } catch { setError(t.saveError); }
  }
  async function changeTheme(next: ThemePreference) {
    setThemePreference(next);
    try { await saveTheme(next); } catch { setError(t.saveError); }
  }

  return (
    <AppContextProvider value={context}>
      {/* Android 15 draws edge to edge: the green header extends under the status bar. */}
      <View style={styles.safe}>
        <StatusBar style="light" />
        <View style={[styles.hero, { paddingTop: 18 + androidTopInset }]}>
          <View style={styles.heroTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.brand}>AULA EM DIA</Text>
              <Text style={styles.heroTitle}>{t.tagline}</Text>
            </View>
            <View style={styles.heroActions}>
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
        {tab === 'lunch' && <LunchScreen revision={revision} onChanged={changed} />}
        <TabBar active={tab} onChange={setTab} />
        <LessonEditorModal target={editor} onClose={closeEditor} onChanged={changed} />
        <SettingsModal
          visible={showSettings}
          themePreference={themePreference}
          onClose={() => setShowSettings(false)}
          onLanguage={(next) => void changeLanguage(next)}
          onTheme={(next) => void changeTheme(next)}
          onDataChanged={changed}
          remindersEnabled={remindersEnabled ?? true}
          onReminders={(next) => void changeReminders(next)}
        />
      </View>
    </AppContextProvider>
  );
}

export default function App() {
  return (
    <SQLiteProvider databaseName="aula-em-dia.db" onInit={initializeDatabase}>
      <AppShell />
    </SQLiteProvider>
  );
}
