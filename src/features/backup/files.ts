// Platform glue for exports (JSON backup, CSV history): writes the file to the app's
// cache directory and opens the system share sheet; reads a picked file for restore.
// No network access.
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { MAX_BACKUP_CHARS } from './format';

const EXPORT_DIRECTORY = 'backup-export';

function exportDirectory(): Directory {
  return new Directory(Paths.cache, EXPORT_DIRECTORY);
}

/** Removes previous export files (they contain personal data) from the app cache. */
export function clearExportFiles(): void {
  const directory = exportDirectory();
  if (directory.exists) directory.delete();
}

type ShareKind = { mimeType: string; UTI: string };
const JSON_FILE: ShareKind = { mimeType: 'application/json', UTI: 'public.json' };
const CSV_FILE: ShareKind = { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' };

/**
 * Writes the text to a fresh cache file and opens the share sheet. Only the latest
 * export is kept: the file stays in the private cache until the next export or erase
 * (receiving apps may read it after the sheet closes), and the OS may clear it earlier.
 */
async function shareExportFile(content: string, fileName: string, kind: ShareKind, dialogTitle: string): Promise<'shared' | 'unavailable'> {
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  clearExportFiles();
  const directory = exportDirectory();
  directory.create({ intermediates: true, idempotent: true });
  const file = new File(directory, fileName);
  file.create({ overwrite: true });
  await file.write(content);
  await Sharing.shareAsync(file.uri, { ...kind, dialogTitle });
  return 'shared';
}

export function shareBackupFile(json: string, fileName: string, dialogTitle: string): Promise<'shared' | 'unavailable'> {
  return shareExportFile(json, fileName, JSON_FILE, dialogTitle);
}

export function shareCsvFile(csv: string, fileName: string, dialogTitle: string): Promise<'shared' | 'unavailable'> {
  return shareExportFile(csv, fileName, CSV_FILE, dialogTitle);
}

export class BackupFileTooLargeError extends Error {
  constructor() {
    super('Backup file is too large');
    this.name = 'BackupFileTooLargeError';
  }
}

/** Opens the system file picker and returns the file text, or null when cancelled. */
export async function pickBackupText(): Promise<string | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['application/json', 'text/plain', 'application/octet-stream'] });
  if (picked.canceled) return null;
  const file = picked.result;
  // UTF-8 bytes >= UTF-16 code units, so this bound never rejects a valid backup.
  if ((file.size ?? 0) > MAX_BACKUP_CHARS * 3) throw new BackupFileTooLargeError();
  return file.text();
}
