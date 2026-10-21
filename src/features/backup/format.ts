// Versioned local backup document and its strict validator. Pure module: no React,
// no Expo, no SQLite. A backup that fails any rule is rejected as a whole.
import { MAX_DURATION, MAX_NAME_LENGTH, MAX_TEXT_LENGTH, MIN_DURATION, isValidLocalDate } from '../lessons/domain';
import { MAX_OBJECTIVE_TITLE, OBJECTIVE_STATUSES } from '../objectives/domain';
import { MAX_SORT_ORDER, SUBJECT_COLORS } from '../subjects/colors';
import type { SubjectColor } from '../subjects/colors';

export const BACKUP_FORMAT = 'aula-em-dia.backup';
/**
 * Version of the backup document, independent of the SQLite schema since schema v6:
 * the v6 attachment tables are deliberately not part of a backup (neither the files
 * nor their metadata), so the document shape is still the v5 one. Bump only when the
 * document itself changes, and keep accepting the previous versions.
 */
export const BACKUP_SCHEMA_VERSION = 5;
/**
 * Oldest backup schema still accepted. v3 and v4 documents (previous app versions) are
 * read and their missing fields filled with empty values; exports are always current.
 */
export const MIN_BACKUP_SCHEMA = 3;
/** Text size cap (UTF-16 code units) for a pasted or picked backup and for an export. */
export const MAX_BACKUP_CHARS = 10_000_000;
export const MAX_BACKUP_SUBJECTS = 2_000;
export const MAX_BACKUP_SERIES = 5_000;
export const MAX_BACKUP_LESSONS = 30_000;
export const MAX_BACKUP_OBJECTIVES = 10_000;
export const MAX_BACKUP_OBJECTIVE_LINKS = 60_000;
export const MAX_CANCEL_REASON_LENGTH = MAX_NAME_LENGTH * 2;

const MAX_TIMESTAMP = 8_640_000_000_000_000;
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

export type BackupSubject = {
  id: number;
  name: string;
  created_at: number;
  archived_at: number | null;
  /** v4 */ color: SubjectColor | null;
  /** v4 */ sort_order: number | null;
};

export type BackupSeries = {
  id: number;
  subject_id: number;
  frequency: 'weekly' | 'biweekly';
  weekdays_mask: number;
  start_date: string;
  end_date: string;
  start_minute: number;
  duration_minutes: number;
  created_at: number;
  /** v4 */ teacher_name: string | null;
  /** v4 */ planned_content: string | null;
};

export type BackupLesson = {
  id: number;
  subject_id: number;
  teacher_name: string | null;
  local_date: string;
  start_minute: number;
  duration_minutes: number;
  planned_content: string | null;
  studied_content: string | null;
  attendance: 'unmarked' | 'attended' | 'absent';
  status: 'planned' | 'cancelled';
  cancel_reason: string | null;
  series_id: number | null;
  original_local_date: string | null;
  created_at: number;
  updated_at: number | null;
  /** v4 */ private_notes: string | null;
  /** v4 */ next_step: string | null;
  /** v4: 1 when the occurrence was edited on its own and series edits must skip it. */ series_exception: 0 | 1;
};

/** v5 */
export type BackupObjective = {
  id: number;
  subject_id: number;
  title: string;
  status: 'open' | 'practising' | 'done';
  created_at: number;
  updated_at: number;
  /** Basis date of the review suggestion the student dismissed. */
  dismissed_review_basis: string | null;
  dismissed_review_at: number | null;
};

/** v5: an objective the student tagged as worked on in a lesson. */
export type BackupLessonObjective = { lesson_id: number; objective_id: number; created_at: number };

/**
 * Everything the student recorded except attachments. Derived search columns, device
 * preferences (language, theme) and lesson attachments (files and their metadata) are
 * deliberately not part of a backup.
 */
export type BackupDocument = {
  format: typeof BACKUP_FORMAT;
  schema_version: number;
  exported_at: string;
  subjects: BackupSubject[];
  lesson_series: BackupSeries[];
  lessons: BackupLesson[];
  /** v5 (empty when restoring an older document) */ learning_objectives: BackupObjective[];
  /** v5 (empty when restoring an older document) */ lesson_objectives: BackupLessonObjective[];
};

declare const validated: unique symbol;
/** A document that passed `validateBackup`; only that function produces this type. */
export type ValidatedBackup = BackupDocument & { readonly [validated]: true };

export type BackupErrorCode =
  | 'empty' | 'tooLarge' | 'notJson' | 'notBackup' | 'newerSchema' | 'olderSchema'
  | 'tooManyRecords' | 'invalidField' | 'duplicateId' | 'duplicateSubject' | 'missingReference';

export type BackupError = { code: BackupErrorCode; path?: string };

export type BackupSummary = { exportedAt: string; schemaVersion: number; subjects: number; series: number; lessons: number; objectives: number };

export function summarizeBackup(document: BackupDocument): BackupSummary {
  return {
    exportedAt: document.exported_at, schemaVersion: document.schema_version,
    subjects: document.subjects.length, series: document.lesson_series.length, lessons: document.lessons.length,
    objectives: document.learning_objectives.length,
  };
}

export function serializeBackup(document: BackupDocument): string {
  return JSON.stringify(document);
}

/** Suggested file name, e.g. `aula-em-dia-backup-2026-10-20.json`. */
export function backupFileName(exportedAt: string): string {
  return `aula-em-dia-backup-${exportedAt.slice(0, 10)}.json`;
}

class Invalid extends Error {
  readonly detail: BackupError;

  constructor(detail: BackupError) {
    super(detail.code);
    this.detail = detail;
  }
}

function fail(code: BackupErrorCode, path?: string): never {
  throw new Invalid({ code, path });
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: unknown, keys: readonly string[], path: string): Json {
  if (!isObject(value)) fail('invalidField', path);
  const actual = Object.keys(value);
  for (const key of actual) if (!keys.includes(key)) fail('invalidField', `${path}.${key}`);
  for (const key of keys) if (!(key in value)) fail('invalidField', `${path}.${key}`);
  return value;
}

function int(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail('invalidField', path);
  return value;
}

function id(value: unknown, path: string): number {
  return int(value, path, 1, Number.MAX_SAFE_INTEGER);
}

function timestamp(value: unknown, path: string): number {
  return int(value, path, 0, MAX_TIMESTAMP);
}

function optionalTimestamp(value: unknown, path: string): number | null {
  return value === null ? null : timestamp(value, path);
}

function text(value: unknown, path: string, max: number): string {
  if (typeof value !== 'string' || value.length > max || value.includes('\u0000')) fail('invalidField', path);
  return value;
}

function optionalText(value: unknown, path: string, max: number): string | null {
  if (value === null) return null;
  const result = text(value, path, max);
  if (!result.trim()) fail('invalidField', path); // the app stores empty optional text as null
  return result;
}

/** Single-line text exactly as the app stores it: trimmed, inner whitespace collapsed, never empty. */
function singleLine(value: unknown, path: string, max: number): string {
  const result = text(value, path, max);
  if (!result || result !== result.trim().replace(/\s+/g, ' ')) fail('invalidField', path);
  return result;
}

function name(value: unknown, path: string): string {
  return singleLine(value, path, MAX_NAME_LENGTH);
}

/** Optional single-line value as the app stores it: trimmed, never blank. */
function optionalTrimmed(value: unknown, path: string, max: number): string | null {
  const result = optionalText(value, path, max);
  if (result !== null && (result !== result.trim() || /[\r\n]/.test(result))) fail('invalidField', path);
  return result;
}

function localDate(value: unknown, path: string): string {
  if (typeof value !== 'string' || !DATE_SHAPE.test(value) || !isValidLocalDate(value)) fail('invalidField', path);
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail('invalidField', path);
  return value as T;
}

function list(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) fail('invalidField', path);
  if (value.length > max) fail('tooManyRecords', path);
  return value;
}

/** SQLite's NOCASE only folds ASCII letters, so uniqueness is checked the same way. */
function asciiFold(value: string): string {
  return value.replace(/[A-Z]/g, (char) => char.toLowerCase());
}

const SUBJECT_KEYS_V3 = ['id', 'name', 'created_at', 'archived_at'] as const;
const SERIES_KEYS_V3 = ['id', 'subject_id', 'frequency', 'weekdays_mask', 'start_date', 'end_date', 'start_minute', 'duration_minutes', 'created_at'] as const;
const LESSON_KEYS_V3 = [
  'id', 'subject_id', 'teacher_name', 'local_date', 'start_minute', 'duration_minutes', 'planned_content', 'studied_content',
  'attendance', 'status', 'cancel_reason', 'series_id', 'original_local_date', 'created_at', 'updated_at',
] as const;
const SUBJECT_KEYS_V4 = [...SUBJECT_KEYS_V3, 'color', 'sort_order'] as const;
const SERIES_KEYS_V4 = [...SERIES_KEYS_V3, 'teacher_name', 'planned_content'] as const;
const LESSON_KEYS_V4 = [...LESSON_KEYS_V3, 'private_notes', 'next_step', 'series_exception'] as const;
const OBJECTIVE_KEYS = ['id', 'subject_id', 'title', 'status', 'created_at', 'updated_at', 'dismissed_review_basis', 'dismissed_review_at'] as const;
const LESSON_OBJECTIVE_KEYS = ['lesson_id', 'objective_id', 'created_at'] as const;
const TOP_KEYS_V3 = ['format', 'schema_version', 'exported_at', 'subjects', 'lesson_series', 'lessons'] as const;
const TOP_KEYS_V5 = [...TOP_KEYS_V3, 'learning_objectives', 'lesson_objectives'] as const;

function parseDocument(input: unknown, appSchema: number): BackupDocument {
  if (!isObject(input) || input.format !== BACKUP_FORMAT) fail('notBackup');
  const schema = input.schema_version;
  if (typeof schema !== 'number' || !Number.isSafeInteger(schema)) fail('invalidField', 'schema_version');
  if (schema > appSchema) fail('newerSchema');
  if (schema < MIN_BACKUP_SCHEMA) fail('olderSchema');
  // Field sets are exact per version: an older document has no newer keys and vice versa.
  const v4 = schema >= 4;
  const v5 = schema >= 5;
  const top = exactKeys(input, v5 ? TOP_KEYS_V5 : TOP_KEYS_V3, '$');
  const exportedAt = text(top.exported_at, 'exported_at', 40);
  if (Number.isNaN(Date.parse(exportedAt))) fail('invalidField', 'exported_at');

  const subjectIds = new Set<number>();
  const subjectNames = new Set<string>();
  const subjects = list(top.subjects, 'subjects', MAX_BACKUP_SUBJECTS).map((raw, index): BackupSubject => {
    const path = `subjects[${index}]`;
    const row = exactKeys(raw, v4 ? SUBJECT_KEYS_V4 : SUBJECT_KEYS_V3, path);
    const subject: BackupSubject = {
      id: id(row.id, `${path}.id`), name: name(row.name, `${path}.name`),
      created_at: timestamp(row.created_at, `${path}.created_at`), archived_at: optionalTimestamp(row.archived_at, `${path}.archived_at`),
      color: v4 && row.color !== null ? oneOf(row.color, SUBJECT_COLORS, `${path}.color`) : null,
      sort_order: v4 && row.sort_order !== null ? int(row.sort_order, `${path}.sort_order`, 0, MAX_SORT_ORDER) : null,
    };
    if (subjectIds.has(subject.id)) fail('duplicateId', `${path}.id`);
    subjectIds.add(subject.id);
    const key = asciiFold(subject.name);
    if (subjectNames.has(key)) fail('duplicateSubject', `${path}.name`);
    subjectNames.add(key);
    return subject;
  });

  const seriesIds = new Set<number>();
  const series = list(top.lesson_series, 'lesson_series', MAX_BACKUP_SERIES).map((raw, index): BackupSeries => {
    const path = `lesson_series[${index}]`;
    const row = exactKeys(raw, v4 ? SERIES_KEYS_V4 : SERIES_KEYS_V3, path);
    const item: BackupSeries = {
      id: id(row.id, `${path}.id`),
      subject_id: id(row.subject_id, `${path}.subject_id`),
      frequency: oneOf(row.frequency, ['weekly', 'biweekly'] as const, `${path}.frequency`),
      weekdays_mask: int(row.weekdays_mask, `${path}.weekdays_mask`, 1, 127),
      start_date: localDate(row.start_date, `${path}.start_date`),
      end_date: localDate(row.end_date, `${path}.end_date`),
      start_minute: int(row.start_minute, `${path}.start_minute`, 0, 1439),
      duration_minutes: int(row.duration_minutes, `${path}.duration_minutes`, MIN_DURATION, MAX_DURATION),
      created_at: timestamp(row.created_at, `${path}.created_at`),
      teacher_name: v4 ? optionalTrimmed(row.teacher_name, `${path}.teacher_name`, MAX_NAME_LENGTH) : null,
      planned_content: v4 ? optionalText(row.planned_content, `${path}.planned_content`, MAX_TEXT_LENGTH) : null,
    };
    if (item.end_date < item.start_date) fail('invalidField', `${path}.end_date`);
    if (seriesIds.has(item.id)) fail('duplicateId', `${path}.id`);
    if (!subjectIds.has(item.subject_id)) fail('missingReference', `${path}.subject_id`);
    seriesIds.add(item.id);
    return item;
  });

  const lessonIds = new Set<number>();
  const lessons = list(top.lessons, 'lessons', MAX_BACKUP_LESSONS).map((raw, index): BackupLesson => {
    const path = `lessons[${index}]`;
    const row = exactKeys(raw, v4 ? LESSON_KEYS_V4 : LESSON_KEYS_V3, path);
    const lesson: BackupLesson = {
      id: id(row.id, `${path}.id`),
      subject_id: id(row.subject_id, `${path}.subject_id`),
      teacher_name: optionalTrimmed(row.teacher_name, `${path}.teacher_name`, MAX_NAME_LENGTH),
      local_date: localDate(row.local_date, `${path}.local_date`),
      start_minute: int(row.start_minute, `${path}.start_minute`, 0, 1439),
      duration_minutes: int(row.duration_minutes, `${path}.duration_minutes`, MIN_DURATION, MAX_DURATION),
      planned_content: optionalText(row.planned_content, `${path}.planned_content`, MAX_TEXT_LENGTH),
      studied_content: optionalText(row.studied_content, `${path}.studied_content`, MAX_TEXT_LENGTH),
      attendance: oneOf(row.attendance, ['unmarked', 'attended', 'absent'] as const, `${path}.attendance`),
      status: oneOf(row.status, ['planned', 'cancelled'] as const, `${path}.status`),
      cancel_reason: optionalText(row.cancel_reason, `${path}.cancel_reason`, MAX_CANCEL_REASON_LENGTH),
      series_id: row.series_id === null ? null : id(row.series_id, `${path}.series_id`),
      original_local_date: row.original_local_date === null ? null : localDate(row.original_local_date, `${path}.original_local_date`),
      created_at: timestamp(row.created_at, `${path}.created_at`),
      updated_at: optionalTimestamp(row.updated_at, `${path}.updated_at`),
      private_notes: v4 ? optionalText(row.private_notes, `${path}.private_notes`, MAX_TEXT_LENGTH) : null,
      next_step: v4 ? optionalText(row.next_step, `${path}.next_step`, MAX_TEXT_LENGTH) : null,
      series_exception: v4 ? int(row.series_exception, `${path}.series_exception`, 0, 1) as 0 | 1 : 0,
    };
    if (lesson.series_id === null && lesson.series_exception !== 0) fail('invalidField', `${path}.series_exception`);
    // Domain invariants: a cancelled lesson is never an absence or a presence;
    // only cancelled lessons carry a cancellation reason.
    if (lesson.status === 'cancelled' && lesson.attendance !== 'unmarked') fail('invalidField', `${path}.attendance`);
    if (lesson.status === 'planned' && lesson.cancel_reason !== null) fail('invalidField', `${path}.cancel_reason`);
    if (lessonIds.has(lesson.id)) fail('duplicateId', `${path}.id`);
    if (!subjectIds.has(lesson.subject_id)) fail('missingReference', `${path}.subject_id`);
    if (lesson.series_id !== null && !seriesIds.has(lesson.series_id)) fail('missingReference', `${path}.series_id`);
    lessonIds.add(lesson.id);
    return lesson;
  });

  const lessonSubjects = new Map(lessons.map((lesson) => [lesson.id, lesson.subject_id]));
  const objectiveSubjects = new Map<number, number>();
  const objectives = v5 ? list(top.learning_objectives, 'learning_objectives', MAX_BACKUP_OBJECTIVES).map((raw, index): BackupObjective => {
    const path = `learning_objectives[${index}]`;
    const row = exactKeys(raw, OBJECTIVE_KEYS, path);
    const objective: BackupObjective = {
      id: id(row.id, `${path}.id`),
      subject_id: id(row.subject_id, `${path}.subject_id`),
      title: singleLine(row.title, `${path}.title`, MAX_OBJECTIVE_TITLE),
      status: oneOf(row.status, OBJECTIVE_STATUSES, `${path}.status`),
      created_at: timestamp(row.created_at, `${path}.created_at`),
      updated_at: timestamp(row.updated_at, `${path}.updated_at`),
      dismissed_review_basis: row.dismissed_review_basis === null ? null : localDate(row.dismissed_review_basis, `${path}.dismissed_review_basis`),
      dismissed_review_at: optionalTimestamp(row.dismissed_review_at, `${path}.dismissed_review_at`),
    };
    // The dismissal is a pair: both set or both empty.
    if ((objective.dismissed_review_basis === null) !== (objective.dismissed_review_at === null)) fail('invalidField', `${path}.dismissed_review_at`);
    if (objectiveSubjects.has(objective.id)) fail('duplicateId', `${path}.id`);
    if (!subjectIds.has(objective.subject_id)) fail('missingReference', `${path}.subject_id`);
    objectiveSubjects.set(objective.id, objective.subject_id);
    return objective;
  }) : [];

  const linkKeys = new Set<string>();
  const links = v5 ? list(top.lesson_objectives, 'lesson_objectives', MAX_BACKUP_OBJECTIVE_LINKS).map((raw, index): BackupLessonObjective => {
    const path = `lesson_objectives[${index}]`;
    const row = exactKeys(raw, LESSON_OBJECTIVE_KEYS, path);
    const link: BackupLessonObjective = {
      lesson_id: id(row.lesson_id, `${path}.lesson_id`),
      objective_id: id(row.objective_id, `${path}.objective_id`),
      created_at: timestamp(row.created_at, `${path}.created_at`),
    };
    const lessonSubject = lessonSubjects.get(link.lesson_id);
    if (lessonSubject === undefined) fail('missingReference', `${path}.lesson_id`);
    const objectiveSubject = objectiveSubjects.get(link.objective_id);
    if (objectiveSubject === undefined) fail('missingReference', `${path}.objective_id`);
    // A lesson can only be tagged with objectives of its own subject.
    if (objectiveSubject !== lessonSubject) fail('invalidField', `${path}.objective_id`);
    const key = `${link.lesson_id}:${link.objective_id}`;
    if (linkKeys.has(key)) fail('duplicateId', path);
    linkKeys.add(key);
    return link;
  }) : [];

  return {
    format: BACKUP_FORMAT, schema_version: schema, exported_at: exportedAt, subjects, lesson_series: series, lessons,
    learning_objectives: objectives, lesson_objectives: links,
  };
}

export type ValidationResult = { ok: true; value: ValidatedBackup } | { ok: false; error: BackupError };

/**
 * Parses and validates backup text: format id, schema version (never newer than the
 * app), exact field sets, types, date/time formats, length limits, unique ids and
 * subject names, referential integrity and objective tags limited to the lesson's
 * own subject. Returns a fresh copy with only known fields.
 */
export function validateBackup(source: string, appSchema = BACKUP_SCHEMA_VERSION): ValidationResult {
  if (!source.trim()) return { ok: false, error: { code: 'empty' } };
  if (source.length > MAX_BACKUP_CHARS) return { ok: false, error: { code: 'tooLarge' } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { ok: false, error: { code: 'notJson' } };
  }
  try {
    return { ok: true, value: parseDocument(parsed, appSchema) as ValidatedBackup };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.detail };
    throw error;
  }
}
