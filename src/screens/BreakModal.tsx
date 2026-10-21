import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { ErrorText } from '../components/ErrorText';
import { Field } from '../components/Field';
import { ModalHeader } from '../components/ModalHeader';
import { MAX_REASON_LENGTH, MAX_RECURRENCE_SPAN_DAYS, addDays, formatTemplate, validateDateRange } from '../features/lessons/domain';
import type { DateRangeError } from '../features/lessons/domain';
import { cancelLessonsInRange, countBreakTargets } from '../features/lessons/repository';
import { ask } from '../lib/dialogs';
import { shortDate } from '../lib/format';
import type { TranslationKey } from '../lib/locales';
import { useApp } from '../theme/AppContext';

export const RANGE_ERRORS: Record<DateRangeError, TranslationKey> = {
  fromInvalid: 'rangeFromInvalid', toInvalid: 'rangeToInvalid', rangeReversed: 'rangeReversed', rangeTooLong: 'rangeTooLong',
};

type BreakModalProps = { startDate: string | null; onClose: () => void; onChanged: () => void };

/** Holiday/break: cancels planned, unrecorded lessons in a date range after a count preview. */
export function BreakModal({ startDate, onClose, onChanged }: BreakModalProps) {
  const { modalAnimation } = useApp();
  return (
    <Modal visible={startDate !== null} animationType={modalAnimation} presentationStyle="pageSheet" onRequestClose={onClose}>
      {startDate !== null && <BreakBody key={startDate} startDate={startDate} onClose={onClose} onChanged={onChanged} />}
    </Modal>
  );
}

function BreakBody({ startDate, onClose, onChanged }: { startDate: string; onClose: () => void; onChanged: () => void }) {
  const db = useSQLiteContext();
  const { styles, t, language } = useApp();
  const [from, setFrom] = useState(startDate);
  const [to, setTo] = useState(addDays(startDate, 6));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function apply() {
    setMessage('');
    setError('');
    const range = validateDateRange(from, to, { required: true, maxDays: MAX_RECURRENCE_SPAN_DAYS });
    if (!range.ok) { setError(t[RANGE_ERRORS[range.error]]); return; }
    const start = range.value.from as string;
    const end = range.value.to as string;
    setBusy(true);
    try {
      const count = await countBreakTargets(db, start, end);
      if (count === 0) { setMessage(t.breakNone); return; }
      const body = formatTemplate(t.breakConfirmBody, { from: shortDate(start, language), to: shortDate(end, language) });
      const choice = await ask(formatTemplate(t.breakConfirmTitle, { count }), body, t.back, [{ label: t.breakConfirm, value: 'cancel', destructive: true }]);
      if (choice !== 'cancel') return;
      const cancelled = await cancelLessonsInRange(db, start, end, reason.trim().slice(0, MAX_REASON_LENGTH) || null);
      setMessage(formatTemplate(t.breakDone, { count: cancelled }));
      onChanged();
    } catch {
      setError(t.breakError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaProvider><SafeAreaView style={styles.modalSafe} accessibilityViewIsModal>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <ModalHeader eyebrow={t.breakEyebrow} title={t.breakTitle} onClose={onClose} />
          <Text style={styles.info}>{t.breakCaption}</Text>
          <Field label={t.breakFrom} value={from} onChangeText={setFrom} placeholder="2026-12-21" keyboardType="numbers-and-punctuation" maxLength={10} />
          <Field label={t.breakTo} value={to} onChangeText={setTo} placeholder="2027-01-02" keyboardType="numbers-and-punctuation" maxLength={10} />
          <Field label={t.breakReason} value={reason} onChangeText={setReason} placeholder={t.breakReasonPlaceholder} maxLength={MAX_REASON_LENGTH} />
          <ErrorText message={error} />
          {!!message && <Text accessibilityLiveRegion="polite" style={[styles.info, { marginTop: 12 }]}>{message}</Text>}
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={() => void apply()}
            style={({ pressed }) => [styles.saveButton, pressed && styles.pressed, busy && styles.disabled]}>
            <Text style={styles.saveButtonText}>{t.breakApply}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView></SafeAreaProvider>
  );
}
