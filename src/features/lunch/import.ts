// Platform glue for the lunch menu: the student picks the school's PDF, the text is read
// on the device (no network) and parsed into one menu per date before anything is saved.
import * as DocumentPicker from 'expo-document-picker';
import { File, FileMode, Paths } from 'expo-file-system';
import { parseSchoolMenu, type ParsedMenu } from './menu-parser';
import { extractPdfText } from './pdf-text';

export const MAX_MENU_PDF_BYTES = 10 * 1024 * 1024;

export type MenuImport =
  | { status: 'canceled' }
  | { status: 'parsed'; menu: ParsedMenu; fileName: string }
  | { status: 'error'; error: 'tooLarge' | 'notPdf' | 'noMenu' | 'readFailed' };

export async function pickLunchMenu(): Promise<MenuImport> {
  const picked = await DocumentPicker.getDocumentAsync({ type: ['application/pdf'], copyToCacheDirectory: true, multiple: false });
  if (picked.canceled || !picked.assets?.length) return { status: 'canceled' };
  const asset = picked.assets[0];
  const source = new File(asset.uri);
  try {
    const size = source.exists ? source.size : asset.size ?? 0;
    if (size > MAX_MENU_PDF_BYTES) return { status: 'error', error: 'tooLarge' };
    const handle = source.open(FileMode.ReadOnly);
    let bytes: Uint8Array;
    try { bytes = handle.readBytesSync(size); } finally { handle.close(); }
    if (bytes.length < 5 || String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') return { status: 'error', error: 'notPdf' };
    const menu = parseSchoolMenu(extractPdfText(bytes));
    if (menu.days.length === 0) return { status: 'error', error: 'noMenu' };
    return { status: 'parsed', menu, fileName: asset.name };
  } catch {
    return { status: 'error', error: 'readFailed' };
  } finally {
    // The picker's copy in the app cache is no longer needed; only the parsed menu is kept.
    if (source.uri.startsWith(Paths.cache.uri)) { try { source.delete(); } catch { /* already gone */ } }
  }
}
