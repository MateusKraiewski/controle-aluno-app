import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../../db/migrations';
import { openTestDatabase } from '../../testing/nodeSqlite';
import { cancelLessons, createLesson, updateAttendance, updateLesson } from '../lessons/repository';
import { buildHistoryCsv, escapeCsvField, historyCsvFileName, toCsv } from './csv';
import type { HistoryCsvLabels, HistoryCsvRow } from './csv';
import { HistoryExportTooLargeError, readHistoryForCsv } from './repository';

const BOM = '﻿';

/** Minimal RFC 4180 reader used only to prove the output parses back to the same cells. */
function parseCsv(text: string): string[][] {
  const source = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index += 1; } else if (char === '"') quoted = false; else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; } else if (char === '\r' && source[index + 1] === '\n') {
      row.push(field); rows.push(row); row = []; field = ''; index += 1;
    } else field += char;
  }
  assert.equal(quoted, false, 'unterminated quote');
  assert.equal(field + row.join(''), '', 'trailing data after the last CRLF');
  return rows;
}

describe('CSV escaping', () => {
  it('leaves plain values alone and quotes separators, quotes and line breaks', () => {
    assert.equal(escapeCsvField('Física'), 'Física');
    assert.equal(escapeCsvField(42), '42');
    assert.equal(escapeCsvField(null), '');
    assert.equal(escapeCsvField(''), '');
    assert.equal(escapeCsvField('a,b'), '"a,b"');
    assert.equal(escapeCsvField('a;b'), '"a;b"');
    assert.equal(escapeCsvField('diz "olá"'), '"diz ""olá"""');
    assert.equal(escapeCsvField('linha 1\nlinha 2'), '"linha 1\nlinha 2"');
    assert.equal(escapeCsvField('linha 1\r\nlinha 2'), '"linha 1\r\nlinha 2"');
    assert.equal(escapeCsvField(' espaço '), '" espaço "');
    assert.equal(escapeCsvField("d'água"), "d'água");
  });

  it('neutralises formula-like text so spreadsheets never evaluate it', () => {
    assert.equal(escapeCsvField('=1+1'), "'=1+1");
    assert.equal(escapeCsvField('+351 900'), "'+351 900");
    assert.equal(escapeCsvField('-3 exercícios'), "'-3 exercícios");
    assert.equal(escapeCsvField('@SUM(A1)'), "'@SUM(A1)");
    assert.equal(escapeCsvField('=HYPERLINK("http://x","y")'), `"'=HYPERLINK(""http://x"",""y"")"`);
    assert.equal(escapeCsvField('\tx'), "'\tx"); // no longer starts with whitespace once prefixed
    assert.equal(escapeCsvField(-3), '-3'); // numbers are data, not text
    assert.equal(escapeCsvField('a=b'), 'a=b');
  });

  it('joins rows with CRLF after a UTF-8 BOM and round-trips through a CSV reader', () => {
    const cells = [['a', 'b,c', 'd"e'], ['x\ny', '', ';']];
    const text = toCsv(cells);
    assert.ok(text.startsWith(BOM));
    assert.ok(text.endsWith('\r\n'));
    assert.deepEqual(parseCsv(text), cells);
    assert.equal(toCsv([]), BOM);
  });
});

const labels: HistoryCsvLabels = {
  date: 'Data', start: 'Início', end: 'Fim', subject: 'Matéria', status: 'Estado', attendance: 'Presença (registo do aluno)',
  planned: 'Planeado', studied: 'Estudado', nextStep: 'Próximo passo', privateNotes: 'Apontamentos privados',
  statusPlanned: 'Planeada', statusCancelled: 'Cancelada', attendanceUnmarked: 'Pendente', attendanceAttended: 'Fui', attendanceAbsent: 'Faltei',
};

describe('history CSV', () => {
  const row: HistoryCsvRow = {
    localDate: '2026-10-01', startMinute: 1410, durationMinutes: 60, subject: 'Física, "avançada"', status: 'planned', attendance: 'attended',
    plannedContent: 'Ótica\nlentes', studiedContent: '=SOMA(A1)', nextStep: null, privateNotes: 'segredo',
  };

  it('writes the header and one row per lesson without private notes by default', () => {
    const parsed = parseCsv(buildHistoryCsv([row, { ...row, status: 'cancelled', attendance: 'unmarked' }], labels, { includePrivateNotes: false }));
    assert.deepEqual(parsed[0], ['Data', 'Início', 'Fim', 'Matéria', 'Estado', 'Presença (registo do aluno)', 'Planeado', 'Estudado', 'Próximo passo']);
    // End time wraps past midnight; formula text is neutralised; notes absent.
    assert.deepEqual(parsed[1], ['2026-10-01', '23:30', '00:30', 'Física, "avançada"', 'Planeada', 'Fui', 'Ótica\nlentes', "'=SOMA(A1)", '']);
    assert.deepEqual(parsed[2].slice(4, 6), ['Cancelada', '']);
    assert.ok(parsed.every((cells) => !cells.includes('segredo')));
  });

  it('adds the private notes column only when asked', () => {
    const parsed = parseCsv(buildHistoryCsv([row], labels, { includePrivateNotes: true }));
    assert.equal(parsed[0][9], 'Apontamentos privados');
    assert.equal(parsed[1][9], 'segredo');
    assert.equal(historyCsvFileName('2026-10-21'), 'aula-em-dia-historico-2026-10-21.csv');
  });

  it('reads the history up to today in order, across pages, and reads notes only on request', async () => {
    const { db, raw } = openTestDatabase();
    await migrate(db);
    const base = { subject: 'Física', teacher: null, startMinute: 600, durationMinutes: 50, plannedContent: 'Plano' };
    const first = await createLesson(db, { ...base, localDate: '2026-10-02' });
    await updateLesson(db, first, { ...base, localDate: '2026-10-02', studiedContent: 'Lentes', privateNotes: 'Só meu', nextStep: 'Rever' });
    await updateAttendance(db, first, 'absent');
    const cancelled = await createLesson(db, { ...base, localDate: '2026-10-01', startMinute: 900 });
    await cancelLessons(db, cancelled, 'this', null);
    await createLesson(db, { ...base, localDate: '2026-11-30' }); // future: not history
    const insert = raw.prepare("INSERT INTO lessons (subject_id, local_date, start_minute, duration_minutes, created_at, search_text) VALUES (1, '2026-09-01', ?, 30, 1, '')");
    for (let index = 0; index < 1001; index += 1) insert.run(index % 1440);

    const plain = await readHistoryForCsv(db, '2026-10-21', { includePrivateNotes: false });
    assert.equal(plain.length, 1003);
    assert.ok(plain.every((item) => !('privateNotes' in item)));
    const keys = plain.map((item) => `${item.localDate} ${String(item.startMinute).padStart(4, '0')}`);
    assert.deepEqual(keys, [...keys].sort());
    assert.deepEqual(plain.slice(-2).map((item) => [item.localDate, item.status, item.attendance, item.nextStep]),
      [['2026-10-01', 'cancelled', 'unmarked', null], ['2026-10-02', 'planned', 'absent', 'Rever']]);
    const withNotes = await readHistoryForCsv(db, '2026-10-21', { includePrivateNotes: true });
    assert.equal(withNotes[withNotes.length - 1].privateNotes, 'Só meu');
    await assert.rejects(readHistoryForCsv(db, '21/10/2026', { includePrivateNotes: false }), RangeError);
  });

  it('refuses instead of truncating above the cap', async () => {
    const { db, raw } = openTestDatabase();
    await migrate(db);
    raw.exec("INSERT INTO subjects (id, name, search_name, created_at) VALUES (1, 'Física', 'fisica', 1)");
    raw.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 30001)
      INSERT INTO lessons (subject_id, local_date, start_minute, duration_minutes, created_at, search_text) SELECT 1, '2026-01-01', i % 1440, 30, 1, '' FROM n`);
    await assert.rejects(readHistoryForCsv(db, '2026-10-21', { includePrivateNotes: false }), HistoryExportTooLargeError);
  });
});
