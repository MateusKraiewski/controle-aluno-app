import { StatusBar } from 'expo-status-bar';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, SafeAreaView,
  ScrollView, StyleSheet, Text, TextInput, useColorScheme, View,
} from 'react-native';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { initializeDatabase } from './src/db/database';
import { createLesson, listUpcomingLessons, updateAttendance } from './src/features/lessons/repository';
import type { Attendance, Lesson } from './src/features/lessons/types';
import { getTranslations } from './src/lib/locales';
import { loadPreferences, saveLanguage, saveTheme } from './src/lib/preferences';
import type { Language, ThemePreference } from './src/lib/preferences';

type Palette = { background: string; surface: string; ink: string; muted: string; green: string; lime: string; line: string; orange: string; danger: string };
const lightPalette: Palette = { background: '#f5f4ef', surface: '#fff', ink: '#20322d', muted: '#71817a', green: '#284d40', lime: '#d8ec86', line: '#e4e8df', orange: '#f3b68d', danger: '#a34839' };
const darkPalette: Palette = { background: '#111a17', surface: '#1d2924', ink: '#edf2ed', muted: '#a2b1a9', green: '#284d40', lime: '#d8ec86', line: '#34443c', orange: '#f3b68d', danger: '#ff9a86' };

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function prettyTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
function prettyDate(value: string, locale: Language) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
}

function AppContent() {
  const db = useSQLiteContext();
  const systemScheme = useColorScheme();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [subject, setSubject] = useState('');
  const [teacher, setTeacher] = useState('');
  const [date, setDate] = useState(localDate(new Date()));
  const [time, setTime] = useState('15:00');
  const [duration, setDuration] = useState('60');
  const [plannedContent, setPlannedContent] = useState('');
  const [language, setLanguage] = useState<Language>('pt-BR');
  const [themePreference, setThemePreference] = useState<ThemePreference>('system');
  const isDark = themePreference === 'dark' || (themePreference === 'system' && systemScheme === 'dark');
  const palette = isDark ? darkPalette : lightPalette;
  const styles = useMemo(() => createStyles(palette), [isDark]);
  const t = getTranslations(language);

  useEffect(() => {
    void loadPreferences().then((preferences) => {
      setLanguage(preferences.language);
      setThemePreference(preferences.theme);
    }).catch(() => undefined);
  }, []);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const start = localDate(new Date());
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 7);
      setLessons(await listUpcomingLessons(db, start, localDate(endDate), 100));
    } catch {
      setError(t.loadError);
    } finally {
      setLoading(false);
    }
  }, [db, t.loadError]);

  useEffect(() => { void refresh(); }, [refresh]);
  const grouped = useMemo(() => lessons.reduce<Record<string, Lesson[]>>((groups, lesson) => {
    (groups[lesson.localDate] ??= []).push(lesson);
    return groups;
  }, {}), [lessons]);

  async function changeLanguage(next: Language) {
    setLanguage(next);
    try { await saveLanguage(next); } catch { setError(t.saveError); }
  }
  async function changeTheme(next: ThemePreference) {
    setThemePreference(next);
    try { await saveTheme(next); } catch { setError(t.saveError); }
  }

  async function saveLesson() {
    const [hour, minute] = time.split(':').map(Number);
    const durationNumber = Number(duration);
    if (!subject.trim()) { setError(t.saveSubjectError); return; }
    const dateParts = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)?.slice(1).map(Number);
    if (!dateParts) { setError(t.dateFormatError); return; }
    const [year, month, day] = dateParts;
    const parsedDate = new Date(year, month - 1, day);
    if (parsedDate.getFullYear() !== year || parsedDate.getMonth() !== month - 1 || parsedDate.getDate() !== day) { setError(t.invalidDateError); return; }
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) { setError(t.timeError); return; }
    if (!Number.isInteger(durationNumber) || durationNumber < 5 || durationNumber > 480) { setError(t.durationError); return; }
    setSaving(true);
    setError('');
    try {
      await createLesson(db, { subject: subject.trim(), teacher: teacher.trim(), localDate: date, startMinute: hour * 60 + minute, durationMinutes: durationNumber, plannedContent: plannedContent.trim() });
      setSubject(''); setTeacher(''); setPlannedContent(''); setShowForm(false);
      await refresh();
    } catch {
      setError(t.saveError);
    } finally {
      setSaving(false);
    }
  }

  async function markAttendance(id: number, attendance: Attendance) {
    try { await updateAttendance(db, id, attendance); await refresh(); }
    catch { setError(t.attendanceError); }
  }

  return (
    <StylesContext.Provider value={styles}>
      <SafeAreaView style={styles.safe}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View><Text style={styles.brand}>AULA EM DIA</Text><Text style={styles.heroTitle}>{t.tagline}</Text></View>
            <View style={styles.heroActions}>
              <View style={styles.offlinePill}><View style={styles.onlineDot} /><Text style={styles.offlineText}>{t.offline}</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel={t.settings} onPress={() => setShowSettings(true)} style={styles.settingsButton}><Text style={styles.settingsIcon}>⚙</Text></Pressable>
            </View>
          </View>
          <View style={styles.heroBottom}>
            <View><Text style={styles.eyebrowLight}>{t.nextDays}</Text><Text style={styles.heroCount}>{lessons.length} {lessons.length === 1 ? t.oneLesson : t.manyLessons}</Text></View>
            <Text style={styles.heroMark}>◌</Text>
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.sectionHeading}>
            <View><Text style={styles.sectionEyebrow}>{t.studentAgenda}</Text><Text style={styles.sectionTitle}>{t.week}</Text></View>
            <Pressable accessibilityRole="button" onPress={() => { setError(''); setShowForm(true); }} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}><Text style={styles.addButtonText}>{t.add}</Text></Pressable>
          </View>
          <Text style={styles.caption}>{t.caption}</Text>
          {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          {loading ? <ActivityIndicator color={palette.green} style={{ marginTop: 32 }} /> : lessons.length === 0 ? (
            <View style={styles.emptyCard}><Text style={styles.emptyIcon}>✳</Text><Text style={styles.emptyTitle}>{t.emptyTitle}</Text><Text style={styles.emptyText}>{t.emptyBody}</Text><Pressable onPress={() => setShowForm(true)} style={styles.emptyButton}><Text style={styles.emptyButtonText}>{t.firstLesson}</Text></Pressable></View>
          ) : (
            <ScrollView contentContainerStyle={styles.agenda} showsVerticalScrollIndicator={false}>
              {Object.entries(grouped).map(([day, dayLessons]) => <View key={day}>
                <Text style={styles.dayHeading}>{prettyDate(day, language)}</Text>
                {dayLessons.map((lesson, index) => <View key={lesson.id} style={styles.lessonCard}>
                  <View style={[styles.timeRail, index % 2 ? styles.railOrange : styles.railGreen]} />
                  <View style={styles.lessonMain}>
                    <View style={styles.lessonTop}><Text style={styles.lessonTime}>{prettyTime(lesson.startMinute)}</Text><Text style={styles.lessonDuration}>{lesson.durationMinutes} {t.minutes}</Text></View>
                    <Text style={styles.lessonSubject}>{lesson.subject}</Text>
                    {!!lesson.teacher && <Text style={styles.lessonTeacher}>{t.with} {lesson.teacher}</Text>}
                    {!!lesson.plannedContent && <Text numberOfLines={2} style={styles.lessonNote}>{lesson.plannedContent}</Text>}
                    <View style={styles.attendanceRow}><Text style={styles.attendanceLabel}>{t.attendance}</Text>
                      {(['attended', 'absent', 'unmarked'] as const).map((value) => {
                        const label = value === 'attended' ? t.attended : value === 'absent' ? t.absent : t.pending;
                        return <Pressable key={value} accessibilityRole="button" accessibilityLabel={`${t.attendance}: ${label}`} onPress={() => void markAttendance(lesson.id, value)} style={[styles.attendanceChip, lesson.attendance === value && styles.attendanceSelected]}><Text style={[styles.attendanceText, lesson.attendance === value && styles.attendanceTextSelected]}>{label}</Text></Pressable>;
                      })}
                    </View>
                  </View>
                </View>)}
              </View>)}
              <Text style={styles.retentionHint}>{t.offlineInfo}</Text>
            </ScrollView>
          )}
        </View>

        <Modal visible={showForm} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowForm(false)}>
          <SafeAreaView style={styles.modalSafe}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
              <View style={styles.formHeading}><View><Text style={styles.sectionEyebrow}>{t.newOccurrence}</Text><Text style={styles.sectionTitle}>{t.addLesson}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={t.close} onPress={() => setShowForm(false)}><Text style={styles.close}>{t.close}</Text></Pressable></View>
              <Field label={t.subject} value={subject} onChangeText={setSubject} placeholder={t.subjectPlaceholder} />
              <Field label={t.teacher} value={teacher} onChangeText={setTeacher} placeholder={t.teacherPlaceholder} />
              <View style={styles.formRow}><View style={{ flex: 1.3 }}><Field label={t.date} value={date} onChangeText={setDate} placeholder="2026-10-18" /></View><View style={{ flex: 1 }}><Field label={t.time} value={time} onChangeText={setTime} placeholder="15:00" keyboardType="numbers-and-punctuation" /></View></View>
              <Field label={t.duration} value={duration} onChangeText={setDuration} placeholder="60" keyboardType="number-pad" />
              <Field label={t.planned} value={plannedContent} onChangeText={setPlannedContent} placeholder={t.plannedPlaceholder} multiline />
              {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
              <Pressable disabled={saving} onPress={() => void saveLesson()} style={[styles.saveButton, saving && { opacity: 0.6 }]}><Text style={styles.saveButtonText}>{saving ? t.saving : t.save}</Text></Pressable>
              <Text style={styles.privacyNote}>{t.privacy}</Text>
            </ScrollView>
          </KeyboardAvoidingView></SafeAreaView>
        </Modal>

        <Modal visible={showSettings} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowSettings(false)}>
          <SafeAreaView style={styles.modalSafe}><ScrollView contentContainerStyle={styles.form}>
            <View style={styles.formHeading}><View><Text style={styles.sectionEyebrow}>{t.settings}</Text><Text style={styles.sectionTitle}>{t.settings}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={t.close} onPress={() => setShowSettings(false)}><Text style={styles.close}>{t.close}</Text></Pressable></View>
            <Text style={styles.fieldLabel}>{t.language}</Text>
            {([['pt-BR', 'Português (Brasil)'], ['pt-PT', 'Português (Portugal)'], ['en', 'English'], ['es', 'Español']] as [Language, string][]).map(([value, label]) => <Pressable key={value} onPress={() => void changeLanguage(value)} style={[styles.option, language === value && styles.optionSelected]}><Text style={[styles.optionText, language === value && styles.optionTextSelected]}>{label}</Text></Pressable>)}
            <Text style={[styles.fieldLabel, styles.themeLabel]}>{t.theme}</Text>
            {([['system', t.system], ['light', t.light], ['dark', t.dark]] as [ThemePreference, string][]).map(([value, label]) => <Pressable key={value} onPress={() => void changeTheme(value)} style={[styles.option, themePreference === value && styles.optionSelected]}><Text style={[styles.optionText, themePreference === value && styles.optionTextSelected]}>{label}</Text></Pressable>)}
          </ScrollView></SafeAreaView>
        </Modal>
      </SafeAreaView>
    </StylesContext.Provider>
  );
}

function Field(props: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; multiline?: boolean; keyboardType?: 'number-pad' | 'numbers-and-punctuation' }) {
  const styles = useContext(StylesContext);
  return <View style={styles.field}><Text style={styles.fieldLabel}>{props.label}</Text><TextInput value={props.value} onChangeText={props.onChangeText} placeholder={props.placeholder} placeholderTextColor="#93a098" keyboardType={props.keyboardType ?? 'default'} multiline={props.multiline} style={[styles.input, props.multiline && styles.multiline]} /></View>;
}

export default function App() {
  return <SQLiteProvider databaseName="aula-em-dia.db" onInit={initializeDatabase}><AppContent /></SQLiteProvider>;
}

const StylesContext = createContext<ReturnType<typeof createStyles>>(createStyles(lightPalette));

function createStyles(colors: Palette) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    hero: { backgroundColor: colors.green, paddingHorizontal: 24, paddingTop: 18, paddingBottom: 25, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
    heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    heroActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    brand: { color: colors.lime, fontSize: 10, fontWeight: '800', letterSpacing: 2.5 },
    heroTitle: { color: '#fffdf7', fontSize: 22, fontWeight: '700', marginTop: 7, letterSpacing: -0.5 },
    offlinePill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderColor: '#668375', borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7, marginTop: 2 },
    onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.lime },
    offlineText: { color: '#eff5e9', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
    settingsButton: { width: 35, height: 35, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: '#ffffff1a' },
    settingsIcon: { color: '#fff', fontSize: 18 },
    heroBottom: { marginTop: 28, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
    eyebrowLight: { color: '#b9cdbf', fontSize: 10, fontWeight: '700', letterSpacing: 1.7 },
    heroCount: { color: '#fff', fontSize: 18, fontWeight: '600', marginTop: 5 },
    heroMark: { color: '#b5c7ba', fontSize: 32, lineHeight: 32 },
    content: { flex: 1, paddingHorizontal: 21, paddingTop: 24 },
    sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    sectionEyebrow: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1.6 },
    sectionTitle: { color: colors.ink, fontSize: 23, fontWeight: '700', letterSpacing: -0.5, marginTop: 4 },
    addButton: { backgroundColor: colors.lime, borderRadius: 14, paddingHorizontal: 17, paddingVertical: 12 },
    addButtonText: { color: '#20322d', fontWeight: '800', fontSize: 13 },
    pressed: { opacity: 0.7 },
    caption: { color: colors.muted, fontSize: 13, marginTop: 9, lineHeight: 19 },
    agenda: { paddingTop: 20, paddingBottom: 30 },
    dayHeading: { color: colors.ink, fontSize: 14, fontWeight: '700', textTransform: 'capitalize', marginBottom: 9, marginTop: 7 },
    lessonCard: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 17, overflow: 'hidden', marginBottom: 10, borderWidth: 1, borderColor: colors.line },
    timeRail: { width: 4 }, railGreen: { backgroundColor: colors.green }, railOrange: { backgroundColor: colors.orange },
    lessonMain: { flex: 1, padding: 14 },
    lessonTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    lessonTime: { color: colors.green, fontSize: 12, fontWeight: '800' },
    lessonDuration: { color: colors.muted, fontSize: 10, backgroundColor: colors.background, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
    lessonSubject: { color: colors.ink, fontSize: 18, fontWeight: '700', marginTop: 7 },
    lessonTeacher: { color: colors.muted, fontSize: 12, marginTop: 3 },
    lessonNote: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 8 },
    attendanceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 13, flexWrap: 'wrap' },
    attendanceLabel: { color: colors.muted, fontSize: 10, fontWeight: '600', marginRight: 1 },
    attendanceChip: { backgroundColor: colors.background, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 6 },
    attendanceSelected: { backgroundColor: colors.green },
    attendanceText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
    attendanceTextSelected: { color: '#fff' },
    emptyCard: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 22, paddingHorizontal: 23, paddingVertical: 27, marginTop: 22, borderWidth: 1, borderColor: colors.line },
    emptyIcon: { color: colors.green, fontSize: 29 },
    emptyTitle: { color: colors.ink, fontSize: 18, fontWeight: '700', marginTop: 10 },
    emptyText: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 8 },
    emptyButton: { backgroundColor: colors.green, borderRadius: 14, paddingHorizontal: 17, paddingVertical: 12, marginTop: 18 },
    emptyButtonText: { color: '#fff', fontSize: 13, fontWeight: '700' },
    retentionHint: { color: colors.muted, fontSize: 11, lineHeight: 16, paddingHorizontal: 5, paddingVertical: 10 },
    error: { color: colors.danger, fontSize: 12, lineHeight: 18, marginTop: 12 },
    modalSafe: { flex: 1, backgroundColor: colors.background },
    form: { padding: 23, paddingTop: 20, paddingBottom: 35 },
    formHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 },
    close: { color: colors.green, fontSize: 13, fontWeight: '700', padding: 10 },
    field: { marginBottom: 15, flex: 1 },
    fieldLabel: { color: colors.ink, fontSize: 12, fontWeight: '700', marginBottom: 7 },
    input: { backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: 13, minHeight: 48, paddingHorizontal: 13, paddingVertical: 12, color: colors.ink, fontSize: 14 },
    multiline: { minHeight: 86, textAlignVertical: 'top' },
    formRow: { flexDirection: 'row', gap: 11 },
    saveButton: { backgroundColor: colors.green, borderRadius: 15, minHeight: 52, alignItems: 'center', justifyContent: 'center', marginTop: 5 },
    saveButtonText: { color: '#fff', fontSize: 14, fontWeight: '800' },
    privacyNote: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 12 },
    option: { minHeight: 48, justifyContent: 'center', borderRadius: 13, paddingHorizontal: 15, marginTop: 7, backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1 },
    optionSelected: { backgroundColor: colors.green, borderColor: colors.green },
    optionText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    optionTextSelected: { color: '#fff' },
    themeLabel: { marginTop: 24 },
  });
}
