import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { Chip } from '../components/Chip';
import { ErrorText } from '../components/ErrorText';
import { MAX_NAME_LENGTH, formatTemplate } from '../features/lessons/domain';
import { SUBJECT_COLORS } from '../features/subjects/colors';
import type { SubjectColor } from '../features/subjects/colors';
import { listSubjects, moveSubject, renameSubject, setSubjectArchived, setSubjectColor } from '../features/subjects/repository';
import type { Subject } from '../features/subjects/repository';
import { colorName } from '../lib/locales';
import { useApp } from '../theme/AppContext';
import { ObjectivesModal } from './ObjectivesModal';
import type { ObjectivesTarget } from './ObjectivesModal';
import { ReviewSuggestions } from './ReviewSuggestions';

/** A colour option: swatch plus the colour's name, so colour is never the only cue. */
function ColorOption({ color, selected, onPress }: { color: SubjectColor | null; selected: boolean; onPress: () => void }) {
  const { styles, t, palette } = useApp();
  const label = color ? colorName(t, color) : t.colorNone;
  return (
    <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: selected }} hitSlop={4} onPress={onPress}
      style={({ pressed }) => [styles.chip, styles.colorChip, selected && styles.chipSelected, pressed && styles.pressed]}>
      <View style={[styles.swatch, color ? { backgroundColor: palette.subject[color] } : styles.swatchEmpty]} />
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

type SubjectsScreenProps = { revision: number; onChanged: () => void };

export function SubjectsScreen({ revision, onChanged }: SubjectsScreenProps) {
  const db = useSQLiteContext();
  const { styles, t, palette } = useApp();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [colorId, setColorId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [objectivesTarget, setObjectivesTarget] = useState<ObjectivesTarget | null>(null);
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

  async function changeColor(subject: Subject, color: SubjectColor | null) {
    try {
      await setSubjectColor(db, subject.id, color);
      setColorId(null);
      setError('');
      onChanged();
    } catch {
      setError(subjectsError);
    }
  }

  async function move(subject: Subject, direction: 'up' | 'down') {
    try {
      if (await moveSubject(db, subject.id, direction)) onChanged();
      setError('');
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
          ListHeaderComponent={<ReviewSuggestions revision={revision} onOpen={(subjectId, subject) => setObjectivesTarget({ subjectId, subject })} />}
          ListEmptyComponent={<Text style={styles.emptyText}>{t.subjectsEmpty}</Text>}
          renderItem={({ item, index }) => (
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
                <View style={styles.subjectTitleRow}>
                  {item.color && <View style={[styles.swatch, { backgroundColor: palette.subject[item.color] }]} />}
                  <Text style={[styles.rowTitle, item.archived && styles.struck]}>{item.name}</Text>
                </View>
              )}
              <Text style={styles.rowMeta}>
                {formatTemplate(t.lessonsCount, { count: item.lessonCount })}
                {` · ${item.color ? formatTemplate(t.colorLabel, { name: colorName(t, item.color) }) : t.colorNone}`}
                {item.archived ? ` · ${t.archivedLabel}` : ''}
              </Text>
              {colorId === item.id && (
                <View accessibilityRole="radiogroup" accessibilityLabel={`${t.colorPick}: ${item.name}`} style={[styles.chipRow, { marginTop: 10, marginBottom: 0 }]}>
                  <ColorOption color={null} selected={item.color === null} onPress={() => void changeColor(item, null)} />
                  {SUBJECT_COLORS.map((color) => (
                    <ColorOption key={color} color={color} selected={item.color === color} onPress={() => void changeColor(item, color)} />
                  ))}
                </View>
              )}
              <View style={styles.rowActions}>
                {editingId === item.id ? (
                  <>
                    <Chip label={t.saveName} selected onPress={() => void saveName(item)} />
                    <Chip label={t.cancel} onPress={() => { setEditingId(null); setError(''); }} />
                  </>
                ) : (
                  <>
                    <Chip label={formatTemplate(t.objectivesOpen, { count: item.activeObjectives })} accessibilityLabel={`${formatTemplate(t.objectivesOpen, { count: item.activeObjectives })}: ${item.name}`}
                      onPress={() => setObjectivesTarget({ subjectId: item.id, subject: item.name })} />
                    <Chip label={t.rename} accessibilityLabel={`${t.rename}: ${item.name}`} onPress={() => { setEditingId(item.id); setName(item.name); }} />
                    <Chip label={item.archived ? t.unarchive : t.archive} accessibilityLabel={`${item.archived ? t.unarchive : t.archive}: ${item.name}`} onPress={() => void toggleArchived(item)} />
                    <Chip label={t.colorPick} selected={colorId === item.id} accessibilityLabel={`${t.colorPick}: ${item.name}`} onPress={() => setColorId((current) => (current === item.id ? null : item.id))} />
                    <Chip label="↑" accessibilityLabel={`${t.moveUp}: ${item.name}`} disabled={index === 0 || subjects[index - 1].archived !== item.archived} onPress={() => void move(item, 'up')} />
                    <Chip label="↓" accessibilityLabel={`${t.moveDown}: ${item.name}`} disabled={index === subjects.length - 1 || subjects[index + 1].archived !== item.archived} onPress={() => void move(item, 'down')} />
                  </>
                )}
              </View>
            </View>
          )}
        />
      )}
      <ObjectivesModal target={objectivesTarget} onClose={() => setObjectivesTarget(null)} onChanged={onChanged} />
    </View>
  );
}
