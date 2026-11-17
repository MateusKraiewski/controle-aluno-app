import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { Chip } from '../components/Chip';
import { ErrorText } from '../components/ErrorText';
import { LessonCard } from '../components/LessonCard';
import { addDays, formatTemplate, startOfWeek, toLocalDate } from '../features/lessons/domain';
import { buildDayReportHtml, isDayReady } from '../features/report/domain';
import { shareDayReportPdf } from '../features/report/files';
import { listLessonsInRange, updateAttendance } from '../features/lessons/repository';
import type { Attendance, Lesson } from '../features/lessons/types';
import { dateTime, prettyDate, weekLabel } from '../lib/format';
import { useApp } from '../theme/AppContext';
import { BreakModal } from './BreakModal';
import { MonthModal } from './MonthModal';

type AgendaScreenProps = {
  revision: number;
  onOpen: (lesson: Lesson) => void;
  onAdd: (localDate: string) => void;
  onChanged: () => void;
};

/** One Monday-based week at a time; the repository caps it at 100 lessons. */
export function AgendaScreen({ revision, onOpen, onAdd, onChanged }: AgendaScreenProps) {
  const db = useSQLiteContext();
  const { styles, t, language, palette } = useApp();
  const today = toLocalDate(new Date());
  const currentWeek = startOfWeek(today);
  const [weekStart, setWeekStart] = useState(currentWeek);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [breakStart, setBreakStart] = useState<string | null>(null);
  const [monthStart, setMonthStart] = useState<string | null>(null);
  const loadError = t.loadError;

  useEffect(() => {
    let active = true;
    setLoading(true);
    listLessonsInRange(db, weekStart, addDays(weekStart, 7), 100)
      .then((rows) => { if (active) { setLessons(rows); setError(''); } })
      .catch(() => { if (active) setError(loadError); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [db, weekStart, revision, loadError]);

  const grouped = useMemo(() => {
    const groups: [string, Lesson[]][] = [];
    for (const lesson of lessons) {
      const last = groups[groups.length - 1];
      if (last && last[0] === lesson.localDate) last[1].push(lesson);
      else groups.push([lesson.localDate, [lesson]]);
    }
    return groups;
  }, [lessons]);
  const plannedCount = lessons.filter((lesson) => lesson.status === 'planned').length;

  const markAttendance = useCallback(async (lesson: Lesson, attendance: Attendance) => {
    setLessons((current) => current.map((item) => (item.id === lesson.id ? { ...item, attendance } : item)));
    try {
      if (!(await updateAttendance(db, lesson.id, attendance))) throw new Error('not updated');
    } catch {
      setError(t.attendanceError);
      onChanged();
    }
  }, [db, onChanged, t.attendanceError]);

  const [reporting, setReporting] = useState<string | null>(null);
  async function reportDay(day: string, dayLessons: Lesson[]) {
    setReporting(day);
    setError('');
    try {
      const taken = dayLessons.filter((lesson) => lesson.status === 'planned');
      const attended = taken.filter((lesson) => lesson.attendance === 'attended').length;
      const absent = taken.filter((lesson) => lesson.attendance === 'absent').length;
      const html = buildDayReportHtml(dayLessons, {
        title: t.reportTitle, dateLine: prettyDate(day, language),
        summary: formatTemplate(taken.length === 1 ? t.reportSummaryOne : t.reportSummary, { count: taken.length, attended, absent }),
        generated: formatTemplate(t.reportGenerated, { date: dateTime(new Date().toISOString(), language) }),
        teacher: t.reportTeacher, studied: t.reportStudied, nextStep: t.reportNextStep, planned: t.reportPlanned, onlyPrivate: t.reportOnlyPrivate,
        attended: t.reportAttended, absent: t.reportAbsent, unmarked: t.reportUnmarked, cancelled: t.cancelled,
      });
      if (await shareDayReportPdf(html, `${t.reportFilePrefix}-${day}.pdf`, t.reportShareTitle) === 'unavailable') setError(t.reportUnavailable);
    } catch {
      setError(t.reportError);
    } finally {
      setReporting(null);
    }
  }

  const isCurrentWeek = weekStart === currentWeek;
  const addDate = isCurrentWeek ? today : weekStart;

  return (
    <View style={styles.content}>
      <View style={styles.sectionHeading}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionEyebrow}>{isCurrentWeek ? t.thisWeek : t.otherWeek} · {plannedCount} {plannedCount === 1 ? t.oneLesson : t.manyLessons}</Text>
          <Text accessibilityRole="header" style={styles.sectionTitle}>{weekLabel(weekStart, language)}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t.addLesson} onPress={() => onAdd(addDate)} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
          <Text style={styles.addButtonText}>{t.add}</Text>
        </Pressable>
      </View>
      <View style={[styles.weekNav, { marginTop: 12 }]}>
        <Chip label="‹" accessibilityLabel={t.previousWeek} onPress={() => setWeekStart((week) => addDays(week, -7))} />
        {!isCurrentWeek && <Chip label={t.today} onPress={() => setWeekStart(currentWeek)} />}
        <Chip label="›" accessibilityLabel={t.nextWeek} onPress={() => setWeekStart((week) => addDays(week, 7))} />
        <View style={{ flex: 1 }} />
        {/* Less frequent actions live behind one button so the week stays the focus. */}
        <Chip label={`${t.moreActions} ⋯`} onPress={() => Alert.alert(t.moreActions, undefined, [
          { text: t.monthOpenAction, onPress: () => setMonthStart(weekStart) },
          { text: t.breakOpen, onPress: () => setBreakStart(addDate) },
          { text: t.cancel, style: 'cancel' },
        ])} />
      </View>
      <BreakModal startDate={breakStart} onClose={() => setBreakStart(null)} onChanged={onChanged} />
      <MonthModal initialDate={monthStart} revision={revision} onClose={() => setMonthStart(null)}
        onPickDay={(day) => { setWeekStart(startOfWeek(day)); setMonthStart(null); }} />
      <ErrorText message={error} />
      {loading && lessons.length === 0 ? <ActivityIndicator accessibilityLabel={t.loading} color={palette.accent} style={{ marginTop: 32 }} /> : lessons.length === 0 ? (
        <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon} importantForAccessibility="no" accessibilityElementsHidden>✳</Text>
            <Text style={styles.emptyTitle}>{t.emptyTitle}</Text>
            <Text style={styles.emptyText}>{t.emptyBody}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t.firstLesson} onPress={() => onAdd(addDate)} style={({ pressed }) => [styles.emptyButton, pressed && styles.pressed]}><Text style={styles.emptyButtonText}>{t.firstLesson}</Text></Pressable>
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.agenda} showsVerticalScrollIndicator={false}>
          {grouped.map(([day, dayLessons]) => (
            <View key={day}>
              <Text accessibilityRole="header" style={styles.dayHeading}>{prettyDate(day, language)}{day === today ? ` · ${t.today}` : ''}</Text>
              {dayLessons.map((lesson, index) => (
                <LessonCard key={lesson.id} lesson={lesson} accentIndex={index} onOpen={onOpen} onAttendance={markAttendance} />
              ))}
              {isDayReady(dayLessons, day, today) && (
                <Pressable accessibilityRole="button" accessibilityHint={t.reportDayHint} accessibilityState={{ busy: reporting === day, disabled: reporting !== null }}
                  disabled={reporting !== null} onPress={() => void reportDay(day, dayLessons)}
                  style={({ pressed }) => [styles.secondaryButton, { marginTop: 4, marginBottom: 8 }, pressed && styles.pressed, reporting !== null && styles.disabled]}>
                  <Text style={styles.secondaryButtonText}>{reporting === day ? t.reportBusy : t.reportDay}</Text>
                </Pressable>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
