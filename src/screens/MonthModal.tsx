import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View, SafeAreaView } from 'react-native';
import { androidTopInset } from '../theme/insets';
import { useSQLiteContext } from 'expo-sqlite';
import { Chip } from '../components/Chip';
import { ErrorText } from '../components/ErrorText';
import { ModalHeader } from '../components/ModalHeader';
import { addMonths, formatTemplate, monthGrid, toLocalDate } from '../features/lessons/domain';
import { countLessonsByDay } from '../features/lessons/repository';
import type { DayCount } from '../features/lessons/repository';
import { longDate, monthLabel } from '../lib/format';
import { weekdayLabel } from '../lib/locales';
import { useApp } from '../theme/AppContext';

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

type MonthModalProps = { initialDate: string | null; revision: number; onClose: () => void; onPickDay: (localDate: string) => void };

/** Monthly overview: lesson count per day; tapping a day opens its week in the agenda. */
export function MonthModal({ initialDate, revision, onClose, onPickDay }: MonthModalProps) {
  const { modalAnimation } = useApp();
  return (
    <Modal visible={initialDate !== null} animationType={modalAnimation} presentationStyle="pageSheet" onRequestClose={onClose}>
      {initialDate !== null && <MonthBody key={initialDate} initialDate={initialDate} revision={revision} onClose={onClose} onPickDay={onPickDay} />}
    </Modal>
  );
}

function MonthBody({ initialDate, revision, onClose, onPickDay }: { initialDate: string; revision: number; onClose: () => void; onPickDay: (localDate: string) => void }) {
  const db = useSQLiteContext();
  const { styles, t, language, palette } = useApp();
  const today = toLocalDate(new Date());
  const [month, setMonth] = useState(addMonths(initialDate, 0));
  const grid = useMemo(() => monthGrid(month), [month]);
  const [counts, setCounts] = useState<Map<string, DayCount>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const loadError = t.loadError;

  useEffect(() => {
    let active = true;
    setLoading(true);
    countLessonsByDay(db, grid.from, grid.to)
      .then((rows) => { if (active) { setCounts(new Map(rows.map((row) => [row.localDate, row]))); setError(''); } })
      .catch(() => { if (active) setError(loadError); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [db, grid.from, grid.to, revision, loadError]);

  const weeks: string[][] = [];
  for (let index = 0; index < grid.days.length; index += 7) weeks.push(grid.days.slice(index, index + 7));

  return (
    <SafeAreaView style={[styles.modalSafe, { paddingTop: androidTopInset }]} accessibilityViewIsModal>
      <ScrollView contentContainerStyle={styles.form}>
        <ModalHeader eyebrow={t.monthEyebrow} title={monthLabel(month, language)} onClose={onClose} />
        <View style={styles.weekNav}>
          <Chip label="‹" accessibilityLabel={t.previousMonth} onPress={() => setMonth((value) => addMonths(value, -1))} />
          <Chip label={t.today} selected={month === addMonths(today, 0)} onPress={() => setMonth(addMonths(today, 0))} />
          <Chip label="›" accessibilityLabel={t.nextMonth} onPress={() => setMonth((value) => addMonths(value, 1))} />
          {loading && <ActivityIndicator accessibilityLabel={t.loading} color={palette.accent} />}
        </View>
        <ErrorText message={error} />
        <View style={[styles.monthRow, { marginTop: 14 }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {WEEKDAY_ORDER.map((day) => <Text key={day} style={styles.monthWeekday}>{weekdayLabel(t, day)}</Text>)}
        </View>
        {weeks.map((week) => (
          <View key={week[0]} style={styles.monthRow}>
            {week.map((day) => {
              const count = counts.get(day);
              const planned = count?.planned ?? 0;
              const cancelled = count?.cancelled ?? 0;
              const inMonth = day.slice(0, 7) === month.slice(0, 7);
              const label = [
                longDate(day, language),
                formatTemplate(t.monthDayCount, { count: planned }),
                cancelled > 0 ? formatTemplate(t.monthDayCancelled, { count: cancelled }) : null,
                day === today ? t.today : null,
              ].filter(Boolean).join(', ');
              return (
                <Pressable key={day} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={t.monthOpenWeek}
                  onPress={() => onPickDay(day)}
                  style={({ pressed }) => [styles.monthCell, day === today && styles.monthToday, pressed && styles.pressed]}>
                  <Text style={[styles.monthDay, !inMonth && styles.monthOutside, day === today && styles.monthTodayText]}>{Number(day.slice(8))}</Text>
                  {planned > 0 ? <Text style={styles.monthCount}>{planned}</Text> : <Text style={styles.monthCountEmpty}> </Text>}
                  {cancelled > 0 && <Text style={styles.monthCancelled}>{`−${cancelled}`}</Text>}
                </Pressable>
              );
            })}
          </View>
        ))}
        <Text style={[styles.info, { marginTop: 14 }]}>{t.monthLegend}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
