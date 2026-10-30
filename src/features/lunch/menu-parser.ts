import { toLines, type TextItem } from './pdf-text';

export type MealKey = 'breakfast' | 'soup' | 'main' | 'vegetarian' | 'go2go' | 'vegetables' | 'dessert' | 'snack';
export type MenuDay = { date: string; holiday: boolean; meals: Partial<Record<MealKey, string>> };
export type ParsedMenu = { weeks: { start: string; end: string }[]; days: MenuDay[] };

export const MEAL_ORDER: MealKey[] = ['breakfast', 'soup', 'main', 'vegetarian', 'go2go', 'vegetables', 'dessert', 'snack'];

const categories: [RegExp, MealKey][] = [
  [/^pequeno-almo[cç]o$/i, 'breakfast'], [/^sopa$/i, 'soup'], [/^prato geral$/i, 'main'],
  [/^prato vegetariano$/i, 'vegetarian'], [/^prato\s*go\s*2\s*go\s*\*?$/i, 'go2go'], [/^vegetais$/i, 'vegetables'],
  [/^sobremesa$/i, 'dessert'], [/^lanche$/i, 'snack'],
];
const months: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, março: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

// Column limits in PDF units, from the Loures/Uniself layout: labels on the left, nutrition table on the right.
const DISH_MIN_X = 120;
const NUMBERS_MIN_X = 388;
const SAME_ROW = 8;

const iso = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** "Semana de 05 a 09 de outubro de 2026", "Semana 12 a 16 de outubro de 2026", "28 de setembro a 2 de outubro de 2026". */
export function parseWeekHeader(text: string) {
  const match = /(\d{1,2})(?:\s+de\s+([a-zçã]+))?\s+a\s+(\d{1,2})\s+de\s+([a-zçã]+)\s+de\s+(\d{4})/i.exec(text);
  if (!match) return null;
  const endMonth = months[match[4]!.toLowerCase()];
  const startMonth = match[2] ? months[match[2].toLowerCase()] : endMonth;
  if (!endMonth || !startMonth) return null;
  const year = Number(match[5]);
  const startYear = startMonth > endMonth ? year - 1 : year;
  return { start: iso(startYear, startMonth, Number(match[1])), end: iso(year, endMonth, Number(match[3])) };
}

const categoryOf = (text: string) => categories.find(([pattern]) => pattern.test(text.replace(/\s+/g, ' ').trim()))?.[1] ?? null;
// Allergen superscripts are separate runs made only of digits and commas.
const isAllergen = (text: string) => /^\d[\d,\s]*$/.test(text);

// Below this gap (in PDF units) two runs are one word split in two, as in "brócol" + "os".
const WORD_GAP = 0.8;

/** Joins runs as drawn: a visible gap between runs (often where an allergen superscript sat) becomes a space. */
function joinDish(parts: TextItem[]) {
  let text = '';
  let previous: TextItem | null = null;
  for (const part of parts) {
    if (isAllergen(part.text)) continue;
    const gap = previous !== null && part.x - (previous.x + previous.width) > WORD_GAP;
    text += gap && !/\s$/.test(text) && !/^\s/.test(part.text) ? ` ${part.text}` : part.text;
    previous = part;
  }
  return text;
}

function tidy(text: string) {
  return text.replace(/\s+/g, ' ').replace(/\s+([,.)])/g, '$1').replace(/\(\s+/g, '(').trim();
}

/**
 * Turns the text of a school menu PDF (one week per page, Monday to Friday, eight meals a day)
 * into one entry per date. Nutrition values and allergen numbers are dropped; holidays are flagged.
 */
export function parseSchoolMenu(items: TextItem[]): ParsedMenu {
  const weeks: ParsedMenu['weeks'] = [];
  const days: MenuDay[] = [];
  const lines = toLines(items);
  for (const page of [...new Set(lines.map((line) => line.page))]) {
    const pageLines = lines.filter((line) => line.page === page);
    const header = pageLines.map((line) => line.parts.map((part) => part.text).join(' ')).map(parseWeekHeader).find(Boolean);
    if (!header) continue;
    weeks.push(header);
    let dayIndex = -1;
    let current: MenuDay | null = null;
    let lastMeal: { key: MealKey; y: number } | null = null;
    for (const line of pageLines) {
      const labelText = line.parts.filter((part) => part.x < DISH_MIN_X).map((part) => part.text).join(' ');
      // Rotated weekday names share the label column; drop them before matching.
      const meal = categoryOf(labelText.replace(/\S+-feira/gi, ''));
      const dish = joinDish(line.parts.filter((part) => part.x >= DISH_MIN_X && part.x < NUMBERS_MIN_X));
      if (meal === 'breakfast') {
        dayIndex += 1;
        current = { date: addDays(header.start, dayIndex), holiday: false, meals: {} };
        days.push(current);
      }
      if (!current) continue;
      if (/\bFERIADO\b/i.test(dish)) { current.holiday = true; continue; }
      if (meal) lastMeal = { key: meal, y: line.y };
      // Dish text sometimes sits on its own line a few units below its label.
      if (!dish.trim() || !lastMeal || Math.abs(line.y - lastMeal.y) > SAME_ROW) continue;
      const previous = current.meals[lastMeal.key];
      current.meals[lastMeal.key] = tidy(previous ? `${previous} ${dish}` : dish);
    }
  }
  return { weeks, days: days.filter((day) => day.date >= (weeks[0]?.start ?? '')).sort((a, b) => a.date.localeCompare(b.date)) };
}
