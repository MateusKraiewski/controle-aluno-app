import type { MenuDay, MealKey } from './menu-parser';

/** Minimal database surface (expo-sqlite in the app, Node's SQLite in tests). */
export type LunchDatabase = {
  runAsync(source: string, ...params: (string | number | null)[]): Promise<unknown>;
  getAllAsync<T>(source: string, ...params: (string | number | null)[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
};

/** Dishes the student can pick between for lunch. */
export const LUNCH_CHOICES = ['main', 'vegetarian', 'go2go'] as const;
export type LunchChoice = (typeof LUNCH_CHOICES)[number];

export type StoredLunchDay = { date: string; holiday: boolean; meals: Partial<Record<MealKey, string>>; sourceName: string | null; choice: LunchChoice | null };
type Row = { local_date: string; holiday: number; meals: string; source_name: string | null; choice: string | null };

const asChoice = (value: string | null): LunchChoice | null => (LUNCH_CHOICES as readonly string[]).includes(value ?? '') ? value as LunchChoice : null;

const MAX_DAYS_PER_IMPORT = 400;

function parseMeals(json: string): Partial<Record<MealKey, string>> {
  try {
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== 'object') return {};
    return Object.fromEntries(Object.entries(value).filter(([, text]) => typeof text === 'string')) as Partial<Record<MealKey, string>>;
  } catch { return {}; }
}

/** Saves an imported menu in one transaction; dates already present are replaced by the newer file. */
export async function saveLunchMenu(db: LunchDatabase, days: MenuDay[], sourceName: string | null, now = Date.now()) {
  if (days.length === 0 || days.length > MAX_DAYS_PER_IMPORT) throw new Error('invalid_menu_size');
  await db.withTransactionAsync(async () => {
    for (const day of days) {
      await db.runAsync(
        'INSERT INTO lunch_days (local_date, holiday, meals, source_name, imported_at) VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT(local_date) DO UPDATE SET holiday = excluded.holiday, meals = excluded.meals, source_name = excluded.source_name, imported_at = excluded.imported_at',
        day.date, day.holiday ? 1 : 0, JSON.stringify(day.meals), sourceName ? sourceName.slice(0, 120) : null, now);
    }
  });
  return days.length;
}

/** Days with a menu between two dates (inclusive); bounded to a few months at a time. */
export async function listLunchDays(db: LunchDatabase, from: string, to: string): Promise<StoredLunchDay[]> {
  const rows = await db.getAllAsync<Row>(
    'SELECT d.local_date, d.holiday, d.meals, d.source_name, c.choice FROM lunch_days d LEFT JOIN lunch_choices c ON c.local_date = d.local_date ' +
    'WHERE d.local_date >= ? AND d.local_date <= ? ORDER BY d.local_date LIMIT 200', from, to);
  return rows.map((row) => ({ date: row.local_date, holiday: row.holiday === 1, meals: parseMeals(row.meals), sourceName: row.source_name, choice: asChoice(row.choice) }));
}

export async function deleteLunchDays(db: LunchDatabase, from: string, to: string) {
  await db.runAsync('DELETE FROM lunch_days WHERE local_date >= ? AND local_date <= ?', from, to);
}

/** Records which dish the student picked for a day; null clears the choice. */
export async function setLunchChoice(db: LunchDatabase, date: string, choice: LunchChoice | null, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid_date');
  if (choice === null) {
    await db.runAsync('DELETE FROM lunch_choices WHERE local_date = ?', date);
    return;
  }
  if (!asChoice(choice)) throw new Error('invalid_choice');
  await db.runAsync(
    'INSERT INTO lunch_choices (local_date, choice, chosen_at) VALUES (?, ?, ?) ON CONFLICT(local_date) DO UPDATE SET choice = excluded.choice, chosen_at = excluded.chosen_at',
    date, choice, now);
}
