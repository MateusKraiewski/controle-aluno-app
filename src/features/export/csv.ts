// CSV export of the student's history. Pure module: no React, Expo or SQLite.
// RFC 4180 quoting, CRLF line ends and a UTF-8 BOM so spreadsheet apps read accents.
import { formatTime } from '../lessons/domain';
import type { Attendance, LessonStatus } from '../lessons/types';

export type CsvValue = string | number | null;

const BOM = '﻿';
/** Characters that force a field into quotes. `;` too, for locales that split on it. */
const NEEDS_QUOTES = /[",;\r\n]|^\s|\s$/;
/**
 * Leading characters that spreadsheet apps treat as a formula (CSV/formula injection).
 * Such text cells get a leading apostrophe so they are shown, never evaluated.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV field: null → empty, formula-like text neutralised, quoted with "" doubled when needed. */
export function escapeCsvField(value: CsvValue): string {
  if (value === null) return '';
  let text = typeof value === 'number' ? String(value) : value;
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows to CSV text: comma separated, CRLF after every row, UTF-8 BOM first. */
export function toCsv(rows: readonly (readonly CsvValue[])[]): string {
  return BOM + rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n') + (rows.length > 0 ? '\r\n' : '');
}

export type HistoryCsvRow = {
  localDate: string;
  startMinute: number;
  durationMinutes: number;
  subject: string;
  status: LessonStatus;
  attendance: Attendance;
  plannedContent: string | null;
  studiedContent: string | null;
  nextStep: string | null;
  /** Only read from the database when the student ticked the option. */
  privateNotes?: string | null;
};

export type HistoryCsvLabels = {
  date: string; start: string; end: string; subject: string; status: string; attendance: string;
  planned: string; studied: string; nextStep: string; privateNotes: string;
  statusPlanned: string; statusCancelled: string;
  attendanceUnmarked: string; attendanceAttended: string; attendanceAbsent: string;
};

/**
 * History CSV with a header row. Status (planned/cancelled) and the student's own
 * attendance record are separate columns, as in the app. Private notes appear only
 * when `includePrivateNotes` is true.
 */
export function buildHistoryCsv(rows: readonly HistoryCsvRow[], labels: HistoryCsvLabels, options: { includePrivateNotes: boolean }): string {
  const header = [labels.date, labels.start, labels.end, labels.subject, labels.status, labels.attendance, labels.planned, labels.studied, labels.nextStep];
  if (options.includePrivateNotes) header.push(labels.privateNotes);
  const attendance: Record<Attendance, string> = { unmarked: labels.attendanceUnmarked, attended: labels.attendanceAttended, absent: labels.attendanceAbsent };
  const body = rows.map((row) => {
    const cells: CsvValue[] = [
      row.localDate, formatTime(row.startMinute), formatTime((row.startMinute + row.durationMinutes) % 1440), row.subject,
      row.status === 'cancelled' ? labels.statusCancelled : labels.statusPlanned,
      // A cancelled lesson never carries attendance.
      row.status === 'cancelled' ? '' : attendance[row.attendance],
      row.plannedContent, row.studiedContent, row.nextStep,
    ];
    if (options.includePrivateNotes) cells.push(row.privateNotes ?? null);
    return cells;
  });
  return toCsv([header, ...body]);
}

/** Suggested file name, e.g. `aula-em-dia-historico-2026-10-21.csv`. */
export function historyCsvFileName(localDate: string): string {
  return `aula-em-dia-historico-${localDate}.csv`;
}
