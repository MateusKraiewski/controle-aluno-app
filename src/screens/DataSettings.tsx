import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { ErrorText } from '../components/ErrorText';
import { BackupFileTooLargeError, clearExportFiles, pickBackupText, shareBackupFile, shareCsvFile } from '../features/backup/files';
import { MAX_BACKUP_CHARS, MAX_BACKUP_LESSONS, backupFileName, serializeBackup, summarizeBackup, validateBackup } from '../features/backup/format';
import type { BackupError, BackupSummary, ValidatedBackup } from '../features/backup/format';
import { BackupTooLargeError, countLocalData, deleteAllData, exportBackup, restoreBackup } from '../features/backup/repository';
import type { DataCounts } from '../features/backup/repository';
import { purgeAttachmentTrash, removeAllAttachmentFiles } from '../features/attachments/files';
import { countAttachments } from '../features/attachments/repository';
import { buildHistoryCsv, historyCsvFileName } from '../features/export/csv';
import type { HistoryCsvLabels } from '../features/export/csv';
import { HistoryExportTooLargeError, MAX_CSV_LESSONS, readHistoryForCsv } from '../features/export/repository';
import { formatTemplate, toLocalDate } from '../features/lessons/domain';
import { ask } from '../lib/dialogs';
import { dateTime } from '../lib/format';
import type { Translations } from '../lib/locales';
import { useApp } from '../theme/AppContext';

type Busy = 'export' | 'csv' | 'check' | 'restore' | 'delete' | null;
type Preview = { backup: ValidatedBackup; summary: BackupSummary; current: DataCounts; attachments: number };

function backupErrorMessage(t: Translations, error: BackupError): string {
  const path = error.path ?? '';
  switch (error.code) {
    case 'empty': return t.backupEmpty;
    case 'tooLarge': return t.backupTooLarge;
    case 'notJson': return t.backupNotJson;
    case 'notBackup': return t.backupNotBackup;
    case 'newerSchema': return t.backupNewer;
    case 'olderSchema': return t.backupOlder;
    case 'tooManyRecords': return formatTemplate(t.backupTooMany, { path });
    case 'duplicateId': return formatTemplate(t.backupDuplicateId, { path });
    case 'duplicateSubject': return formatTemplate(t.backupDuplicateSubject, { path });
    case 'missingReference': return formatTemplate(t.backupMissingRef, { path });
    case 'invalidField': return formatTemplate(t.backupInvalid, { path });
  }
}

function csvLabels(t: Translations): HistoryCsvLabels {
  return {
    date: t.csvColDate, start: t.csvColStart, end: t.csvColEnd, subject: t.csvColSubject, status: t.csvColStatus,
    attendance: t.csvColAttendance, planned: t.csvColPlanned, studied: t.csvColStudied, nextStep: t.csvColNextStep,
    privateNotes: t.csvColNotes, statusPlanned: t.csvStatusPlanned, statusCancelled: t.cancelled,
    attendanceUnmarked: t.pending, attendanceAttended: t.attended, attendanceAbsent: t.absent,
  };
}

/** Export (JSON backup, CSV history), restore and erase of the student's local data (settings screen). */
export function DataSettings({ onChanged }: { onChanged: () => void }) {
  const db = useSQLiteContext();
  const { styles, t, palette, language } = useApp();
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showRestore, setShowRestore] = useState(false);
  const [source, setSource] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [csvNotes, setCsvNotes] = useState(false);

  function report(nextMessage: string, nextError = '') {
    setMessage(nextMessage);
    setError(nextError);
  }

  async function exportData() {
    setBusy('export');
    report('');
    try {
      const document = await exportBackup(db);
      const json = serializeBackup(document);
      if (json.length > MAX_BACKUP_CHARS) throw new BackupTooLargeError();
      const outcome = await shareBackupFile(json, backupFileName(document.exported_at), t.exportDialogTitle);
      if (outcome === 'unavailable') report('', t.exportUnavailable);
      else report(formatTemplate(t.exportDone, { subjects: document.subjects.length, lessons: document.lessons.length }));
    } catch (caught) {
      report('', caught instanceof BackupTooLargeError ? formatTemplate(t.exportTooLarge, { max: MAX_BACKUP_LESSONS }) : t.exportError);
    } finally {
      setBusy(null);
    }
  }

  async function exportCsv() {
    setBusy('csv');
    report('');
    try {
      const today = toLocalDate(new Date());
      const rows = await readHistoryForCsv(db, today, { includePrivateNotes: csvNotes });
      const csv = buildHistoryCsv(rows, csvLabels(t), { includePrivateNotes: csvNotes });
      const outcome = await shareCsvFile(csv, historyCsvFileName(today), t.csvDialogTitle);
      if (outcome === 'unavailable') report('', t.exportUnavailable);
      else report(formatTemplate(t.csvDone, { lessons: rows.length }));
    } catch (caught) {
      report('', caught instanceof HistoryExportTooLargeError ? formatTemplate(t.csvTooLarge, { max: MAX_CSV_LESSONS }) : t.csvError);
    } finally {
      setBusy(null);
    }
  }

  async function check(text: string) {
    setBusy('check');
    report('');
    setPreview(null);
    try {
      const result = validateBackup(text);
      if (!result.ok) { report('', backupErrorMessage(t, result.error)); return; }
      setPreview({ backup: result.value, summary: summarizeBackup(result.value), current: await countLocalData(db), attachments: (await countAttachments(db)).count });
    } catch {
      report('', t.restoreError);
    } finally {
      setBusy(null);
    }
  }

  async function pickFile() {
    try {
      const text = await pickBackupText();
      if (text === null) return;
      setSource('');
      await check(text);
    } catch (caught) {
      report('', caught instanceof BackupFileTooLargeError ? t.backupTooLarge : t.restoreError);
    }
  }

  async function confirmRestore() {
    if (!preview) return;
    // A backup has no attachments: restoring replaces every lesson, so the current attachments go too.
    const body = preview.attachments > 0 ? `${t.restoreBody}

${formatTemplate(t.restoreAttachmentsNote, { count: preview.attachments })}` : t.restoreBody;
    const choice = await ask(t.restoreTitle, body, t.back, [{ label: t.confirmRestore, value: 'restore', destructive: true }]);
    if (choice !== 'restore') return;
    setBusy('restore');
    try {
      const counts = await restoreBackup(db, preview.backup);
      await purgeAttachmentTrash(db).catch(() => 0);
      setPreview(null);
      setSource('');
      setShowRestore(false);
      report(formatTemplate(t.restoreDone, { subjects: counts.subjects, lessons: counts.lessons }));
      onChanged();
    } catch {
      report('', t.restoreError);
    } finally {
      setBusy(null);
    }
  }

  async function deleteEverything() {
    report('');
    let counts: DataCounts;
    let attachments = 0;
    try {
      counts = await countLocalData(db);
      attachments = (await countAttachments(db)).count;
    } catch {
      report('', t.deleteAllError);
      return;
    }
    const summary = formatTemplate(t.deleteAllBody, { subjects: counts.subjects, lessons: counts.lessons });
    const first = await ask(t.deleteAllTitle, attachments > 0 ? `${summary} ${formatTemplate(t.deleteAllAttachmentsNote, { count: attachments })}` : summary, t.back,
      [{ label: t.deleteAllContinue, value: 'continue' }]);
    if (first !== 'continue') return;
    const second = await ask(t.deleteAllConfirmTitle, t.deleteAllConfirmBody, t.back, [{ label: t.deleteAllConfirm, value: 'delete', destructive: true }]);
    if (second !== 'delete') return;
    setBusy('delete');
    try {
      await deleteAllData(db);
      try { clearExportFiles(); } catch { /* the cache file is removed by the OS or the next export */ }
      // Rows are gone; the files folder goes too (anything left is retried on the next start).
      await removeAllAttachmentFiles(db).catch(() => undefined);
      setPreview(null);
      report(t.deleteAllDone);
      onChanged();
    } catch {
      report('', t.deleteAllError);
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null;
  return (
    <View>
      <Text accessibilityRole="header" style={[styles.fieldLabel, styles.themeLabel]}>{t.dataSection}</Text>
      <Text style={styles.info}>{t.dataCaption}</Text>
      {!!message && <Text accessibilityLiveRegion="polite" style={styles.info}>{message}</Text>}
      <ErrorText message={error} />

      <Pressable accessibilityRole="button" accessibilityState={{ disabled, busy: busy === 'export' }} disabled={disabled} onPress={() => void exportData()}
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, disabled && styles.disabled]}>
        <Text style={styles.secondaryButtonText}>{busy === 'export' ? t.exporting : t.exportBackup}</Text>
      </Pressable>

      <View style={[styles.listRow, { marginTop: 12 }]}>
        <Text style={styles.rowTitle}>{t.csvExport}</Text>
        <Text style={styles.rowMeta}>{t.csvCaption}</Text>
        <Pressable accessibilityRole="checkbox" accessibilityLabel={t.csvIncludeNotes} accessibilityState={{ checked: csvNotes, disabled }} accessibilityHint={t.csvIncludeNotesHint}
          disabled={disabled} onPress={() => setCsvNotes((value) => !value)}
          style={({ pressed }) => [styles.option, csvNotes && styles.optionSelected, pressed && styles.pressed]}>
          <Text style={[styles.optionText, csvNotes && styles.optionTextSelected]}>{`${csvNotes ? '☑' : '☐'} ${t.csvIncludeNotes}`}</Text>
        </Pressable>
        <Text style={[styles.rowMeta, { marginTop: 6 }]}>{t.csvIncludeNotesHint}</Text>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled, busy: busy === 'csv' }} disabled={disabled} onPress={() => void exportCsv()}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, disabled && styles.disabled]}>
          <Text style={styles.secondaryButtonText}>{busy === 'csv' ? t.exporting : t.csvExport}</Text>
        </Pressable>
      </View>

      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showRestore, disabled }} disabled={disabled}
        onPress={() => { setShowRestore((value) => !value); setPreview(null); report(''); }}
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, disabled && styles.disabled]}>
        <Text style={styles.secondaryButtonText}>{t.restoreBackup}</Text>
      </Pressable>

      {showRestore && (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.info}>{t.restoreCaption}</Text>
          <TextInput
            accessibilityLabel={t.restorePlaceholder}
            value={source}
            onChangeText={(value) => { setSource(value); setPreview(null); }}
            placeholder={t.restorePlaceholder}
            placeholderTextColor={palette.placeholder}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            maxLength={MAX_BACKUP_CHARS}
            style={[styles.input, styles.multiline, { maxHeight: 180 }]}
          />
          <View style={[styles.formRow, { marginTop: 4 }]}>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={() => void pickFile()}
              style={({ pressed }) => [styles.secondaryButton, { flex: 1 }, pressed && styles.pressed, disabled && styles.disabled]}>
              <Text style={styles.secondaryButtonText}>{t.pickFile}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled, busy: busy === 'check' }} disabled={disabled} onPress={() => void check(source)}
              style={({ pressed }) => [styles.secondaryButton, { flex: 1 }, pressed && styles.pressed, disabled && styles.disabled]}>
              <Text style={styles.secondaryButtonText}>{busy === 'check' ? t.checking : t.checkBackup}</Text>
            </Pressable>
          </View>
          {preview && (
            <View style={[styles.listRow, { marginTop: 12 }]}>
              <Text accessibilityLiveRegion="polite" style={styles.rowTitle}>
                {formatTemplate(t.restorePreview, {
                  date: dateTime(preview.summary.exportedAt, language), subjects: preview.summary.subjects,
                  series: preview.summary.series, lessons: preview.summary.lessons,
                })}
              </Text>
              <Text style={styles.rowMeta}>{formatTemplate(t.restoreReplaceNote, { subjects: preview.current.subjects, lessons: preview.current.lessons })}</Text>
              {preview.attachments > 0 && <Text style={[styles.rowMeta, styles.warningText]}>{`⚠ ${formatTemplate(t.restoreAttachmentsNote, { count: preview.attachments })}`}</Text>}
              <Pressable accessibilityRole="button" accessibilityState={{ disabled, busy: busy === 'restore' }} disabled={disabled} onPress={() => void confirmRestore()}
                style={({ pressed }) => [styles.dangerButton, pressed && styles.pressed, disabled && styles.disabled]}>
                <Text style={styles.dangerButtonText}>{t.confirmRestore}</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      <Pressable accessibilityRole="button" accessibilityState={{ disabled, busy: busy === 'delete' }} disabled={disabled} onPress={() => void deleteEverything()}
        style={({ pressed }) => [styles.dangerButton, { marginTop: 22 }, pressed && styles.pressed, disabled && styles.disabled]}>
        <Text style={styles.dangerButtonText}>{t.deleteAll}</Text>
      </Pressable>
    </View>
  );
}
