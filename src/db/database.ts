import type { SQLiteDatabase } from 'expo-sqlite';
import { migrate } from './migrations';

export async function initializeDatabase(db: SQLiteDatabase) {
  // Connection settings must be applied outside the migration transaction.
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA temp_store = MEMORY; PRAGMA cache_size = -4000;');
  await migrate(db);
}

export async function maintainDatabase(db: SQLiteDatabase) {
  // A passive checkpoint flushes WAL pages opportunistically without blocking readers.
  await db.execAsync('PRAGMA wal_checkpoint(PASSIVE);');
}
