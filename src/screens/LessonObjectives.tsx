import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { ErrorText } from '../components/ErrorText';
import { listLessonObjectives, setLessonObjectiveTag } from '../features/objectives/repository';
import type { LessonObjective } from '../features/objectives/repository';
import { useApp } from '../theme/AppContext';
import { objectiveStatusLabel } from './ObjectivesModal';

type LessonObjectivesProps = { lessonId: number; subjectId: number; onChanged: () => void };

/**
 * Tags which objectives of the lesson's (saved) subject were worked on. Each toggle
 * is written immediately, like attendance; nothing about the result is inferred.
 */
export function LessonObjectives({ lessonId, subjectId, onChanged }: LessonObjectivesProps) {
  const db = useSQLiteContext();
  const { styles, t } = useApp();
  const [objectives, setObjectives] = useState<LessonObjective[] | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const loadError = t.objectivesLoadError;

  useEffect(() => {
    let active = true;
    listLessonObjectives(db, lessonId)
      .then((rows) => { if (active) setObjectives(rows); })
      .catch(() => { if (active) setError(loadError); });
    return () => { active = false; };
  }, [db, lessonId, subjectId, reload, loadError]);

  async function toggle(objective: LessonObjective) {
    const next = !objective.tagged;
    setObjectives((current) => current?.map((item) => (item.id === objective.id ? { ...item, tagged: next } : item)) ?? current);
    try {
      if (!(await setLessonObjectiveTag(db, lessonId, objective.id, next))) throw new Error('not tagged');
      setError('');
      onChanged();
    } catch {
      setError(t.lessonObjectivesError);
      setReload((value) => value + 1);
    }
  }

  if (objectives === null && !error) return null;
  return (
    <View style={{ marginBottom: 6 }}>
      <Text accessibilityRole="header" style={styles.fieldLabel}>{t.lessonObjectives}</Text>
      {objectives && objectives.length === 0 ? <Text style={styles.info}>{t.lessonObjectivesEmpty}</Text> : (
        <>
          <Text style={styles.info}>{t.lessonObjectivesHint}</Text>
          <View style={styles.chipRow}>
            {objectives?.map((objective) => (
              <Pressable key={objective.id} accessibilityRole="checkbox" accessibilityState={{ checked: objective.tagged }} hitSlop={4}
                accessibilityLabel={`${objective.title} (${objectiveStatusLabel(t, objective.status)})`} onPress={() => void toggle(objective)}
                style={({ pressed }) => [styles.chip, objective.tagged && styles.chipSelected, pressed && styles.pressed]}>
                <Text style={[styles.chipText, objective.tagged && styles.chipTextSelected]}>{`${objective.tagged ? '☑' : '☐'} ${objective.title}`}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
      <ErrorText message={error} />
    </View>
  );
}
