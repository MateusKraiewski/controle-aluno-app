// Pure learning-objective rules: title validation and explainable review suggestions.
// No React, no SQLite. Suggestions only look at dates the student recorded (when an
// objective was created and the lessons where the student tagged it); they never
// infer grades, performance or mastery.
import { daysBetween, isValidLocalDate } from '../lessons/domain';
import type { Result } from '../lessons/domain';

export const OBJECTIVE_STATUSES = ['open', 'practising', 'done'] as const;
export type ObjectiveStatus = (typeof OBJECTIVE_STATUSES)[number];

export const MAX_OBJECTIVE_TITLE = 200;
/** An objective not worked on for this many days produces a review suggestion. */
export const REVIEW_AFTER_DAYS = 21;
/** Suggestions shown at once, oldest first. */
export const MAX_SUGGESTIONS = 5;

export function isObjectiveStatus(value: unknown): value is ObjectiveStatus {
  return typeof value === 'string' && (OBJECTIVE_STATUSES as readonly string[]).includes(value);
}

export type ObjectiveTitleError = 'titleRequired' | 'titleTooLong';

/** Single-line title as stored: trimmed, whitespace runs collapsed, 1–200 characters. */
export function normalizeObjectiveTitle(input: string): Result<string, ObjectiveTitleError> {
  const title = input.replace(/\s+/g, ' ').trim();
  if (!title) return { ok: false, error: 'titleRequired' };
  if (title.length > MAX_OBJECTIVE_TITLE) return { ok: false, error: 'titleTooLong' };
  return { ok: true, value: title };
}

export type ReviewCandidate = {
  objectiveId: number;
  subjectId: number;
  subject: string;
  title: string;
  status: ObjectiveStatus;
  /** Local date (YYYY-MM-DD) the objective was created on this device. */
  createdDate: string;
  /** Latest past, non-cancelled lesson the student tagged with it (not marked absent); null if none. */
  lastWorkedDate: string | null;
  /** Basis date of the suggestion the student dismissed, if any. */
  dismissedBasis: string | null;
};

export type ReviewSuggestion = {
  objectiveId: number;
  subjectId: number;
  subject: string;
  title: string;
  /** notReviewed: worked on before, not since `basisDate`. neverWorked: no tagged lesson since creation. */
  kind: 'notReviewed' | 'neverWorked';
  /** The source shown to the student: last tagged lesson date, or creation date. */
  basisDate: string;
  days: number;
  /** Whole weeks since `basisDate` (≥ 3 with the default threshold). */
  weeks: number;
};

/**
 * Explainable review suggestions. An objective that is not done and whose basis date
 * (last tagged lesson, or creation when never tagged) is at least `thresholdDays`
 * before `today` yields one suggestion stating that basis. A dismissal hides only the
 * suggestion with the same basis: once the objective is worked on again and goes
 * stale again, a new suggestion can appear. Oldest basis first, then by id.
 */
export function computeReviewSuggestions(
  candidates: readonly ReviewCandidate[],
  today: string,
  options: { thresholdDays?: number; limit?: number } = {},
): ReviewSuggestion[] {
  const threshold = options.thresholdDays ?? REVIEW_AFTER_DAYS;
  const limit = options.limit ?? MAX_SUGGESTIONS;
  if (!isValidLocalDate(today) || limit <= 0) return [];
  const suggestions: ReviewSuggestion[] = [];
  for (const candidate of candidates) {
    if (candidate.status === 'done') continue;
    const worked = candidate.lastWorkedDate !== null && isValidLocalDate(candidate.lastWorkedDate) && candidate.lastWorkedDate <= today
      ? candidate.lastWorkedDate : null;
    const basisDate = worked ?? candidate.createdDate;
    if (!isValidLocalDate(basisDate)) continue;
    if (candidate.dismissedBasis === basisDate) continue;
    const days = daysBetween(basisDate, today);
    if (days < threshold) continue;
    suggestions.push({
      objectiveId: candidate.objectiveId, subjectId: candidate.subjectId, subject: candidate.subject, title: candidate.title,
      kind: worked ? 'notReviewed' : 'neverWorked', basisDate, days, weeks: Math.floor(days / 7),
    });
  }
  suggestions.sort((a, b) => (a.basisDate === b.basisDate ? a.objectiveId - b.objectiveId : a.basisDate < b.basisDate ? -1 : 1));
  return suggestions.slice(0, limit);
}
