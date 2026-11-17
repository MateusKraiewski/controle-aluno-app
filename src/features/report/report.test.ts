import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Lesson } from '../lessons/types';
import { buildDayReportHtml, isDayReady } from './domain';
import type { DayReportLabels } from './domain';

const lesson = (id: number, extra: Partial<Lesson> = {}): Lesson => ({
  id, subjectId: id, subject: `Disciplina ${id}`, subjectColor: null, teacher: null, localDate: '2026-11-17',
  startMinute: 480 + id * 60, durationMinutes: 50, plannedContent: null, studiedContent: null, privateNotes: null, nextStep: null,
  attendance: 'unmarked', status: 'planned', cancelReason: null, seriesId: null, seriesException: false, createdAt: 0, updatedAt: null, ...extra,
});

const labels: DayReportLabels = {
  title: 'Relatório do dia', dateLine: 'Terça-feira, 17 de novembro', generated: 'Gerado', teacher: 'Professor', studied: 'O que foi dado',
  nextStep: 'Próximo passo', planned: 'Previsto', onlyPrivate: 'Só privados', attended: 'Presente', absent: 'Faltou',
  unmarked: 'Sem registo', cancelled: 'Cancelada', summary: '3 aulas',
};

describe('day report', () => {
  it('is ready only when every lesson that took place has notes', () => {
    const day = [lesson(1, { studiedContent: 'Frações' }), lesson(2, { nextStep: 'TPC p. 12' }), lesson(3, { status: 'cancelled' }), lesson(4, { attendance: 'absent' })];
    assert.equal(isDayReady(day, '2026-11-17', '2026-11-17'), true);
    assert.equal(isDayReady(day, '2026-11-17', '2026-11-16'), false, 'future day');
    assert.equal(isDayReady([...day, lesson(5, { privateNotes: '   ' })], '2026-11-17', '2026-11-17'), false);
    assert.equal(isDayReady([lesson(1, { status: 'cancelled' })], '2026-11-17', '2026-11-17'), false, 'nothing took place');
  });

  it('builds escaped HTML in time order without private notes', () => {
    const html = buildDayReportHtml([
      lesson(2, { subject: 'Português', studiedContent: 'Os Lusíadas\nCanto I', privateNotes: 'segredo', attendance: 'attended', teacher: 'Prof. Ana' }),
      lesson(1, { subject: 'Matemática <b>', privateNotes: 'só meu' }),
    ], labels);
    assert.ok(html.indexOf('Matemática &lt;b&gt;') < html.indexOf('Português'));
    assert.match(html, /Os Lusíadas<br>Canto I/);
    assert.match(html, /Prof\. Ana/);
    assert.match(html, /Só privados/);
    assert.ok(!html.includes('segredo') && !html.includes('só meu'));
    assert.ok(!/https?:\/\//.test(html), 'no external resources');
  });
});
