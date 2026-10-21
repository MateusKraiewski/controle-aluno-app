import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { Chip } from '../components/Chip';
import { ErrorText } from '../components/ErrorText';
import { Field } from '../components/Field';
import { ModalHeader } from '../components/ModalHeader';
import { formatTemplate } from '../features/lessons/domain';
import { MAX_OBJECTIVE_TITLE, OBJECTIVE_STATUSES } from '../features/objectives/domain';
import type { ObjectiveStatus } from '../features/objectives/domain';
import { createObjective, listObjectives, renameObjective, setObjectiveStatus } from '../features/objectives/repository';
import type { CreateObjectiveError, Objective } from '../features/objectives/repository';
import { shortDate } from '../lib/format';
import type { TranslationKey, Translations } from '../lib/locales';
import { useApp } from '../theme/AppContext';

export type ObjectivesTarget = { subjectId: number; subject: string };

const STATUS_KEYS: Record<ObjectiveStatus, TranslationKey> = {
  open: 'objectiveStatusOpen', practising: 'objectiveStatusPractising', done: 'objectiveStatusDone',
};
const ERROR_KEYS: Record<CreateObjectiveError, TranslationKey> = {
  titleRequired: 'objectiveTitleRequired', titleTooLong: 'objectiveTitleTooLong', tooMany: 'objectiveTooMany', subjectNotFound: 'objectiveError',
};

export function objectiveStatusLabel(t: Translations, status: ObjectiveStatus): string {
  return t[STATUS_KEYS[status]];
}

type ObjectivesModalProps = { target: ObjectivesTarget | null; onClose: () => void; onChanged: () => void };

/** Learning objectives of one subject: list, add, rename and choose the status. */
export function ObjectivesModal({ target, onClose, onChanged }: ObjectivesModalProps) {
  const { modalAnimation } = useApp();
  return (
    <Modal visible={target !== null} animationType={modalAnimation} presentationStyle="pageSheet" onRequestClose={onClose}>
      {target && <ObjectivesBody key={target.subjectId} target={target} onClose={onClose} onChanged={onChanged} />}
    </Modal>
  );
}

function ObjectivesBody({ target, onClose, onChanged }: { target: ObjectivesTarget; onClose: () => void; onChanged: () => void }) {
  const db = useSQLiteContext();
  const { styles, t, language, palette } = useApp();
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const loadError = t.objectivesLoadError;

  useEffect(() => {
    let active = true;
    listObjectives(db, target.subjectId, { includeDone: showDone })
      .then((rows) => { if (active) setObjectives(rows); })
      .catch(() => { if (active) setError(loadError); });
    return () => { active = false; };
  }, [db, target.subjectId, showDone, revision, loadError]);

  function changed() {
    setRevision((value) => value + 1);
    onChanged();
  }

  async function add() {
    setBusy(true);
    try {
      const result = await createObjective(db, target.subjectId, draft);
      if (!result.ok) { setError(t[ERROR_KEYS[result.error]]); return; }
      setDraft('');
      setError('');
      changed();
    } catch {
      setError(t.objectiveError);
    } finally {
      setBusy(false);
    }
  }

  async function saveTitle(objective: Objective) {
    try {
      const result = await renameObjective(db, objective.id, editTitle);
      if (!result.ok) { setError(t[ERROR_KEYS[result.error]]); return; }
      setEditingId(null);
      setError('');
      changed();
    } catch {
      setError(t.objectiveError);
    }
  }

  async function changeStatus(objective: Objective, status: ObjectiveStatus) {
    if (objective.status === status) return;
    try {
      await setObjectiveStatus(db, objective.id, status);
      setError('');
      changed();
    } catch {
      setError(t.objectiveError);
    }
  }

  return (
    <SafeAreaProvider><SafeAreaView style={styles.modalSafe} accessibilityViewIsModal>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <ModalHeader eyebrow={t.objectivesEyebrow} title={target.subject} onClose={onClose} />
          <Text style={styles.info}>{t.objectivesCaption}</Text>
          <Field label={t.objectiveNew} value={draft} onChangeText={setDraft} placeholder={t.objectivePlaceholder} maxLength={MAX_OBJECTIVE_TITLE} />
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={() => void add()}
            style={({ pressed }) => [styles.secondaryButton, { marginTop: 0 }, pressed && styles.pressed, busy && styles.disabled]}>
            <Text style={styles.secondaryButtonText}>{t.objectiveAdd}</Text>
          </Pressable>
          <ErrorText message={error} />
          <View style={[styles.chipRow, { marginTop: 16 }]}>
            <Chip label={t.showDone} selected={showDone} onPress={() => setShowDone((value) => !value)} />
          </View>
          {objectives.length === 0 && <Text style={styles.emptyText}>{t.objectivesEmpty}</Text>}
          {objectives.map((objective) => (
            <View key={objective.id} style={styles.listRow}>
              {editingId === objective.id ? (
                <TextInput
                  accessibilityLabel={t.objectiveEdit}
                  value={editTitle}
                  onChangeText={setEditTitle}
                  maxLength={MAX_OBJECTIVE_TITLE}
                  autoFocus
                  onSubmitEditing={() => void saveTitle(objective)}
                  placeholderTextColor={palette.placeholder}
                  style={styles.input}
                />
              ) : (
                <Text style={[styles.rowTitle, objective.status === 'done' && styles.struck]}>{objective.title}</Text>
              )}
              <Text style={styles.rowMeta}>
                {objective.lastWorkedDate
                  ? formatTemplate(t.objectiveLastWorked, { date: shortDate(objective.lastWorkedDate, language) })
                  : t.objectiveNeverWorked}
                {` · ${formatTemplate(t.objectiveLessons, { count: objective.lessonCount })}`}
              </Text>
              <View accessibilityRole="radiogroup" accessibilityLabel={`${t.objectiveStatus}: ${objective.title}`} style={styles.rowActions}>
                {OBJECTIVE_STATUSES.map((status) => (
                  <Pressable key={status} accessibilityRole="radio" accessibilityState={{ checked: objective.status === status }}
                    accessibilityLabel={`${t.objectiveStatus}: ${objectiveStatusLabel(t, status)}`} onPress={() => void changeStatus(objective, status)}
                    style={({ pressed }) => [styles.chip, objective.status === status && styles.chipSelected, pressed && styles.pressed]}>
                    <Text style={[styles.chipText, objective.status === status && styles.chipTextSelected]}>{objective.status === status ? `✓ ${objectiveStatusLabel(t, status)}` : objectiveStatusLabel(t, status)}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.rowActions}>
                {editingId === objective.id ? (
                  <>
                    <Chip label={t.objectiveSave} selected onPress={() => void saveTitle(objective)} />
                    <Chip label={t.cancel} onPress={() => { setEditingId(null); setError(''); }} />
                  </>
                ) : (
                  <Chip label={t.objectiveEdit} accessibilityLabel={`${t.objectiveEdit}: ${objective.title}`}
                    onPress={() => { setEditingId(objective.id); setEditTitle(objective.title); }} />
                )}
              </View>
            </View>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView></SafeAreaProvider>
  );
}
