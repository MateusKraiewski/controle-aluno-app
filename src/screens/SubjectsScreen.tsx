import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Text, TextInput, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { Chip } from '../components/Chip';
import { ErrorText } from '../components/ErrorText';
import { MAX_NAME_LENGTH, formatTemplate } from '../features/lessons/domain';
import { listSubjects, renameSubject, setSubjectArchived } from '../features/subjects/repository';
import type { Subject } from '../features/subjects/repository';
import { useApp } from '../theme/AppContext';

type SubjectsScreenProps = { revision: number; onChanged: () => void };

export function SubjectsScreen({ revision, onChanged }: SubjectsScreenProps) {
  const db = useSQLiteContext();
  const { styles, t, palette } = useApp();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const subjectsError = t.subjectsError;

  useEffect(() => {
    let active = true;
    listSubjects(db, { includeArchived: showArchived })
      .then((rows) => { if (active) setSubjects(rows); })
      .catch(() => { if (active) setError(subjectsError); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [db, revision, showArchived, subjectsError]);

  async function saveName(subject: Subject) {
    const trimmed = name.trim().replace(/\s+/g, ' ');
    if (!trimmed) { setError(t.saveSubjectError); return; }
    if (trimmed.length > MAX_NAME_LENGTH) { setError(t.subjectTooLong); return; }
    try {
      if (await renameSubject(db, subject.id, trimmed) === 'duplicate') { setError(t.renameDuplicate); return; }
      setEditingId(null);
      setError('');
      onChanged();
    } catch {
      setError(subjectsError);
    }
  }

  async function toggleArchived(subject: Subject) {
    try {
      await setSubjectArchived(db, subject.id, !subject.archived);
      setError('');
      onChanged();
    } catch {
      setError(subjectsError);
    }
  }

  return (
    <View style={styles.content}>
      <Text style={styles.sectionEyebrow}>{t.subjectsEyebrow}</Text>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{t.subjectsTitle}</Text>
      <Text style={styles.caption}>{t.subjectsCaption}</Text>
      <View style={[styles.chipRow, { marginTop: 12, marginBottom: 4 }]}>
        <Chip label={t.showArchived} selected={showArchived} onPress={() => setShowArchived((value) => !value)} />
      </View>
      <ErrorText message={error} />
      {loading ? <ActivityIndicator color={palette.accent} style={{ marginTop: 24 }} /> : (
        <FlatList
          data={subjects}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingTop: 10, paddingBottom: 30 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={styles.emptyText}>{t.subjectsEmpty}</Text>}
          renderItem={({ item }) => (
            <View style={styles.listRow}>
              {editingId === item.id ? (
                <TextInput
                  accessibilityLabel={t.rename}
                  value={name}
                  onChangeText={setName}
                  maxLength={MAX_NAME_LENGTH}
                  autoFocus
                  onSubmitEditing={() => void saveName(item)}
                  style={styles.input}
                />
              ) : (
                <Text style={[styles.rowTitle, item.archived && styles.struck]}>{item.name}</Text>
              )}
              <Text style={styles.rowMeta}>
                {formatTemplate(t.lessonsCount, { count: item.lessonCount })}{item.archived ? ` · ${t.archivedLabel}` : ''}
              </Text>
              <View style={styles.rowActions}>
                {editingId === item.id ? (
                  <>
                    <Chip label={t.saveName} selected onPress={() => void saveName(item)} />
                    <Chip label={t.cancel} onPress={() => { setEditingId(null); setError(''); }} />
                  </>
                ) : (
                  <>
                    <Chip label={t.rename} accessibilityLabel={`${t.rename}: ${item.name}`} onPress={() => { setEditingId(item.id); setName(item.name); }} />
                    <Chip label={item.archived ? t.unarchive : t.archive} accessibilityLabel={`${item.archived ? t.unarchive : t.archive}: ${item.name}`} onPress={() => void toggleArchived(item)} />
                  </>
                )}
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}
