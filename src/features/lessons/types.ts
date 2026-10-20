import type { Frequency } from './domain';

export type Attendance = 'unmarked' | 'attended' | 'absent';
export type LessonStatus = 'planned' | 'cancelled';

export type Lesson = {
  id: number;
  subjectId: number;
  subject: string;
  teacher: string | null;
  localDate: string;
  startMinute: number;
  durationMinutes: number;
  plannedContent: string | null;
  studiedContent: string | null;
  attendance: Attendance;
  status: LessonStatus;
  cancelReason: string | null;
  seriesId: number | null;
  createdAt: number;
  updatedAt: number | null;
};

export type NewLesson = {
  subject: string;
  teacher: string | null;
  localDate: string;
  startMinute: number;
  durationMinutes: number;
  plannedContent: string | null;
};

export type LessonUpdate = NewLesson & { studiedContent: string | null };

export type NewSeries = NewLesson & {
  frequency: Frequency;
  /** 0 = Sunday … 6 = Saturday. */
  weekdays: readonly number[];
  endDate: string;
  /** Concrete occurrence dates already expanded and validated by the domain module. */
  dates: readonly string[];
};

export type Scope = 'this' | 'following';

export type HistoryCursor = { localDate: string; startMinute: number; id: number };

export type HistoryQuery = {
  before: HistoryCursor | null;
  /** Only lessons on or before this local date (history = past and today). */
  onOrBefore: string;
  subjectId: number | null;
  search: string;
  limit?: number;
};
