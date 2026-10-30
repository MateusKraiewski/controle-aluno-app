import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { Chip } from '../components/Chip';
import { ErrorText } from '../components/ErrorText';
import { addMonths, formatTemplate, monthGrid, toLocalDate } from '../features/lessons/domain';
import { pickLunchMenu } from '../features/lunch/import';
import { MEAL_ORDER, type MealKey } from '../features/lunch/menu-parser';
import { listLunchDays, saveLunchMenu, type StoredLunchDay } from '../features/lunch/repository';
import { longDate, monthLabel } from '../lib/format';
import { weekdayLabel, type TranslationKey } from '../lib/locales';
import { useApp } from '../theme/AppContext';

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const MEAL_LABELS: Record<MealKey, TranslationKey> = {
  breakfast: 'mealBreakfast', soup: 'mealSoup', main: 'mealMain', vegetarian: 'mealVegetarian',
  go2go: 'mealGo2Go', vegetables: 'mealVegetables', dessert: 'mealDessert', snack: 'mealSnack',
};

/** School lunch: import the school's PDF menu once, then see each day's meals offline. */
export function LunchScreen({ revision, onChanged }: { revision: number; onChanged: () => void }) {
  const db = useSQLiteContext();
  const { styles, t, language, palette } = useApp();
  const today = toLocalDate(new Date());
  const [month, setMonth] = useState(addMonths(today, 0));
  const [selected, setSelected] = useState(today);
  const grid = useMemo(() => monthGrid(month), [month]);
  const [days, setDays] = useState<Map<string, StoredLunchDay>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const loadError = t.loadError;

  useEffect(() => {
    let active = true;
    setLoading(true);
    listLunchDays(db, grid.from, grid.to)
      .then((rows) => { if (active) { setDays(new Map(rows.map((row) => [row.date, row]))); setError(''); } })
      .catch(() => { if (active) setError(loadError); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [db, grid.from, grid.to, revision, loadError]);

  async function importMenu() {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await pickLunchMenu();
      if (result.status === 'canceled') return;
      if (result.status === 'error') {
        setError(t[result.error === 'tooLarge' ? 'lunchTooLarge' : result.error === 'notPdf' ? 'lunchNotPdf' : result.error === 'noMenu' ? 'lunchNoMenu' : 'lunchReadFailed']);
        return;
      }
      const { menu, fileName } = result;
      const holidays = menu.days.filter((day) => day.holiday).length;
      const first = menu.days[0]!.date; const last = menu.days[menu.days.length - 1]!.date;
      const summary = formatTemplate(t.lunchPreview, {
        weeks: menu.weeks.length, days: menu.days.length - holidays, holidays,
        from: longDate(first, language), to: longDate(last, language),
      });
      Alert.alert(t.lunchConfirmTitle, summary, [
        { text: t.cancel, style: 'cancel' },
        {
          text: t.lunchConfirm, onPress: () => {
            void saveLunchMenu(db, menu.days, fileName)
              .then((count) => {
                setNotice(formatTemplate(t.lunchSaved, { days: count }));
                setMonth(addMonths(first <= today && today <= last ? today : first, 0));
                setSelected(first <= today && today <= last ? today : first);
                onChanged();
              })
              .catch(() => setError(t.lunchSaveError));
          },
        },
      ]);
    } finally { setBusy(false); }
  }

  const weeks: string[][] = [];
  for (let index = 0; index < grid.days.length; index += 7) weeks.push(grid.days.slice(index, index + 7));
  const day = days.get(selected);

  return (
    <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 24 }}>
      <Text style={styles.sectionEyebrow}>{t.lunchEyebrow}</Text>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{t.lunchTitle}</Text>
      <Text style={[styles.info, { marginTop: 8 }]}>{t.lunchCaption}</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={() => { void importMenu(); }}
        style={({ pressed }) => [styles.addButton, { alignSelf: 'flex-start' }, pressed && styles.pressed]}>
        <Text style={styles.addButtonText}>{busy ? t.lunchReading : t.lunchImport}</Text>
      </Pressable>
      <ErrorText message={error} />
      {!!notice && <Text accessibilityLiveRegion="polite" style={[styles.info, { marginTop: 10 }]}>{notice}</Text>}

      <View style={[styles.weekNav, { marginTop: 16 }]}>
        <Chip label="‹" accessibilityLabel={t.previousMonth} onPress={() => setMonth((value) => addMonths(value, -1))} />
        <Chip label={monthLabel(month, language)} selected={false} onPress={() => { setMonth(addMonths(today, 0)); setSelected(today); }} accessibilityLabel={`${monthLabel(month, language)}. ${t.today}`} />
        <Chip label="›" accessibilityLabel={t.nextMonth} onPress={() => setMonth((value) => addMonths(value, 1))} />
        {loading && <ActivityIndicator accessibilityLabel={t.loading} color={palette.accent} />}
      </View>
      <View style={[styles.monthRow, { marginTop: 12 }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {WEEKDAY_ORDER.map((weekday) => <Text key={weekday} style={styles.monthWeekday}>{weekdayLabel(t, weekday)}</Text>)}
      </View>
      {weeks.map((week) => (
        <View key={week[0]} style={styles.monthRow}>
          {week.map((date) => {
            const entry = days.get(date);
            const inMonth = date.slice(0, 7) === month.slice(0, 7);
            const mark = entry ? (entry.holiday ? t.lunchHolidayShort : '•') : ' ';
            const label = [longDate(date, language), entry ? (entry.holiday ? t.lunchHoliday : entry.meals.main ?? t.lunchHasMenu) : t.lunchNoMenuDay, date === today ? t.today : null].filter(Boolean).join(', ');
            return (
              <Pressable key={date} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: date === selected }} onPress={() => setSelected(date)}
                style={({ pressed }) => [styles.monthCell, date === today && styles.monthToday, date === selected && styles.chipSelected, pressed && styles.pressed]}>
                <Text style={[styles.monthDay, !inMonth && styles.monthOutside, date === selected && styles.chipTextSelected]}>{Number(date.slice(8))}</Text>
                <Text style={[styles.monthDay, date === selected && styles.chipTextSelected]}>{mark}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}

      <View style={[styles.lessonCard, { marginTop: 16, flexDirection: 'column', padding: 16 }]}>
        <Text accessibilityRole="header" style={styles.lessonSubject}>{longDate(selected, language)}{selected === today ? ` · ${t.today}` : ''}</Text>
        {!day && <Text style={styles.lessonNote}>{t.lunchNoMenuDay}</Text>}
        {day?.holiday && <Text style={styles.lessonNote}>{t.lunchHoliday}</Text>}
        {day && !day.holiday && MEAL_ORDER.filter((key) => day.meals[key]).map((key) => (
          <View key={key} style={{ marginTop: 10 }}>
            <Text style={styles.sectionEyebrow}>{t[MEAL_LABELS[key]].toUpperCase()}</Text>
            <Text style={[styles.lessonNote, { marginTop: 3, color: palette.ink, fontSize: key === 'main' ? 15 : 13, fontWeight: key === 'main' ? '700' : '400' }]}>{day.meals[key]}</Text>
          </View>
        ))}
      </View>
      <Text style={[styles.info, { marginTop: 10 }]}>{t.lunchPrivacy}</Text>
    </ScrollView>
  );
}
