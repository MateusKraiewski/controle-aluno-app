// Touch pickers for date, time and duration. Pure JavaScript (no native module), so the
// values stay the same strings the forms already validate: YYYY-MM-DD, HH:MM and minutes.
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { addDays, addMonths, formatTime, isValidLocalDate, monthGrid, parseTime, toLocalDate } from '../features/lessons/domain';
import { longDate, monthLabel } from '../lib/format';
import { weekdayLabel } from '../lib/locales';
import { useApp } from '../theme/AppContext';
import { Chip } from './Chip';

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Today / tomorrow shortcuts plus a month calendar that opens on demand. */
export function DatePickerField({ label, value, onChange, min }: { label: string; value: string; onChange: (value: string) => void; min?: string }) {
  const { styles, t, language } = useApp();
  const today = toLocalDate(new Date());
  const valid = isValidLocalDate(value);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(addMonths(valid ? value : today, 0));
  const grid = useMemo(() => monthGrid(month), [month]);
  const weeks: string[][] = [];
  for (let index = 0; index < grid.days.length; index += 7) weeks.push(grid.days.slice(index, index + 7));
  const pick = (date: string) => { onChange(date); setOpen(false); };
  const tomorrow = addDays(today, 1);

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${valid ? longDate(value, language) : t.pickDate}`} accessibilityState={{ expanded: open }}
        onPress={() => { setMonth(addMonths(valid ? value : today, 0)); setOpen((current) => !current); }}
        style={({ pressed }) => [styles.input, { justifyContent: 'center' }, pressed && styles.pressed]}>
        <Text style={[styles.pickerValue]}>{valid ? longDate(value, language) : t.pickDate}  ▾</Text>
      </Pressable>
      <View style={[styles.chipRow, { marginTop: 8, marginBottom: 0 }]}>
        {(!min || today >= min) && <Chip label={t.today} selected={value === today} onPress={() => pick(today)} />}
        {(!min || tomorrow >= min) && <Chip label={t.tomorrow} selected={value === tomorrow} onPress={() => pick(tomorrow)} />}
      </View>
      {open && (
        <View style={{ marginTop: 8 }}>
          <View style={styles.weekNav}>
            <Chip label="‹" accessibilityLabel={t.previousMonth} onPress={() => setMonth((current) => addMonths(current, -1))} />
            <Text style={[styles.fieldLabel, { flex: 1, textAlign: 'center', marginBottom: 0 }]}>{monthLabel(month, language)}</Text>
            <Chip label="›" accessibilityLabel={t.nextMonth} onPress={() => setMonth((current) => addMonths(current, 1))} />
          </View>
          <View style={[styles.monthRow, { marginTop: 8 }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            {WEEKDAY_ORDER.map((day) => <Text key={day} style={styles.monthWeekday}>{weekdayLabel(t, day)}</Text>)}
          </View>
          {weeks.map((week) => (
            <View key={week[0]} style={styles.monthRow}>
              {week.map((date) => {
                const disabled = !!min && date < min;
                const inMonth = date.slice(0, 7) === month.slice(0, 7);
                return (
                  <Pressable key={date} accessibilityRole="button" accessibilityLabel={longDate(date, language)} accessibilityState={{ selected: date === value, disabled }}
                    disabled={disabled} onPress={() => pick(date)}
                    style={({ pressed }) => [styles.monthCell, { minHeight: 44, paddingTop: 0, justifyContent: 'center' }, date === today && styles.monthToday, date === value && styles.chipSelected, pressed && styles.pressed, disabled && styles.disabled]}>
                    <Text style={[styles.monthDay, !inMonth && styles.monthOutside, date === value && styles.chipTextSelected]}>{Number(date.slice(8))}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** Hour and minute steppers with common minute marks; never needs the keyboard. */
export function TimePickerField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { styles, t } = useApp();
  const minutes = parseTime(value) ?? 15 * 60;
  const set = (next: number) => onChange(formatTime(((next % 1440) + 1440) % 1440));
  const hour = Math.floor(minutes / 60);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.weekNav, { alignItems: 'center' }]}>
        <Chip label="−" accessibilityLabel={t.hourEarlier} onPress={() => set(minutes - 60)} />
        <Text accessibilityLiveRegion="polite" accessibilityLabel={`${label}: ${formatTime(minutes)}`} style={[styles.pickerValue, { fontSize: 26, minWidth: 92, textAlign: 'center' }]}>{formatTime(minutes)}</Text>
        <Chip label="+" accessibilityLabel={t.hourLater} onPress={() => set(minutes + 60)} />
      </View>
      <View style={[styles.chipRow, { marginTop: 8, marginBottom: 0 }]}>
        {[0, 15, 30, 45].map((minute) => (
          <Chip key={minute} label={`:${String(minute).padStart(2, '0')}`} accessibilityLabel={`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`}
            selected={minutes % 60 === minute} onPress={() => set(hour * 60 + minute)} />
        ))}
      </View>
    </View>
  );
}

/** Common class lengths as chips, with ±15 min for anything else. */
export function DurationPickerField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { styles, t } = useApp();
  const current = Number(value) || 60;
  const set = (next: number) => onChange(String(Math.min(480, Math.max(5, next))));
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.chipRow, { marginBottom: 0 }]}>
        {[30, 45, 60, 90, 120].map((length) => <Chip key={length} label={`${length} ${t.minutes}`} selected={current === length} onPress={() => set(length)} />)}
      </View>
      <View style={[styles.weekNav, { marginTop: 8, alignItems: 'center' }]}>
        <Chip label="−15" accessibilityLabel={t.durationShorter} onPress={() => set(current - 15)} />
        <Text accessibilityLiveRegion="polite" style={[styles.pickerValue, { minWidth: 80, textAlign: 'center' }]}>{current} {t.minutes}</Text>
        <Chip label="+15" accessibilityLabel={t.durationLonger} onPress={() => set(current + 15)} />
      </View>
    </View>
  );
}
