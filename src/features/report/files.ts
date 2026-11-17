// Platform glue for the day report: HTML → PDF (expo-print, on the device) → share
// sheet (WhatsApp, e-mail…). The PDF stays in the private cache until the next report.
import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

const REPORT_DIRECTORY = 'day-report';

export async function shareDayReportPdf(html: string, fileName: string, dialogTitle: string): Promise<'shared' | 'unavailable'> {
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  const { uri } = await Print.printToFileAsync({ html });
  const directory = new Directory(Paths.cache, REPORT_DIRECTORY);
  if (directory.exists) directory.delete();
  directory.create({ intermediates: true, idempotent: true });
  const printed = new File(uri);
  const target = new File(directory, fileName);
  printed.move(target);
  await Sharing.shareAsync(target.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle });
  return 'shared';
}
