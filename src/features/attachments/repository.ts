// Attachment metadata in SQLite (the bytes are files; see files.ts). Static SQL with
// bound parameters only. Deleting a row, directly or through the lesson's
// ON DELETE CASCADE, queues its file in attachment_trash via a trigger (schema v6).
import type { SQLiteDatabase } from 'expo-sqlite';
import type { Result } from '../lessons/domain';
import { MAX_ATTACHMENTS_PER_LESSON, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_NAME, isAttachmentMime, isStoredFileName } from './domain';
import type { AttachmentMime } from './domain';

export type Attachment = {
  id: number;
  lessonId: number;
  /** Stored UUID file name inside the app's attachment folder. */
  fileName: string;
  /** Sanitised name shown to the student and used when sharing. */
  displayName: string;
  mimeType: AttachmentMime;
  sizeBytes: number;
  createdAt: number;
};

export type NewAttachment = { lessonId: number; fileName: string; displayName: string; mimeType: AttachmentMime; sizeBytes: number };
export type AddAttachmentError = 'lessonNotFound' | 'tooMany' | 'invalid';

type AttachmentRow = {
  id: number; lesson_id: number; file_name: string; display_name: string; mime_type: string; size_bytes: number; created_at: number;
};

const TRASH_PAGE = 100;
/** SQLite bound-parameter batches for reference checks. */
const LOOKUP_BATCH = 100;

function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id, lessonId: row.lesson_id, fileName: row.file_name, displayName: row.display_name,
    mimeType: isAttachmentMime(row.mime_type) ? row.mime_type : 'text/plain', sizeBytes: row.size_bytes, createdAt: row.created_at,
  };
}

/** A lesson's attachments, oldest first (at most the per-lesson limit). */
export async function listAttachments(db: SQLiteDatabase, lessonId: number): Promise<Attachment[]> {
  const rows = await db.getAllAsync<AttachmentRow>(`
    SELECT id, lesson_id, file_name, display_name, mime_type, size_bytes, created_at
    FROM lesson_attachments WHERE lesson_id = ? ORDER BY id LIMIT ?`, lessonId, MAX_ATTACHMENTS_PER_LESSON);
  return rows.map(toAttachment);
}

export async function getAttachment(db: SQLiteDatabase, id: number): Promise<Attachment | null> {
  const row = await db.getFirstAsync<AttachmentRow>(`
    SELECT id, lesson_id, file_name, display_name, mime_type, size_bytes, created_at
    FROM lesson_attachments WHERE id = ?`, id);
  return row ? toAttachment(row) : null;
}

/**
 * Records an attachment whose file is already in place. The lesson must exist and
 * have fewer than 10 attachments; checked and inserted in one transaction. On an
 * error nothing is written and the caller removes the copied file.
 */
export async function addAttachment(db: SQLiteDatabase, input: NewAttachment, now = Date.now()): Promise<Result<number, AddAttachmentError>> {
  if (!isStoredFileName(input.fileName) || !isAttachmentMime(input.mimeType) || !Number.isSafeInteger(input.sizeBytes)
    || input.sizeBytes < 1 || input.sizeBytes > MAX_ATTACHMENT_BYTES
    || !input.displayName || Array.from(input.displayName).length > MAX_ATTACHMENT_NAME) {
    return { ok: false, error: 'invalid' };
  }
  let outcome: Result<number, AddAttachmentError> = { ok: false, error: 'lessonNotFound' };
  await db.withTransactionAsync(async () => {
    const lesson = await db.getFirstAsync<{ total: number }>(
      'SELECT (SELECT COUNT(*) FROM lesson_attachments WHERE lesson_id = l.id) AS total FROM lessons l WHERE l.id = ?', input.lessonId);
    if (!lesson) { outcome = { ok: false, error: 'lessonNotFound' }; return; }
    if (lesson.total >= MAX_ATTACHMENTS_PER_LESSON) { outcome = { ok: false, error: 'tooMany' }; return; }
    const result = await db.runAsync(
      'INSERT INTO lesson_attachments (lesson_id, file_name, display_name, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      input.lessonId, input.fileName, input.displayName, input.mimeType, input.sizeBytes, now);
    outcome = { ok: true, value: result.lastInsertRowId };
  });
  return outcome;
}

/** Removes the row; the trigger queues its file for deletion in the same statement. */
export async function deleteAttachment(db: SQLiteDatabase, id: number): Promise<boolean> {
  const result = await db.runAsync('DELETE FROM lesson_attachments WHERE id = ?', id);
  return result.changes > 0;
}

export async function countAttachments(db: SQLiteDatabase): Promise<{ count: number; bytes: number }> {
  const row = await db.getFirstAsync<{ count: number; bytes: number | null }>(
    'SELECT COUNT(*) AS count, SUM(size_bytes) AS bytes FROM lesson_attachments');
  return { count: row?.count ?? 0, bytes: row?.bytes ?? 0 };
}

/**
 * Attachments a delete of this lesson could remove: its own, plus those of later
 * occurrences of its series (the widest "this and following" scope). For warnings.
 */
export async function countAttachmentsAffectedByDelete(db: SQLiteDatabase, lessonId: number): Promise<number> {
  const row = await db.getFirstAsync<{ total: number }>(`
    SELECT COUNT(*) AS total FROM lesson_attachments a JOIN lessons l ON l.id = a.lesson_id
    WHERE l.id = $id OR (l.series_id IS NOT NULL AND l.series_id = (SELECT series_id FROM lessons WHERE id = $id)
      AND l.local_date >= (SELECT local_date FROM lessons WHERE id = $id))`, { $id: lessonId });
  return row?.total ?? 0;
}

/** File names waiting for deletion after their rows were removed (one page). */
export async function listTrash(db: SQLiteDatabase, limit = TRASH_PAGE): Promise<string[]> {
  const rows = await db.getAllAsync<{ file_name: string }>(
    'SELECT file_name FROM attachment_trash ORDER BY queued_at, file_name LIMIT ?', Math.max(1, Math.min(limit, TRASH_PAGE)));
  return rows.map((row) => row.file_name);
}

/** Forgets trash entries whose files are gone. */
export async function forgetTrash(db: SQLiteDatabase, fileNames: readonly string[]): Promise<void> {
  if (fileNames.length === 0) return;
  await db.withTransactionAsync(async () => {
    for (const name of fileNames) await db.runAsync('DELETE FROM attachment_trash WHERE file_name = ?', name);
  });
}

/** Clears the whole trash (after the attachment folder itself was removed). */
export async function clearTrash(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('DELETE FROM attachment_trash');
}

/** Which of these stored names still have a row (orphan sweep). Batches of 100 bound parameters. */
export async function findReferencedFileNames(db: SQLiteDatabase, fileNames: readonly string[]): Promise<Set<string>> {
  const referenced = new Set<string>();
  for (let start = 0; start < fileNames.length; start += LOOKUP_BATCH) {
    const batch = fileNames.slice(start, start + LOOKUP_BATCH);
    // Only the number of placeholders is generated; every value is bound.
    const placeholders = batch.map(() => '?').join(', ');
    const rows = await db.getAllAsync<{ file_name: string }>(
      `SELECT file_name FROM lesson_attachments WHERE file_name IN (${placeholders})`, ...batch);
    for (const row of rows) referenced.add(row.file_name);
  }
  return referenced;
}
