// Fixed palette of subject colours, stored by key in `subjects.color`. Pure module:
// the per-theme colour values live in `src/theme/palette.ts`, the visible names in
// the locales. Colour is always shown together with the subject or colour name.
export const SUBJECT_COLORS = ['green', 'blue', 'purple', 'red', 'orange', 'teal', 'pink', 'gray'] as const;

export type SubjectColor = (typeof SUBJECT_COLORS)[number];

export function isSubjectColor(value: unknown): value is SubjectColor {
  return typeof value === 'string' && (SUBJECT_COLORS as readonly string[]).includes(value);
}

/** Upper bound for the manual order stored in `subjects.sort_order`. */
export const MAX_SORT_ORDER = 1_000_000;
