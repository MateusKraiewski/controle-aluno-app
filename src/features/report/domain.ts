// "Report the day": once every lesson of a day has its notes, the agenda offers a PDF
// summary of that day to share (e.g. on WhatsApp). Pure logic: readiness and the HTML
// that the print module turns into a PDF. Private notes never go into the report.
import { formatTime } from '../lessons/domain';
import type { Lesson } from '../lessons/types';

const filled = (value: string | null) => !!value && value.trim().length > 0;

export function lessonHasNotes(lesson: Pick<Lesson, 'studiedContent' | 'privateNotes' | 'nextStep'>): boolean {
  return filled(lesson.studiedContent) || filled(lesson.privateNotes) || filled(lesson.nextStep);
}

/** Lessons that still need notes: planned and not marked as missed. */
function needsNotes(lesson: Lesson): boolean {
  return lesson.status === 'planned' && lesson.attendance !== 'absent';
}

/**
 * True when the day can be reported: it has started (today or earlier), it has at least
 * one lesson that took place, and every such lesson has notes.
 */
export function isDayReady(lessons: readonly Lesson[], localDate: string, today: string): boolean {
  if (localDate > today) return false;
  const due = lessons.filter((lesson) => lesson.localDate === localDate && needsNotes(lesson));
  return due.length > 0 && due.every(lessonHasNotes);
}

export type DayReportLabels = {
  title: string;
  dateLine: string;
  generated: string;
  teacher: string;
  studied: string;
  nextStep: string;
  planned: string;
  onlyPrivate: string;
  attended: string;
  absent: string;
  unmarked: string;
  cancelled: string;
  summary: string;
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string));
}

const paragraph = (text: string) => escapeHtml(text.trim()).replace(/\r?\n/g, '<br>');

/** Self-contained HTML (no external resources) for one day's report. */
export function buildDayReportHtml(lessons: readonly Lesson[], labels: DayReportLabels): string {
  const sorted = [...lessons].sort((a, b) => a.startMinute - b.startMinute || a.id - b.id);
  const cards = sorted.map((lesson) => {
    const time = `${formatTime(lesson.startMinute)}–${formatTime(lesson.startMinute + lesson.durationMinutes)}`;
    const cancelled = lesson.status === 'cancelled';
    const badge = cancelled ? labels.cancelled : lesson.attendance === 'attended' ? labels.attended : lesson.attendance === 'absent' ? labels.absent : labels.unmarked;
    const badgeClass = cancelled ? 'muted' : lesson.attendance === 'absent' ? 'warn' : 'ok';
    const rows: string[] = [];
    if (filled(lesson.teacher)) rows.push(`<p class="meta">${escapeHtml(labels.teacher)}: ${escapeHtml(lesson.teacher as string)}</p>`);
    if (cancelled) {
      if (filled(lesson.cancelReason)) rows.push(`<p class="meta">${paragraph(lesson.cancelReason as string)}</p>`);
    } else {
      if (filled(lesson.plannedContent)) rows.push(`<h3>${escapeHtml(labels.planned)}</h3><p>${paragraph(lesson.plannedContent as string)}</p>`);
      if (filled(lesson.studiedContent)) rows.push(`<h3>${escapeHtml(labels.studied)}</h3><p>${paragraph(lesson.studiedContent as string)}</p>`);
      if (filled(lesson.nextStep)) rows.push(`<h3>${escapeHtml(labels.nextStep)}</h3><p>${paragraph(lesson.nextStep as string)}</p>`);
      if (!filled(lesson.studiedContent) && !filled(lesson.nextStep) && filled(lesson.privateNotes)) rows.push(`<p class="meta">${escapeHtml(labels.onlyPrivate)}</p>`);
    }
    return `<section class="${cancelled ? 'card cancelled' : 'card'}">
      <div class="head"><span class="time">${time}</span><span class="subject">${escapeHtml(lesson.subject)}</span><span class="badge ${badgeClass}">${escapeHtml(badge)}</span></div>
      ${rows.join('\n')}
    </section>`;
  }).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @page { margin: 18mm 14mm; }
  body { font-family: sans-serif; color: #1d2a25; font-size: 12pt; }
  header { border-bottom: 3px solid #243d34; padding-bottom: 8px; margin-bottom: 14px; }
  .brand { color: #b8612b; font-size: 9pt; letter-spacing: 2px; font-weight: bold; }
  h1 { font-size: 20pt; margin: 4px 0 2px; color: #243d34; }
  .date { font-size: 13pt; margin: 0; }
  .summary { color: #55625c; margin: 6px 0 0; font-size: 10pt; }
  .card { border: 1px solid #d5ddd8; border-left: 5px solid #243d34; border-radius: 8px; padding: 10px 12px; margin: 0 0 10px; page-break-inside: avoid; }
  .card.cancelled { border-left-color: #a0a8a4; color: #6b7570; }
  .head { display: flex; align-items: baseline; gap: 10px; }
  .time { font-weight: bold; color: #55625c; font-size: 10.5pt; }
  .subject { font-weight: bold; font-size: 14pt; flex: 1; }
  .badge { font-size: 9pt; padding: 2px 8px; border-radius: 10px; background: #e3efe8; color: #243d34; }
  .badge.warn { background: #fbe6d8; color: #8a3f12; }
  .badge.muted { background: #eceeed; color: #6b7570; }
  h3 { font-size: 9.5pt; text-transform: uppercase; letter-spacing: 1px; color: #b8612b; margin: 10px 0 2px; }
  p { margin: 2px 0; line-height: 1.4; }
  .meta { color: #55625c; font-size: 10pt; }
  footer { margin-top: 16px; color: #8a948f; font-size: 8.5pt; }
</style></head><body>
<header><div class="brand">AULA EM DIA</div><h1>${escapeHtml(labels.title)}</h1><p class="date">${escapeHtml(labels.dateLine)}</p><p class="summary">${escapeHtml(labels.summary)}</p></header>
${cards}
<footer>${escapeHtml(labels.generated)}</footer>
</body></html>`;
}
