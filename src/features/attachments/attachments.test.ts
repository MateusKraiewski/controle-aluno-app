import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { DatabaseSync } from 'node:sqlite';
import { migrate } from '../../db/migrations';
import { openTestDatabase } from '../../testing/nodeSqlite';
import { deleteAllData, exportBackup, restoreBackup } from '../backup/repository';
import { serializeBackup, validateBackup } from '../backup/format';
import { generateOccurrences } from '../lessons/domain';
import { changeSeriesEnd, createLesson, createLessonSeries, deleteLessons, listSeriesEditTargets } from '../lessons/repository';
import {
  MAX_ATTACHMENTS_PER_LESSON, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_NAME, checkAttachment, detectMime, findOrphans, formatBytes,
  isStoredFileName, newStoredFileName, sanitizeFileName,
} from './domain';
import {
  addAttachment, clearTrash, countAttachments, countAttachmentsAffectedByDelete, deleteAttachment, findReferencedFileNames, forgetTrash,
  getAttachment, listAttachments, listTrash,
} from './repository';

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => Uint8Array.from(Buffer.from(text, 'utf8'));

describe('attachment type from magic bytes', () => {
  it('recognises PDF, PNG, JPEG and WebP signatures regardless of any name', () => {
    assert.equal(detectMime(ascii('%PDF-1.7\n%âãÏÓ'), false), 'application/pdf');
    assert.equal(detectMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13), false), 'image/png');
    assert.equal(detectMime(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10), false), 'image/jpeg');
    assert.equal(detectMime(Uint8Array.from([...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBPVP8 ')]), false), 'image/webp');
  });

  it('accepts UTF-8 text (with or without BOM) and rejects binary or other formats', () => {
    assert.equal(detectMime(ascii('Resumo:\n- Ótica\tlentes\r\n'), true), 'text/plain');
    assert.equal(detectMime(Uint8Array.from([0xef, 0xbb, 0xbf, ...ascii('olá')]), true), 'text/plain');
    assert.equal(detectMime(bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0), false), null); // ZIP/DOCX
    assert.equal(detectMime(bytes(0x4d, 0x5a, 0x90, 0), false), null); // executable
    assert.equal(detectMime(ascii('texto\u0000com NUL'), true), null);
    assert.equal(detectMime(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00), false), null); // GIF89a + control byte
    assert.equal(detectMime(Uint8Array.from([...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WAVE')]), false), null); // RIFF but not WebP
    assert.equal(detectMime(bytes(0xc3, 0x28), true), null); // invalid continuation
    assert.equal(detectMime(bytes(0xed, 0xa0, 0x80), true), null); // UTF-16 surrogate
    assert.equal(detectMime(bytes(0xc0, 0xaf), true), null); // overlong
    assert.equal(detectMime(new Uint8Array(0), true), null);
    assert.equal(detectMime(Uint8Array.from([0xef, 0xbb, 0xbf]), true), null); // BOM only
  });

  it('accepts a multi-byte character cut by the sample only when the file continues', () => {
    const cut = Uint8Array.from([...ascii('abc'), 0xc3]);
    assert.equal(detectMime(cut, false), 'text/plain');
    assert.equal(detectMime(cut, true), null);
  });

  it('checks size limits before the type', () => {
    const pdf = ascii('%PDF-1.4');
    assert.deepEqual(checkAttachment(MAX_ATTACHMENT_BYTES, pdf), { ok: true, value: 'application/pdf' });
    assert.deepEqual(checkAttachment(MAX_ATTACHMENT_BYTES + 1, pdf), { ok: false, error: 'tooLarge' });
    assert.deepEqual(checkAttachment(0, pdf), { ok: false, error: 'empty' });
    assert.deepEqual(checkAttachment(Number.NaN, pdf), { ok: false, error: 'empty' });
    assert.deepEqual(checkAttachment(10, bytes(0x4d, 0x5a, 0x90, 0x00)), { ok: false, error: 'unsupportedType' });
  });
});

describe('attachment name sanitising', () => {
  it('keeps a clean name and its matching extension', () => {
    assert.equal(sanitizeFileName('Lista de exercícios.pdf', 'application/pdf'), 'Lista de exercícios.pdf');
    assert.equal(sanitizeFileName('foto.JPEG', 'image/jpeg'), 'foto.jpeg');
    assert.equal(sanitizeFileName('notas.md', 'text/plain'), 'notas.md');
  });

  it('drops paths, control/bidi characters and reserved characters', () => {
    assert.equal(sanitizeFileName('../../etc/passwd', 'text/plain'), 'passwd.txt');
    assert.equal(sanitizeFileName('C:\\Users\\ana\\resumo.txt', 'text/plain'), 'resumo.txt');
    assert.equal(sanitizeFileName('a\u0000b\nc\u202Etxt.pdf', 'application/pdf'), 'abctxt.pdf');
    assert.equal(sanitizeFileName('que? <isto>: "a|b*".png', 'image/png'), 'que_ _isto__ _a_b__.png');
    assert.equal(sanitizeFileName('  ..  espaços   a   mais  .. ', 'text/plain'), 'espaços a mais.txt');
  });

  it('fixes an extension that does not match the detected content', () => {
    assert.equal(sanitizeFileName('documento.docx', 'application/pdf'), 'documento.docx.pdf');
    assert.equal(sanitizeFileName('imagem.png', 'image/jpeg'), 'imagem.png.jpg');
    assert.equal(sanitizeFileName('sem extensão', 'image/webp'), 'sem extensão.webp');
  });

  it('falls back for empty or reserved names and limits the length in characters', () => {
    assert.equal(sanitizeFileName('', 'application/pdf'), 'anexo.pdf');
    assert.equal(sanitizeFileName('...', 'application/pdf', 'file'), 'file.pdf');
    assert.equal(sanitizeFileName('.pdf', 'application/pdf'), 'pdf.pdf');
    assert.equal(sanitizeFileName('CON.txt', 'text/plain'), '_CON.txt');
    const long = sanitizeFileName(`${'é'.repeat(300)}.pdf`, 'application/pdf');
    assert.equal(Array.from(long).length, MAX_ATTACHMENT_NAME);
    assert.ok(long.endsWith('.pdf'));
    const emoji = sanitizeFileName(`${'📘'.repeat(200)}.txt`, 'text/plain');
    assert.equal(Array.from(emoji).length, MAX_ATTACHMENT_NAME);
    assert.ok(!/[\ud800-\udbff]\./.test(emoji)); // never splits a surrogate pair
  });
});

describe('stored file names', () => {
  it('generates UUID v4 names with the canonical extension', () => {
    const name = newStoredFileName('image/jpeg', () => new Uint8Array(16).fill(0xff));
    assert.equal(name, 'ffffffff-ffff-4fff-bfff-ffffffffffff.jpg');
    assert.ok(isStoredFileName(name));
    assert.ok(isStoredFileName(newStoredFileName('application/pdf')));
    assert.notEqual(newStoredFileName('text/plain'), newStoredFileName('text/plain'));
  });

  it('rejects anything the app did not generate', () => {
    for (const name of ['../x.pdf', 'lista.pdf', 'ffffffff-ffff-4fff-bfff-ffffffffffff.exe', 'FFFFFFFF-FFFF-4FFF-BFFF-FFFFFFFFFFFF.pdf', 'ffffffff-ffff-4fff-bfff-ffffffffffff.pdf/..', null]) {
      assert.equal(isStoredFileName(name), false, String(name));
    }
  });

  it('lists only unreferenced app files as orphans', () => {
    const a = newStoredFileName('application/pdf');
    const b = newStoredFileName('image/png');
    assert.deepEqual(findOrphans([a, b, 'notas.txt', '.DS_Store'], new Set([a])), [b]);
  });

  it('formats sizes', () => {
    assert.equal(formatBytes(820, 'pt-BR'), '820 B');
    assert.equal(formatBytes(34 * 1024, 'en'), '34 KB');
    assert.match(formatBytes(1.25 * 1024 * 1024, 'pt-BR'), /^1[,.]3 MB$/);
  });
});

describe('attachment repository', () => {
  let db: SQLiteDatabase;
  let raw: DatabaseSync;
  const lesson = { subject: 'Física', teacher: null, startMinute: 600, durationMinutes: 50, plannedContent: null };
  const file = (mime: 'application/pdf' | 'image/png' = 'application/pdf') => newStoredFileName(mime);
  const add = (lessonId: number, fileName = file(), extra: Partial<{ sizeBytes: number; displayName: string }> = {}) =>
    addAttachment(db, { lessonId, fileName, displayName: extra.displayName ?? 'lista.pdf', mimeType: 'application/pdf', sizeBytes: extra.sizeBytes ?? 1000 }, 42);
  const trash = () => raw.prepare('SELECT file_name FROM attachment_trash ORDER BY file_name').all().map((row) => row.file_name as string);

  beforeEach(async () => {
    ({ db, raw } = openTestDatabase());
    await migrate(db);
  });

  it('stores only metadata and lists a lesson\'s attachments in order', async () => {
    const id = await createLesson(db, { ...lesson, localDate: '2026-10-20' });
    const name = file();
    const added = await add(id, name, { displayName: 'Lista 1.pdf' });
    assert.ok(added.ok);
    const [row] = await listAttachments(db, id);
    assert.deepEqual(row, { id: added.value, lessonId: id, fileName: name, displayName: 'Lista 1.pdf', mimeType: 'application/pdf', sizeBytes: 1000, createdAt: 42 });
    assert.deepEqual(await getAttachment(db, added.value), row);
    const columns = raw.prepare('PRAGMA table_info(lesson_attachments)').all().map((column) => column.type);
    assert.ok(!columns.includes('BLOB'));
    assert.deepEqual(await countAttachments(db), { count: 1, bytes: 1000 });
  });

  it('enforces 10 per lesson, an existing lesson and valid metadata without writing', async () => {
    const id = await createLesson(db, { ...lesson, localDate: '2026-10-20' });
    for (let index = 0; index < MAX_ATTACHMENTS_PER_LESSON; index += 1) assert.ok((await add(id)).ok);
    assert.deepEqual(await add(id), { ok: false, error: 'tooMany' });
    assert.deepEqual(await add(999), { ok: false, error: 'lessonNotFound' });
    const other = await createLesson(db, { ...lesson, localDate: '2026-10-21' });
    assert.deepEqual(await add(other, '../../evil.pdf'), { ok: false, error: 'invalid' });
    assert.deepEqual(await add(other, file(), { sizeBytes: MAX_ATTACHMENT_BYTES + 1 }), { ok: false, error: 'invalid' });
    assert.deepEqual(await add(other, file(), { sizeBytes: 0 }), { ok: false, error: 'invalid' });
    assert.deepEqual(await add(other, file(), { displayName: 'x'.repeat(MAX_ATTACHMENT_NAME + 1) }), { ok: false, error: 'invalid' });
    assert.equal((await add(other, file(), { sizeBytes: MAX_ATTACHMENT_BYTES })).ok, true);
    assert.equal((await countAttachments(db)).count, MAX_ATTACHMENTS_PER_LESSON + 1);
  });

  it('queues the file for cleanup when an attachment is deleted', async () => {
    const id = await createLesson(db, { ...lesson, localDate: '2026-10-20' });
    const name = file();
    const added = await add(id, name);
    assert.ok(added.ok);
    assert.equal(await deleteAttachment(db, added.value), true);
    assert.equal(await deleteAttachment(db, added.value), false);
    assert.deepEqual(await listAttachments(db, id), []);
    assert.deepEqual(await listTrash(db), [name]);
    await forgetTrash(db, [name]);
    assert.deepEqual(await listTrash(db), []);
  });

  it('cascades from lesson deletes, including "this and following" of a series', async () => {
    const plan = generateOccurrences({ startDate: '2026-11-02', endDate: '2026-11-23', weekdays: [1], frequency: 'weekly' });
    assert.ok(plan.ok);
    await createLessonSeries(db, { ...lesson, localDate: '2026-11-02', frequency: 'weekly', weekdays: [1], endDate: '2026-11-23', dates: plan.value.dates });
    const ids = raw.prepare('SELECT id FROM lessons ORDER BY local_date').all().map((row) => row.id as number);
    const names = [file(), file(), file(), file()];
    for (const [index, lessonId] of ids.entries()) assert.ok((await add(lessonId, names[index])).ok);
    assert.equal(await countAttachmentsAffectedByDelete(db, ids[2]), 2); // the 3rd and 4th occurrence
    await deleteLessons(db, ids[0], 'this');
    assert.deepEqual(trash(), [names[0]]);
    await deleteLessons(db, ids[2], 'following');
    assert.deepEqual(trash(), [names[0], names[2], names[3]].sort());
    assert.deepEqual((await listAttachments(db, ids[1])).map((row) => row.fileName), [names[1]]);
  });

  it('treats a future occurrence with attachments as recorded (series edits and shortening skip it)', async () => {
    const plan = generateOccurrences({ startDate: '2026-11-02', endDate: '2026-11-23', weekdays: [1], frequency: 'weekly' });
    assert.ok(plan.ok);
    const { seriesId } = await createLessonSeries(db, { ...lesson, localDate: '2026-11-02', frequency: 'weekly', weekdays: [1], endDate: '2026-11-23', dates: plan.value.dates });
    const ids = raw.prepare('SELECT id FROM lessons ORDER BY local_date').all().map((row) => row.id as number);
    assert.ok((await add(ids[3])).ok);
    const now = { localDate: '2026-10-21', minute: 0 };
    assert.deepEqual((await listSeriesEditTargets(db, seriesId, ids[0], now)).map((row) => row.id), [ids[1], ids[2]]);
    const shortened = await changeSeriesEnd(db, seriesId, '2026-11-02', { now });
    assert.ok(shortened.ok);
    assert.equal(shortened.value.removed, 2);
    assert.deepEqual(raw.prepare('SELECT id FROM lessons ORDER BY id').all().map((row) => row.id), [ids[0], ids[3]]);
    assert.deepEqual(trash(), []);
  });

  it('queues every file on delete-all and restore, which replace all lessons', async () => {
    const id = await createLesson(db, { ...lesson, localDate: '2026-10-20' });
    const first = file();
    assert.ok((await add(id, first)).ok);
    const backup = validateBackup(serializeBackup(await exportBackup(db)));
    assert.ok(backup.ok);
    // The backup carries no attachment data at all.
    assert.ok(!serializeBackup(await exportBackup(db)).includes(first));
    await restoreBackup(db, backup.value);
    assert.deepEqual(trash(), [first]);
    assert.equal((await countAttachments(db)).count, 0);
    await clearTrash(db);

    const second = file('image/png');
    assert.ok((await add(raw.prepare('SELECT id FROM lessons').get()?.id as number, second)).ok);
    await deleteAllData(db);
    assert.deepEqual(trash(), [second]);
    assert.equal((await countAttachments(db)).count, 0);
  });

  it('finds which stored names are still referenced, in batches', async () => {
    const id = await createLesson(db, { ...lesson, localDate: '2026-10-20' });
    const kept = file();
    assert.ok((await add(id, kept)).ok);
    const candidates = [kept, ...Array.from({ length: 250 }, () => file())];
    assert.deepEqual([...(await findReferencedFileNames(db, candidates))], [kept]);
    assert.equal(findOrphans(candidates, await findReferencedFileNames(db, candidates)).length, 250);
    assert.deepEqual([...(await findReferencedFileNames(db, []))], []);
  });
});
