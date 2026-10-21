import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { ErrorText } from '../components/ErrorText';
import { MAX_ATTACHMENTS_PER_LESSON, formatBytes } from '../features/attachments/domain';
import type { AttachmentMime } from '../features/attachments/domain';
import { isAttachmentAvailable, pickAndAddAttachment, purgeAttachmentTrash, shareAttachment } from '../features/attachments/files';
import type { AddFromPickerOutcome } from '../features/attachments/files';
import { deleteAttachment, listAttachments } from '../features/attachments/repository';
import type { Attachment } from '../features/attachments/repository';
import { formatTemplate } from '../features/lessons/domain';
import { ask } from '../lib/dialogs';
import type { TranslationKey, Translations } from '../lib/locales';
import { useApp } from '../theme/AppContext';

type Row = Attachment & { available: boolean };
type AddError = Extract<AddFromPickerOutcome, { status: 'error' }>['error'];

const ADD_ERRORS: Record<AddError, TranslationKey> = {
  empty: 'attachmentEmpty', tooLarge: 'attachmentTooLarge', unsupportedType: 'attachmentUnsupported', tooMany: 'attachmentLimit',
  lessonNotFound: 'notFound', invalid: 'attachmentError', copyFailed: 'attachmentError',
};

function typeLabel(t: Translations, mime: AttachmentMime): string {
  if (mime === 'application/pdf') return t.attachmentTypePdf;
  if (mime === 'text/plain') return t.attachmentTypeText;
  return t.attachmentTypeImage;
}

/**
 * Files attached to a saved lesson. Picking copies the file into the app's private
 * folder; opening goes through the system share sheet. A row whose file is missing
 * says so in text ("file unavailable") and can still be removed.
 */
export function LessonAttachments({ lessonId }: { lessonId: number }) {
  const db = useSQLiteContext();
  const { styles, t, language } = useApp();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const loadError = t.attachmentLoadError;

  const load = useCallback(async () => {
    const items = await listAttachments(db, lessonId);
    return items.map((item) => ({ ...item, available: isAttachmentAvailable(item) }));
  }, [db, lessonId]);

  useEffect(() => {
    let active = true;
    load().then((items) => { if (active) setRows(items); }).catch(() => { if (active) setError(loadError); });
    return () => { active = false; };
  }, [load, loadError]);

  async function refresh() {
    setRows(await load());
  }

  async function add() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const outcome = await pickAndAddAttachment(db, lessonId, t.attachmentFallbackName);
      if (outcome.status === 'canceled') return;
      if (outcome.status === 'error') { setError(t[ADD_ERRORS[outcome.error]]); return; }
      await refresh();
      setMessage(t.attachmentAdded);
    } catch {
      setError(t.attachmentError);
    } finally {
      setBusy(false);
    }
  }

  async function open(row: Row) {
    setError('');
    try {
      const outcome = await shareAttachment(row, t.attachmentDialogTitle);
      if (outcome === 'missing') { setError(t.attachmentUnavailableHint); await refresh(); }
      else if (outcome === 'unavailable') setError(t.exportUnavailable);
    } catch {
      setError(t.attachmentOpenError);
    }
  }

  async function remove(row: Row) {
    const choice = await ask(t.attachmentRemoveTitle, formatTemplate(t.attachmentRemoveBody, { name: row.displayName }), t.back,
      [{ label: t.attachmentRemove, value: 'remove', destructive: true }]);
    if (choice !== 'remove') return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await deleteAttachment(db, row.id);
      // The row is gone and the file queued; deleting the file now is best effort
      // (anything left is retried on the next start).
      await purgeAttachmentTrash(db).catch(() => 0);
      await refresh();
      setMessage(t.attachmentRemoved);
    } catch {
      setError(t.attachmentError);
    } finally {
      setBusy(false);
    }
  }

  const full = (rows?.length ?? 0) >= MAX_ATTACHMENTS_PER_LESSON;
  const disabled = busy || rows === null || full;
  return (
    <View style={{ marginBottom: 12 }}>
      <Text accessibilityRole="header" style={styles.fieldLabel}>
        {`${t.attachmentsTitle} (${formatTemplate(t.attachmentsCount, { count: rows?.length ?? 0, max: MAX_ATTACHMENTS_PER_LESSON })})`}
      </Text>
      <Text style={styles.info}>{t.attachmentsCaption}</Text>
      {rows?.map((row) => {
        const meta = formatTemplate(t.attachmentMeta, { type: typeLabel(t, row.mimeType), size: formatBytes(row.sizeBytes, language) });
        return (
          <View key={row.id} style={styles.listRow}>
            <Text style={styles.rowTitle}>{row.displayName}</Text>
            <Text style={styles.rowMeta}>{row.available ? meta : `${meta} · ${t.attachmentUnavailable}`}</Text>
            {!row.available && <Text style={[styles.rowMeta, styles.warningText]}>{`⚠ ${t.attachmentUnavailableHint}`}</Text>}
            <View style={styles.rowActions}>
              {row.available && (
                <Pressable accessibilityRole="button" accessibilityLabel={`${t.attachmentOpen}: ${row.displayName}`} accessibilityState={{ disabled: busy }}
                  disabled={busy} onPress={() => void open(row)} style={({ pressed }) => [styles.chip, pressed && styles.pressed, busy && styles.disabled]}>
                  <Text style={styles.chipText}>{t.attachmentOpen}</Text>
                </Pressable>
              )}
              <Pressable accessibilityRole="button" accessibilityLabel={`${t.attachmentRemove}: ${row.displayName}`} accessibilityState={{ disabled: busy }}
                disabled={busy} onPress={() => void remove(row)} style={({ pressed }) => [styles.chip, pressed && styles.pressed, busy && styles.disabled]}>
                <Text style={[styles.chipText, styles.dangerText]}>{t.attachmentRemove}</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
      {full && <Text style={styles.info}>{t.attachmentLimit}</Text>}
      {!!message && <Text accessibilityLiveRegion="polite" style={styles.info}>{message}</Text>}
      <ErrorText message={error} />
      <Pressable accessibilityRole="button" accessibilityState={{ disabled, busy }} disabled={disabled} onPress={() => void add()}
        style={({ pressed }) => [styles.secondaryButton, { marginTop: 4 }, pressed && styles.pressed, disabled && styles.disabled]}>
        <Text style={styles.secondaryButtonText}>{busy ? t.attachmentAdding : t.attachmentAdd}</Text>
      </Pressable>
    </View>
  );
}
