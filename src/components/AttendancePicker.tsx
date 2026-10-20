import { Text, View } from 'react-native';
import type { Attendance } from '../features/lessons/types';
import { useApp } from '../theme/AppContext';
import { Chip } from './Chip';

const OPTIONS: readonly Attendance[] = ['attended', 'absent', 'unmarked'];

/** The student's own attendance record (never a confirmed fact about the teacher). */
export function AttendancePicker({ value, onChange, label }: { value: Attendance; onChange: (next: Attendance) => void; label?: string }) {
  const { styles, t } = useApp();
  const text = (option: Attendance) => (option === 'attended' ? t.attended : option === 'absent' ? t.absent : t.pending);
  return (
    <View style={styles.attendanceRow}>
      <Text style={styles.attendanceLabel}>{label ?? t.attendance}</Text>
      {OPTIONS.map((option) => (
        <Chip key={option} label={text(option)} selected={value === option} accessibilityLabel={`${t.attendance}: ${text(option)}`} onPress={() => onChange(option)} />
      ))}
    </View>
  );
}
