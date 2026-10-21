import type { SQLiteDatabase } from 'expo-sqlite';
import { cleanUpAttachments } from '../features/attachments/files';
import { migrate } from './migrations';

export async function initializeDatabase(db: SQLiteDatabase) {
  // Connection settings must be applied outside the migration transaction.
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA temp_store = MEMORY; PRAGMA cache_size = -4000;');
  await migrate(db);
  // Finishes attachment file deletions interrupted by a crash and removes files left by
  // an interrupted add. Runs before the interface renders; a failure never blocks the app.
  try {
    await cleanUpAttachments(db);
  } catch {
    // retried on the next start
  }
}

export async function maintainDatabase(db: SQLiteDatabase) {
  // A passive checkpoint flushes WAL pages opportunistically without blocking readers.
  await db.execAsync('PRAGMA wal_checkpoint(PASSIVE);');
}
