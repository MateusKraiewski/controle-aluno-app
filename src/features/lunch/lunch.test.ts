import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { migrate } from '../../db/migrations';
import { openTestDatabase } from '../../testing/nodeSqlite';
import { parseSchoolMenu, parseWeekHeader } from './menu-parser';
import type { TextItem } from './pdf-text';
import { extractPdfText } from './pdf-text';
import { deleteLunchDays, listLunchDays, saveLunchMenu, setLunchChoice } from './repository';

const item = (y: number, x: number, text: string, width = text.length * 4): TextItem => ({ page: 1, x, y, width, text });

describe('school menu parser', () => {
  it('reads week headers, including the variant without "de" and weeks across months', () => {
    assert.deepEqual(parseWeekHeader('Semana de 05 a 09 de outubro de 2026'), { start: '2026-10-05', end: '2026-10-09' });
    assert.deepEqual(parseWeekHeader('Semana 12 a 16 de outubro de 2026'), { start: '2026-10-12', end: '2026-10-16' });
    assert.deepEqual(parseWeekHeader('Semana de 28 de dezembro a 1 de janeiro de 2027'), { start: '2026-12-28', end: '2027-01-01' });
    assert.deepEqual(parseWeekHeader('Semana de 02 a 06 de novembro 2026'), { start: '2026-11-02', end: '2026-11-06' });
    assert.deepEqual(parseWeekHeader('Semana de 28 de dezembro de 2026 a 01 de janeiro de 2027'), { start: '2026-12-28', end: '2027-01-01' });
    assert.equal(parseWeekHeader('Município de Loures'), null);
  });

  it('builds one day per block, keeps dish text, drops allergens and nutrition, flags holidays', () => {
    const items: TextItem[] = [
      item(770, 244, 'Semana de 05 a 09 de outubro de 2026'),
      item(719, 71, 'Pequeno-Almoço'), item(681, 71, 'Prato Vegetariano'), item(681, 246, 'FERIADO'),
      item(589, 71, 'Pequeno-Almoço'), item(589, 184, '1,8,11'), item(589, 394, '1082 375 20,8'),
      item(585, 131, 'Pão de sementes', 50), item(585, 199, 'com'),
      item(563, 71, 'Prato Geral'), item(560, 131, 'Bolonhesa', 30), item(560, 165, 'de lentilhas'),
      item(550, 62, 'Terça-Feira'), item(550, 71, 'Vegetais'), item(546, 131, 'Saladinha e brócol', 60), item(546, 191, 'os', 4),
      item(40, 40, 'A sua refeição contém ou pode conter as seguintes substâncias'),
    ];
    const menu = parseSchoolMenu(items);
    assert.deepEqual(menu.weeks, [{ start: '2026-10-05', end: '2026-10-09' }]);
    assert.equal(menu.days.length, 2);
    assert.deepEqual(menu.days[0], { date: '2026-10-05', holiday: true, meals: {} });
    assert.deepEqual(menu.days[1], { date: '2026-10-06', holiday: false, meals: { breakfast: 'Pão de sementes com', main: 'Bolonhesa de lentilhas', vegetables: 'Saladinha e brócolos' } });
  });

  const fixture = '.local/ementa-loures-2026-10.pdf';
  it('parses the real Loures menu PDF when it is available locally', { skip: !existsSync(fixture) }, () => {
    const menu = parseSchoolMenu(extractPdfText(new Uint8Array(readFileSync(fixture))));
    assert.equal(menu.weeks.length, 4);
    assert.equal(menu.days.length, 20);
    assert.equal(menu.days.filter((day) => day.holiday).map((day) => day.date).join(), '2026-10-05');
    const day = menu.days.find((entry) => entry.date === '2026-10-21')!;
    assert.equal(day.meals.soup, 'Caldo-verde');
    assert.equal(day.meals.go2go, 'Bifana no pão');
    assert.match(menu.days.find((entry) => entry.date === '2026-10-16')!.meals.vegetarian!, /brócolos$/);
    assert.ok(menu.days.filter((entry) => !entry.holiday).every((entry) => Object.keys(entry.meals).length >= 7));
  });
});

describe('lunch repository', () => {
  it('migrates to v7, saves, replaces by date and lists a range', async () => {
    const { db } = openTestDatabase();
    await migrate(db);
    const days = [
      { date: '2026-10-05', holiday: true, meals: {} },
      { date: '2026-10-06', holiday: false, meals: { soup: 'Sopa A', main: 'Prato A' } },
    ];
    assert.equal(await saveLunchMenu(db, days, 'ementa.pdf', 1), 2);
    await saveLunchMenu(db, [{ date: '2026-10-06', holiday: false, meals: { soup: 'Sopa B' } }], 'nova.pdf', 2);
    const listed = await listLunchDays(db, '2026-10-01', '2026-10-31');
    assert.deepEqual(listed, [
      { date: '2026-10-05', holiday: true, meals: {}, sourceName: 'ementa.pdf', choice: null },
      { date: '2026-10-06', holiday: false, meals: { soup: 'Sopa B' }, sourceName: 'nova.pdf', choice: null },
    ]);
    await deleteLunchDays(db, '2026-10-05', '2026-10-05');
    assert.equal((await listLunchDays(db, '2026-10-01', '2026-10-31')).length, 1);
    await assert.rejects(saveLunchMenu(db, [], null));
  });

  it('keeps the chosen dish across a re-import and clears it on request', async () => {
    const { db } = openTestDatabase();
    await migrate(db);
    await saveLunchMenu(db, [{ date: '2026-11-09', holiday: false, meals: { main: 'Empadão', vegetarian: 'Soja' } }], 'novembro.pdf', 1);
    await setLunchChoice(db, '2026-11-09', 'vegetarian', 2);
    await saveLunchMenu(db, [{ date: '2026-11-09', holiday: false, meals: { main: 'Peixe', vegetarian: 'Soja' } }], 'novembro-v2.pdf', 3);
    assert.equal((await listLunchDays(db, '2026-11-09', '2026-11-09'))[0]!.choice, 'vegetarian');
    await setLunchChoice(db, '2026-11-09', null);
    assert.equal((await listLunchDays(db, '2026-11-09', '2026-11-09'))[0]!.choice, null);
    await assert.rejects(setLunchChoice(db, '2026-11-09', 'dessert' as never));
  });
});
