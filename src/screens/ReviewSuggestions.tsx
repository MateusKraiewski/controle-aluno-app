import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { Chip } from '../components/Chip';
import { ErrorText } from '../components/ErrorText';
import { formatTemplate, toLocalDate } from '../features/lessons/domain';
import { computeReviewSuggestions } from '../features/objectives/domain';
import type { ReviewSuggestion } from '../features/objectives/domain';
import { dismissReviewSuggestion, listReviewCandidates } from '../features/objectives/repository';
import { shortDate } from '../lib/format';
import { useApp } from '../theme/AppContext';

type ReviewSuggestionsProps = { revision: number; onOpen: (subjectId: number, subject: string) => void };

/**
 * Explainable review suggestions computed on the device (see computeReviewSuggestions).
 * Each one names its source date; dismissing it is stored and survives restarts.
 * Renders nothing when there is no suggestion.
 */
export function ReviewSuggestions({ revision, onOpen }: ReviewSuggestionsProps) {
  const db = useSQLiteContext();
  const { styles, t, language } = useApp();
  const [suggestions, setSuggestions] = useState<ReviewSuggestion[]>([]);
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState(0);
  const reviewError = t.reviewError;

  useEffect(() => {
    let active = true;
    const today = toLocalDate(new Date());
    listReviewCandidates(db, today)
      .then((candidates) => { if (active) setSuggestions(computeReviewSuggestions(candidates, today)); })
      .catch(() => { if (active) setError(reviewError); });
    return () => { active = false; };
  }, [db, revision, dismissed, reviewError]);

  async function dismiss(suggestion: ReviewSuggestion) {
    try {
      await dismissReviewSuggestion(db, suggestion.objectiveId, suggestion.basisDate);
      setError('');
      setDismissed((value) => value + 1);
    } catch {
      setError(reviewError);
    }
  }

  if (suggestions.length === 0 && !error) return null;
  return (
    <View style={{ marginBottom: 6 }}>
      <Text accessibilityRole="header" style={[styles.fieldLabel, { marginTop: 4 }]}>{t.reviewTitle}</Text>
      <Text style={styles.info}>{t.reviewCaption}</Text>
      <ErrorText message={error} />
      {suggestions.map((suggestion) => (
        <View key={suggestion.objectiveId} style={styles.listRow}>
          <Text style={styles.rowTitle}>
            {formatTemplate(suggestion.kind === 'notReviewed' ? t.reviewNotReviewed : t.reviewNeverWorked, { weeks: suggestion.weeks, title: suggestion.title })}
          </Text>
          <Text style={styles.rowMeta}>
            {formatTemplate(suggestion.kind === 'notReviewed' ? t.reviewSourceLesson : t.reviewSourceCreated, {
              subject: suggestion.subject, date: shortDate(suggestion.basisDate, language),
            })}
          </Text>
          <View style={styles.rowActions}>
            <Chip label={t.reviewOpen} accessibilityLabel={`${t.reviewOpen}: ${suggestion.subject}`} onPress={() => onOpen(suggestion.subjectId, suggestion.subject)} />
            <Chip label={t.reviewDismiss} accessibilityLabel={`${t.reviewDismiss}: ${suggestion.title}`} onPress={() => void dismiss(suggestion)} />
          </View>
        </View>
      ))}
    </View>
  );
}
