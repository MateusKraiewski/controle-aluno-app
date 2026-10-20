// Test-only adapter: exposes the subset of expo-sqlite's async API used by the
// repositories on top of Node's built-in SQLite, so the real SQL runs in `npm test`.
// Never imported by the app bundle.
import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

type Params = unknown[];
type SqlValue = null | number | bigint | string | Uint8Array;

function normalize(params: Params): SqlValue[] | [Record<string, SqlValue>] {
  if (params.length === 1 && params[0] !== null && typeof params[0] === 'object' && !Array.isArray(params[0])) {
    return [params[0] as Record<string, SqlValue>];
  }
  const flat = params.length === 1 && Array.isArray(params[0]) ? (params[0] as Params) : params;
  return flat as SqlValue[];
}

export function openTestDatabase(): { db: SQLiteDatabase; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  const adapter = {
    async execAsync(source: string) { raw.exec(source); },
    async getFirstAsync(source: string, ...params: Params) {
      return (raw.prepare(source).get(...(normalize(params) as SqlValue[])) as unknown) ?? null;
    },
    async getAllAsync(source: string, ...params: Params) {
      return raw.prepare(source).all(...(normalize(params) as SqlValue[]));
    },
    async runAsync(source: string, ...params: Params) {
      const result = raw.prepare(source).run(...(normalize(params) as SqlValue[]));
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    async withTransactionAsync(task: () => Promise<void>) {
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
    async prepareAsync(source: string) {
      const statement = raw.prepare(source);
      return {
        async executeAsync(...params: Params) {
          const result = statement.run(...(normalize(params) as SqlValue[]));
          return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
        },
        async finalizeAsync() { /* statements are released with the database */ },
      };
    },
  };
  return { db: adapter as unknown as SQLiteDatabase, raw };
}
