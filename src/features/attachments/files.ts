// Platform glue for lesson attachments: picking (expo-document-picker), copying into
// the app's private document directory under UUID names, opening through the system
// share sheet and deleting files after their rows are gone. No network access and no
// bytes in SQLite. Every delete goes through the attachment_trash queue (see the v6
// migration), so a crash can at worst leave a file to be removed on the next start.
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  ATTACHMENT_MIMES, MAX_ATTACHMENT_BYTES, SNIFF_BYTES, checkAttachment, findOrphans, isStoredFileName, newStoredFileName, sanitizeFileName,
} from './domain';
import type { AttachmentCheckError, AttachmentMime } from './domain';
import { addAttachment, clearTrash, findReferencedFileNames, forgetTrash, listTrash } from './repository';
import type { AddAttachmentError, Attachment } from './repository';

/** Private, app-only folder (removed with the app; see docs/offline-first.md for OS backups). */
const ATTACHMENT_FOLDER = 'lesson-attachments';
/** Temporary named copy handed to the share sheet; replaced on each share. */
const SHARE_FOLDER = 'attachment-share';
/** Trash pages processed per cleanup run. */
const MAX_TRASH_PAGES = 20;
/** Files inspected per orphan sweep. */
const MAX_SWEEP_FILES = 2000;

const UTI: Record<AttachmentMime, string> = {
  'application/pdf': 'com.adobe.pdf', 'image/png': 'public.png', 'image/jpeg': 'public.jpeg',
  'image/webp': 'org.webmproject.webp', 'text/plain': 'public.plain-text',
};

function attachmentDirectory(): Directory {
  return new Directory(Paths.document, ATTACHMENT_FOLDER);
}

function shareDirectory(): Directory {
  return new Directory(Paths.cache, SHARE_FOLDER);
}

function storedFile(fileName: string): File | null {
  return isStoredFileName(fileName) ? new File(attachmentDirectory(), fileName) : null;
}

function safeDelete(file: File | Directory): boolean {
  try {
    if (file.exists) file.delete();
    return true;
  } catch {
    return false;
  }
}

/** False when the row's file is missing (OS cleanup, restored database without files, …). */
export function isAttachmentAvailable(attachment: Pick<Attachment, 'fileName'>): boolean {
  try {
    return storedFile(attachment.fileName)?.exists ?? false;
  } catch {
    return false;
  }
}

function readHead(file: File, length: number): Uint8Array {
  if (length <= 0) return new Uint8Array(0);
  const handle = file.open(FileMode.ReadOnly);
  try {
    return handle.readBytesSync(length);
  } finally {
    handle.close();
  }
}

export type AddFromPickerOutcome =
  | { status: 'canceled' }
  | { status: 'added'; id: number }
  | { status: 'error'; error: AttachmentCheckError | AddAttachmentError | 'copyFailed' };

/**
 * Lets the student pick one file, checks size (≤ 5 MB) and content type (magic bytes),
 * copies it into the attachment folder under a new UUID name and records the row.
 * The file is copied before the row exists, so an interrupted add leaves at most an
 * unreferenced file (removed by cleanUpAttachments), never a row without a file.
 */
export async function pickAndAddAttachment(db: SQLiteDatabase, lessonId: number, fallbackName: string): Promise<AddFromPickerOutcome> {
  const picked = await DocumentPicker.getDocumentAsync({ type: [...ATTACHMENT_MIMES], copyToCacheDirectory: true, multiple: false });
  if (picked.canceled || !picked.assets || picked.assets.length === 0) return { status: 'canceled' };
  const asset = picked.assets[0];
  const source = new File(asset.uri);
  let destination: File | null = null;
  try {
    const size = source.exists ? source.size : asset.size ?? 0;
    if (size > MAX_ATTACHMENT_BYTES) return { status: 'error', error: 'tooLarge' };
    const check = checkAttachment(size, readHead(source, Math.min(SNIFF_BYTES, size)));
    if (!check.ok) return { status: 'error', error: check.error };
    const directory = attachmentDirectory();
    directory.create({ intermediates: true, idempotent: true });
    destination = new File(directory, newStoredFileName(check.value));
    await source.copy(destination);
    const copiedSize = destination.size;
    if (copiedSize < 1 || copiedSize > MAX_ATTACHMENT_BYTES) {
      safeDelete(destination);
      return { status: 'error', error: copiedSize < 1 ? 'empty' : 'tooLarge' };
    }
    const result = await addAttachment(db, {
      lessonId, fileName: destination.name, displayName: sanitizeFileName(asset.name, check.value, fallbackName),
      mimeType: check.value, sizeBytes: copiedSize,
    });
    if (!result.ok) {
      safeDelete(destination);
      return { status: 'error', error: result.error };
    }
    return { status: 'added', id: result.value };
  } catch {
    if (destination) safeDelete(destination);
    return { status: 'error', error: 'copyFailed' };
  } finally {
    // The picker's own copy lives in the app cache; it is not needed any more.
    if (source.uri.startsWith(Paths.cache.uri)) safeDelete(source);
  }
}

/** Opens the system share sheet (view in another app, save to Files/Drive, send) with the original name. */
export async function shareAttachment(attachment: Attachment, dialogTitle: string): Promise<'shared' | 'missing' | 'unavailable'> {
  const file = storedFile(attachment.fileName);
  if (!file || !file.exists) return 'missing';
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  clearAttachmentShareFiles();
  const directory = shareDirectory();
  directory.create({ intermediates: true, idempotent: true });
  const copy = new File(directory, attachment.displayName);
  await file.copy(copy);
  await Sharing.shareAsync(copy.uri, { mimeType: attachment.mimeType, UTI: UTI[attachment.mimeType], dialogTitle });
  return 'shared';
}

/** Removes the temporary shared copy from the cache. */
export function clearAttachmentShareFiles(): void {
  safeDelete(shareDirectory());
}

/**
 * Deletes the files queued in attachment_trash and forgets each entry once its file
 * is gone (a file already missing counts as gone). Entries whose delete fails stay
 * queued for the next run. Call after any delete of attachments or lessons.
 */
export async function purgeAttachmentTrash(db: SQLiteDatabase): Promise<number> {
  let removed = 0;
  for (let page = 0; page < MAX_TRASH_PAGES; page += 1) {
    const names = await listTrash(db);
    if (names.length === 0) break;
    const done = names.filter((name) => {
      const file = storedFile(name);
      return file ? safeDelete(file) : true; // never a name the app generated: nothing to delete
    });
    await forgetTrash(db, done);
    removed += done.length;
    if (done.length < names.length) break; // stop on failures; retried on the next start
  }
  return removed;
}

/**
 * Start-up maintenance: purge the trash, then delete files in the attachment folder
 * that no row references (an add interrupted between copy and insert). Runs before
 * the interface is shown, so no add can be in progress. Best effort.
 */
export async function cleanUpAttachments(db: SQLiteDatabase): Promise<void> {
  await purgeAttachmentTrash(db);
  const directory = attachmentDirectory();
  if (!directory.exists) return;
  const names = directory.list().filter((entry): entry is File => entry instanceof File).slice(0, MAX_SWEEP_FILES).map((file) => file.name);
  const orphans = findOrphans(names, await findReferencedFileNames(db, names.filter(isStoredFileName)));
  for (const name of orphans) {
    const file = storedFile(name);
    if (file) safeDelete(file);
  }
}

/** Erase of all data: removes the whole attachment folder, the share copy and the trash. */
export async function removeAllAttachmentFiles(db: SQLiteDatabase): Promise<void> {
  safeDelete(attachmentDirectory());
  clearAttachmentShareFiles();
  if (!attachmentDirectory().exists) await clearTrash(db);
}
