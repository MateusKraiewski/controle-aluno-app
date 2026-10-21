import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { formatTime } from '../features/lessons/domain';
import type { Attendance, Lesson } from '../features/lessons/types';
import { useApp } from '../theme/AppContext';
import { AttendancePicker } from './AttendancePicker';

type LessonCardProps = {
  lesson: Lesson;
  accentIndex: number;
  onOpen: (lesson: Lesson) => void;
  onAttendance?: (lesson: Lesson, attendance: Attendance) => void;
  /** Optional line shown above the time (e.g. the date in history). */
  dateLabel?: string;
};

export const LessonCard = memo(function LessonCard({ lesson, accentIndex, onOpen, onAttendance, dateLabel }: LessonCardProps) {
  const { styles, t, palette } = useApp();
  const cancelled = lesson.status === 'cancelled';
  const time = formatTime(lesson.startMinute);
  // The subject colour is a decorative rail next to the subject name, never the only cue.
  const rail = cancelled ? styles.railMuted
    : lesson.subjectColor ? { backgroundColor: palette.subject[lesson.subjectColor] }
      : accentIndex % 2 ? styles.railOrange : styles.railGreen;
  return (
    <View style={styles.lessonCard}>
      <View style={[styles.timeRail, rail]} />
      <View style={styles.lessonMain}>
        <Pressable
          accessibilityRole="button"
          accessibilityHint={t.openLesson}
          accessibilityLabel={[lesson.subject, dateLabel, time, cancelled ? t.cancelled : null].filter(Boolean).join(', ')}
          onPress={() => onOpen(lesson)}
          style={({ pressed }) => pressed && styles.pressed}
        >
          {!!dateLabel && <Text style={styles.rowMeta}>{dateLabel}</Text>}
          <View style={styles.lessonTop}>
            <Text style={styles.lessonTime}>{time}</Text>
            <Text style={styles.lessonDuration}>{lesson.durationMinutes} {t.minutes}</Text>
            {cancelled && <Text style={styles.badge}>{t.cancelled}</Text>}
          </View>
          <Text style={[styles.lessonSubject, cancelled && styles.struck]}>{lesson.subject}</Text>
          {!!lesson.teacher && <Text style={styles.lessonTeacher}>{t.with} {lesson.teacher}</Text>}
          {lesson.studiedContent
            ? <Text numberOfLines={2} style={styles.lessonNote}>{t.studiedPrefix} {lesson.studiedContent}</Text>
            : !!lesson.plannedContent && <Text numberOfLines={2} style={styles.lessonNote}>{t.plannedPrefix} {lesson.plannedContent}</Text>}
          {cancelled && !!lesson.cancelReason && <Text numberOfLines={2} style={styles.lessonNote}>{lesson.cancelReason}</Text>}
        </Pressable>
        {!cancelled && onAttendance && <AttendancePicker value={lesson.attendance} onChange={(next) => onAttendance(lesson, next)} />}
      </View>
    </View>
  );
});
