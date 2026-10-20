// Pure text helpers shared by the app, migrations and tests (no React/Expo imports).

const COMBINING_MARKS = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;

// Fallback when String.prototype.normalize is unavailable: common Latin letters only.
const FALLBACK_FOLDS: Record<string, string> = {
  à: 'a', á: 'a', â: 'a', ã: 'a', ä: 'a', å: 'a', ç: 'c', è: 'e', é: 'e', ê: 'e', ë: 'e', ì: 'i', í: 'i', î: 'i', ï: 'i',
  ñ: 'n', ò: 'o', ó: 'o', ô: 'o', õ: 'o', ö: 'o', ù: 'u', ú: 'u', û: 'u', ü: 'u', ý: 'y', ÿ: 'y',
};

function stripMarks(text: string): string {
  try {
    return text.normalize('NFD').replace(COMBINING_MARKS, '');
  } catch {
    return text.replace(/[^\u0000-\u007f]/g, (char) => FALLBACK_FOLDS[char] ?? char);
  }
}

/**
 * Accent- and case-insensitive key for local search: "FÍSICA", "Física" and "fisica"
 * all become "fisica". Whitespace runs collapse to one space. Stored in the
 * `search_*` columns and applied to the typed term, so both sides use the same rule.
 */
export function normalizeForSearch(text: string): string {
  return stripMarks(text.toLowerCase()).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Search key for a lesson's own text fields (subject name is searched on `subjects.search_name`). */
export function lessonSearchText(fields: { teacher: string | null; plannedContent: string | null; studiedContent: string | null }): string {
  // Newline separator: the search term never contains one, so a match cannot span two fields.
  return [fields.teacher, fields.plannedContent, fields.studiedContent]
    .map((value) => (value ? normalizeForSearch(value) : ''))
    .join('\n');
}
