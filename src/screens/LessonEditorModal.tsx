import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, SafeAreaView, ScrollView, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { AttendancePicker } from '../components/AttendancePicker';
import { Chip } from '../components/Chip';
import { ErrorText } from '../components/ErrorText';
import { Field } from '../components/Field';
import { ModalHeader } from '../components/ModalHeader';
import {
  MAX_NAME_LENGTH, MAX_OCCURRENCES, MAX_TEXT_LENGTH, addDays, findConflicts, findSeriesConflicts, formatTemplate,
  formatTime, generateOccurrences, isValidLocalDate, validateLessonDraft, weekdayOf,
} from '../features/lessons/domain';
import type { DraftError, Frequency, LessonDraft, RecurrenceError, SeriesEndError, TimeSlot } from '../features/lessons/domain';
import {
  cancelLessons, changeSeriesEnd, createLesson, createLessonSeries, deleteLessons, getLesson, getSeries, listSeriesEditTargets,
  listTimeSlots, restoreLesson, updateAttendance, updateLesson,
} from '../features/lessons/repository';
import type { Attendance, EditScope, Lesson, Scope, SeriesInfo } from '../features/lessons/types';
import { listSubjects } from '../features/subjects/repository';
import { ask } from '../lib/dialogs';
import { shortDate } from '../lib/format';
import type { TranslationKey } from '../lib/locales';
import { weekdayLabel } from '../lib/locales';
import { useApp } from '../theme/AppContext';

export type EditorTarget = { mode: 'create'; localDate: string } | { mode: 'edit'; id: number };

type Repeat = 'none' | Frequency;

const DRAFT_ERRORS: Record<DraftError, TranslationKey> = {
  subjectRequired: 'saveSubjectError', subjectTooLong: 'subjectTooLong', teacherTooLong: 'teacherTooLong',
  dateFormat: 'dateFormatError', dateInvalid: 'invalidDateError', time: 'timeError', duration: 'durationError', textTooLong: 'textTooLong',
};
const RECURRENCE_ERRORS: Record<RecurrenceError, TranslationKey> = {
  endDateFormat: 'endDateFormat', endBeforeStart: 'endBeforeStart', spanTooLong: 'spanTooLong', noWeekdays: 'noWeekdays', noOccurrences: 'noOccurrences',
};
const SERIES_END_ERRORS: Record<SeriesEndError | 'notFound', TranslationKey> = {
  endDateFormat: 'endDateFormat', endBeforeStart: 'endBeforeStart', spanTooLong: 'spanTooLong', tooMany: 'seriesTooMany', notFound: 'notFound',
};
// Monday-first display order of weekday indexes (0 = Sunday).
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Fields a series template governs; changing one of them can apply to the whole series. */
function governedChanged(lesson: Lesson, draft: LessonDraft): boolean {
  return lesson.startMinute !== draft.startMinute || lesson.durationMinutes !== draft.durationMinutes
    || lesson.teacher !== draft.teacher || lesson.plannedContent !== draft.plannedContent;
}
const DEFAULT_SERIES_WEEKS = 12;

type EditorProps = { target: EditorTarget | null; onClose: () => void; onChanged: () => void };

export function LessonEditorModal({ target, onClose, onChanged }: EditorProps) {
  return (
    <Modal visible={target !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {target && <EditorBody key={target.mode === 'edit' ? `edit-${target.id}` : `create-${target.localDate}`} target={target} onClose={onClose} onChanged={onChanged} />}
    </Modal>
  );
}

function EditorBody({ target, onClose, onChanged }: { target: EditorTarget; onClose: () => void; onChanged: () => void }) {
  const db = useSQLiteContext();
  const { styles, t, language } = useApp();
  const isEdit = target.mode === 'edit';
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [subject, setSubject] = useState('');
  const [teacher, setTeacher] = useState('');
  const [date, setDate] = useState(target.mode === 'create' ? target.localDate : '');
  const [time, setTime] = useState('15:00');
  const [duration, setDuration] = useState('60');
  const [plannedContent, setPlannedContent] = useState('');
  const [studiedContent, setStudiedContent] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [repeat, setRepeat] = useState<Repeat>('none');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [endDate, setEndDate] = useState('');
  const [quickSubjects, setQuickSubjects] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [series, setSeries] = useState<SeriesInfo | null>(null);
  const [newEnd, setNewEnd] = useState('');
  const [seriesMessage, setSeriesMessage] = useState('');
  const [seriesError, setSeriesError] = useState('');
  const seriesId = lesson?.seriesId ?? null;

  useEffect(() => {
    if (seriesId === null) { setSeries(null); return; }
    let active = true;
    getSeries(db, seriesId).then((row) => {
      if (!active) return;
      setSeries(row);
      if (row) setNewEnd(row.endDate);
    }).catch(() => { if (active) setSeries(null); });
    return () => { active = false; };
  }, [db, seriesId]);

  useEffect(() => {
    listSubjects(db, { includeArchived: false })
      .then((rows) => setQuickSubjects(rows.slice(0, 12).map((row) => row.name)))
      .catch(() => setQuickSubjects([]));
  }, [db]);

  useEffect(() => {
    if (target.mode !== 'edit') return;
    let active = true;
    getLesson(db, target.id).then((row) => {
      if (!active) return;
      if (!row) { setError(t.notFound); return; }
      setLesson(row);
      setSubject(row.subject);
      setTeacher(row.teacher ?? '');
      setDate(row.localDate);
      setTime(formatTime(row.startMinute));
      setDuration(String(row.durationMinutes));
      setPlannedContent(row.plannedContent ?? '');
      setStudiedContent(row.studiedContent ?? '');
      setCancelReason(row.cancelReason ?? '');
    }).catch(() => { if (active) setError(t.loadError); });
    return () => { active = false; };
  }, [db, target, t.notFound, t.loadError]);

  function chooseRepeat(next: Repeat) {
    setRepeat(next);
    if (next !== 'none' && isValidLocalDate(date)) {
      if (weekdays.length === 0) setWeekdays([weekdayOf(date)]);
      if (!endDate) setEndDate(addDays(date, DEFAULT_SERIES_WEEKS * 7 - 1));
    }
  }

  function toggleWeekday(day: number) {
    setWeekdays((current) => (current.includes(day) ? current.filter((value) => value !== day) : [...current, day]));
  }

  const preview = useMemo(() => {
    if (isEdit || repeat === 'none' || !isValidLocalDate(date)) return null;
    return generateOccurrences({ startDate: date, endDate: endDate.trim(), weekdays, frequency: repeat });
  }, [isEdit, repeat, date, endDate, weekdays]);

  /** `dates` must be sorted; `ignoreIds` are lessons that move with this save (series-wide edit). */
  async function confirmConflicts(draft: LessonDraft, dates: string[] | null, ignoreIds: readonly number[] = []): Promise<boolean> {
    const first = dates ? dates[0] : draft.localDate;
    const last = dates ? dates[dates.length - 1] : draft.localDate;
    const slots = (await listTimeSlots(db, first, last)).filter((slot) => !ignoreIds.includes(slot.id));
    const conflicts: TimeSlot[] = dates
      ? findSeriesConflicts(dates, draft.startMinute, draft.durationMinutes, slots)
      : findConflicts({ id: lesson?.id, localDate: draft.localDate, startMinute: draft.startMinute, durationMinutes: draft.durationMinutes }, slots);
    if (conflicts.length === 0) return true;
    const sample = conflicts[0];
    const message = formatTemplate(t.conflictBody, { count: conflicts.length, date: shortDate(sample.localDate, language), time: formatTime(sample.startMinute) });
    return (await ask(t.conflictTitle, message, t.review, [{ label: t.saveAnyway, value: 'save' }])) === 'save';
  }

  async function save() {
    const validation = validateLessonDraft({ subject, teacher, localDate: date, time, duration, plannedContent, studiedContent });
    if (!validation.ok) { setError(t[DRAFT_ERRORS[validation.error]]); return; }
    const draft = validation.value;
    let dates: string[] | null = null;
    if (!isEdit && repeat !== 'none') {
      const occurrences = generateOccurrences({ startDate: draft.localDate, endDate: endDate.trim(), weekdays, frequency: repeat });
      if (!occurrences.ok) { setError(t[RECURRENCE_ERRORS[occurrences.error]]); return; }
      dates = occurrences.value.dates;
    }
    setBusy(true);
    setError('');
    try {
      let scope: EditScope = 'this';
      let ignoreIds: number[] = [];
      // A series occurrence whose time/duration/teacher/plan changed (same date and subject)
      // may apply the change to the series' future untouched occurrences.
      if (lesson && lesson.seriesId !== null && lesson.localDate === draft.localDate
        && lesson.subject.toLowerCase() === draft.subject.toLowerCase() && governedChanged(lesson, draft)) {
        const targets = await listSeriesEditTargets(db, lesson.seriesId, lesson.id);
        if (targets.length > 0) {
          const choice = await ask<EditScope>(t.editScopeTitle, formatTemplate(t.editScopeBody, { count: targets.length }), t.back, [
            { label: t.scopeThis, value: 'this' },
            { label: t.scopeAllFuture, value: 'all' },
          ]);
          if (!choice) return;
          if (choice === 'all') {
            scope = 'all';
            dates = [...new Set([draft.localDate, ...targets.map((item) => item.localDate)])].sort();
            ignoreIds = [lesson.id, ...targets.map((item) => item.id)];
          }
        }
      }
      if (!(await confirmConflicts(draft, dates, ignoreIds))) return;
      const base = { subject: draft.subject, teacher: draft.teacher, localDate: draft.localDate, startMinute: draft.startMinute, durationMinutes: draft.durationMinutes, plannedContent: draft.plannedContent };
      if (target.mode === 'edit') {
        await updateLesson(db, target.id, { ...base, studiedContent: draft.studiedContent }, { scope });
      } else if (dates && repeat !== 'none') {
        await createLessonSeries(db, { ...base, localDate: dates[0], frequency: repeat, weekdays, endDate: endDate.trim(), dates });
      } else {
        await createLesson(db, base);
      }
      onChanged();
      onClose();
    } catch {
      setError(t.saveError);
    } finally {
      setBusy(false);
    }
  }

  /** Previews the new series end (counts), asks for confirmation, then applies it. */
  async function changeEnd() {
    if (!lesson || !series) return;
    setBusy(true);
    setError('');
    setSeriesMessage('');
    setSeriesError('');
    try {
      const preview = await changeSeriesEnd(db, series.id, newEnd, { dryRun: true });
      if (!preview.ok) { setSeriesError(t[SERIES_END_ERRORS[preview.error]]); return; }
      const { added, removed } = preview.value;
      if (added + removed > 0) {
        const choice = await ask(t.seriesEndTitle, formatTemplate(t.seriesEndBody, { added, removed }), t.back,
          [{ label: t.apply, value: 'apply', destructive: removed > 0 }]);
        if (choice !== 'apply') return;
      }
      const result = await changeSeriesEnd(db, series.id, newEnd);
      if (!result.ok) { setSeriesError(t[SERIES_END_ERRORS[result.error]]); return; }
      onChanged();
      const current = await getLesson(db, lesson.id);
      if (!current) { onClose(); return; }
      setLesson(current);
      const updated = await getSeries(db, series.id);
      setSeries(updated);
      if (updated) setNewEnd(updated.endDate);
      setSeriesMessage(formatTemplate(t.seriesEndDone, { added: result.value.added, removed: result.value.removed }));
    } catch {
      setSeriesError(t.seriesEndError);
    } finally {
      setBusy(false);
    }
  }

  async function chooseScope(title: string, message: string, destructive: boolean): Promise<Scope | null> {
    if (!lesson) return null;
    if (lesson.seriesId === null) {
      return destructive ? (await ask(title, message, t.back, [{ label: t.confirmDelete, value: 'this', destructive: true }])) : 'this';
    }
    return ask<Scope>(title, message, t.back, [
      { label: t.scopeThis, value: 'this', destructive },
      { label: t.scopeFollowing, value: 'following', destructive },
    ]);
  }

  async function reload(id: number) {
    const row = await getLesson(db, id);
    if (row) setLesson(row);
  }

  async function changeAttendance(next: Attendance) {
    if (!lesson) return;
    setLesson({ ...lesson, attendance: next });
    try {
      if (!(await updateAttendance(db, lesson.id, next))) throw new Error('not updated');
      onChanged();
    } catch {
      setError(t.attendanceError);
      await reload(lesson.id).catch(() => undefined);
    }
  }

  async function cancelLesson() {
    if (!lesson) return;
    const scope = await chooseScope(t.cancelSeriesTitle, t.cancelSeriesBody, false);
    if (!scope) return;
    setBusy(true);
    try {
      await cancelLessons(db, lesson.id, scope, cancelReason.trim().slice(0, MAX_NAME_LENGTH * 2) || null);
      await reload(lesson.id);
      setError('');
      onChanged();
    } catch {
      setError(t.statusError);
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!lesson) return;
    setBusy(true);
    try {
      await restoreLesson(db, lesson.id);
      await reload(lesson.id);
      setCancelReason('');
      setError('');
      onChanged();
    } catch {
      setError(t.statusError);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!lesson) return;
    const scope = await chooseScope(t.deleteTitle, lesson.seriesId === null ? t.deleteBody : t.deleteSeriesBody, true);
    if (!scope) return;
    setBusy(true);
    try {
      await deleteLessons(db, lesson.id, scope);
      onChanged();
      onClose();
    } catch {
      setError(t.deleteError);
      setBusy(false);
    }
  }

  const cancelled = lesson?.status === 'cancelled';
  const editLoaded = !isEdit || lesson !== null;

  return (
    <SafeAreaView style={styles.modalSafe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <ModalHeader eyebrow={isEdit ? t.editEyebrow : t.newOccurrence} title={isEdit ? t.editLesson : t.addLesson} onClose={onClose} />
          {isEdit && !editLoaded ? <ErrorText message={error} /> : (
            <>
              {lesson?.seriesId != null && <Text style={styles.info}>{t.seriesNote}</Text>}
              <Field label={t.subject} value={subject} onChangeText={setSubject} placeholder={t.subjectPlaceholder} maxLength={MAX_NAME_LENGTH} />
              {quickSubjects.length > 0 && !isEdit && (
                <View style={styles.chipRow} accessibilityLabel={t.subjectsQuick}>
                  {quickSubjects.map((name) => <Chip key={name} label={name} selected={subject.trim().toLowerCase() === name.toLowerCase()} onPress={() => setSubject(name)} />)}
                </View>
              )}
              <Field label={t.teacher} value={teacher} onChangeText={setTeacher} placeholder={t.teacherPlaceholder} maxLength={MAX_NAME_LENGTH} />
              <View style={styles.formRow}>
                <View style={{ flex: 1.3 }}><Field label={t.date} value={date} onChangeText={setDate} placeholder="2026-10-20" keyboardType="numbers-and-punctuation" maxLength={10} /></View>
                <View style={{ flex: 1 }}><Field label={t.time} value={time} onChangeText={setTime} placeholder="15:00" keyboardType="numbers-and-punctuation" maxLength={5} /></View>
              </View>
              <Field label={t.duration} value={duration} onChangeText={setDuration} placeholder="60" keyboardType="number-pad" maxLength={3} />
              <Field label={t.planned} value={plannedContent} onChangeText={setPlannedContent} placeholder={t.plannedPlaceholder} multiline maxLength={MAX_TEXT_LENGTH} />
              {isEdit && <Field label={t.studied} value={studiedContent} onChangeText={setStudiedContent} placeholder={t.studiedPlaceholder} multiline maxLength={MAX_TEXT_LENGTH} />}

              {!isEdit && (
                <>
                  <Text style={styles.fieldLabel}>{t.repeat}</Text>
                  <View style={styles.chipRow}>
                    {([['none', t.repeatNone], ['weekly', t.weekly], ['biweekly', t.biweekly]] as [Repeat, string][]).map(([value, label]) => (
                      <Chip key={value} label={label} selected={repeat === value} onPress={() => chooseRepeat(value)} />
                    ))}
                  </View>
                  {repeat !== 'none' && (
                    <>
                      <Text style={styles.fieldLabel}>{t.weekdays}</Text>
                      <View style={styles.chipRow}>
                        {WEEKDAY_ORDER.map((day) => <Chip key={day} label={weekdayLabel(t, day)} selected={weekdays.includes(day)} onPress={() => toggleWeekday(day)} />)}
                      </View>
                      <Field label={t.endDate} value={endDate} onChangeText={setEndDate} placeholder={addDays(isValidLocalDate(date) ? date : '2026-10-20', 83)} keyboardType="numbers-and-punctuation" maxLength={10} />
                      {preview?.ok && (
                        <Text style={styles.info}>
                          {formatTemplate(t.seriesPreview, { count: preview.value.dates.length })}
                          {preview.value.truncated ? ` ${formatTemplate(t.seriesTruncated, { max: MAX_OCCURRENCES, last: shortDate(preview.value.dates[preview.value.dates.length - 1], language) })}` : ''}
                        </Text>
                      )}
                    </>
                  )}
                </>
              )}

              <ErrorText message={error} />
              <Pressable accessibilityRole="button" disabled={busy || cancelled} onPress={() => void save()} style={[styles.saveButton, (busy || cancelled) && styles.disabled]}>
                <Text style={styles.saveButtonText}>{busy ? t.saving : t.save}</Text>
              </Pressable>
              <Text style={styles.privacyNote}>{t.privacy}</Text>

              {lesson && series && (
                <>
                  <View style={styles.divider} />
                  <Text accessibilityRole="header" style={styles.fieldLabel}>{t.seriesSection}</Text>
                  <Text style={styles.info}>
                    {formatTemplate(t.seriesSummary, {
                      frequency: series.frequency === 'weekly' ? t.weekly : t.biweekly,
                      days: WEEKDAY_ORDER.filter((day) => series.weekdays.includes(day)).map((day) => weekdayLabel(t, day)).join(', '),
                      start: shortDate(series.startDate, language),
                      end: shortDate(series.endDate, language),
                    })}
                  </Text>
                  <Field label={t.seriesEndNew} value={newEnd} onChangeText={setNewEnd} placeholder={series.endDate} keyboardType="numbers-and-punctuation" maxLength={10} />
                  <Pressable accessibilityRole="button" disabled={busy || newEnd.trim() === series.endDate} onPress={() => void changeEnd()}
                    style={[styles.secondaryButton, (busy || newEnd.trim() === series.endDate) && styles.disabled]}>
                    <Text style={styles.secondaryButtonText}>{t.seriesEndApply}</Text>
                  </Pressable>
                  {!!seriesMessage && <Text accessibilityLiveRegion="polite" style={[styles.info, { marginTop: 10 }]}>{seriesMessage}</Text>}
                  <ErrorText message={seriesError} />
                </>
              )}

              {lesson && (
                <>
                  <View style={styles.divider} />
                  {cancelled ? (
                    <>
                      <Text style={styles.info}>{t.cancelledNote}</Text>
                      {!!lesson.cancelReason && <Text style={styles.info}>{lesson.cancelReason}</Text>}
                      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void restore()} style={[styles.secondaryButton, busy && styles.disabled]}>
                        <Text style={styles.secondaryButtonText}>{t.restoreLesson}</Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <AttendancePicker label={t.ownAttendance} value={lesson.attendance} onChange={(next) => void changeAttendance(next)} />
                      <View style={{ marginTop: 18 }}>
                        <Field label={t.cancelReason} value={cancelReason} onChangeText={setCancelReason} placeholder={t.cancelReasonPlaceholder} maxLength={MAX_NAME_LENGTH * 2} />
                      </View>
                      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void cancelLesson()} style={[styles.secondaryButton, busy && styles.disabled]}>
                        <Text style={styles.secondaryButtonText}>{t.cancelLesson}</Text>
                      </Pressable>
                    </>
                  )}
                  <Pressable accessibilityRole="button" disabled={busy} onPress={() => void remove()} style={[styles.dangerButton, busy && styles.disabled]}>
                    <Text style={styles.dangerButtonText}>{t.deleteLesson}</Text>
                  </Pressable>
                </>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
