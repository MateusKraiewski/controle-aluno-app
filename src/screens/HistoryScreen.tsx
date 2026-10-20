import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { Chip } from '../components/Chip';
import { ErrorText } from '../components/ErrorText';
import { LessonCard } from '../components/LessonCard';
import { MAX_SEARCH_LENGTH, toLocalDate } from '../features/lessons/domain';
import { listHistoryPage, updateAttendance } from '../features/lessons/repository';
import type { Attendance, Lesson } from '../features/lessons/types';
import { listSubjects } from '../features/subjects/repository';
import type { Subject } from '../features/subjects/repository';
import { shortDate } from '../lib/format';
import { useApp } from '../theme/AppContext';

const PAGE_SIZE = 30;
const SEARCH_DELAY_MS = 300;

type HistoryScreenProps = { revision: number; onOpen: (lesson: Lesson) => void };

/** Past lessons, newest first, loaded page by page with a keyset cursor. */
export function HistoryScreen({ revision, onOpen }: HistoryScreenProps) {
  const db = useSQLiteContext();
  const { styles, t, language, palette } = useApp();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [items, setItems] = useState<Lesson[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const historyError = t.historyError;

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    listSubjects(db, { includeArchived: true }).then(setSubjects).catch(() => setSubjects([]));
  }, [db, revision]);

  const loadPage = useCallback(async (after: Lesson | null) => {
    const id = ++requestId.current;
    const page = await listHistoryPage(db, {
      before: after && { localDate: after.localDate, startMinute: after.startMinute, id: after.id },
      onOrBefore: toLocalDate(new Date()),
      subjectId,
      search,
      limit: PAGE_SIZE,
    });
    return { page, current: id === requestId.current };
  }, [db, search, subjectId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadPage(null)
      .then(({ page, current }) => {
        if (!active || !current) return;
        setItems(page);
        setHasMore(page.length === PAGE_SIZE);
        setError('');
      })
      .catch(() => { if (active) setError(historyError); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadPage, revision, historyError]);

  async function loadMore() {
    const last = items[items.length - 1];
    if (!last || loadingMore) return;
    setLoadingMore(true);
    try {
      const { page, current } = await loadPage(last);
      if (!current) return;
      setItems((existing) => [...existing, ...page]);
      setHasMore(page.length === PAGE_SIZE);
    } catch {
      setError(historyError);
    } finally {
      setLoadingMore(false);
    }
  }

  const markAttendance = useCallback(async (lesson: Lesson, attendance: Attendance) => {
    setItems((current) => current.map((item) => (item.id === lesson.id ? { ...item, attendance } : item)));
    try {
      if (!(await updateAttendance(db, lesson.id, attendance))) throw new Error('not updated');
    } catch {
      setError(t.attendanceError);
    }
  }, [db, t.attendanceError]);

  return (
    <View style={styles.content}>
      <Text style={styles.sectionEyebrow}>{t.historyEyebrow}</Text>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{t.historyTitle}</Text>
      <Text style={styles.caption}>{t.historyCaption}</Text>
      <TextInput
        accessibilityLabel={t.searchPlaceholder}
        value={searchInput}
        onChangeText={setSearchInput}
        placeholder={t.searchPlaceholder}
        placeholderTextColor={palette.placeholder}
        maxLength={MAX_SEARCH_LENGTH}
        returnKeyType="search"
        autoCorrect={false}
        style={styles.searchInput}
      />
      {subjects.length > 0 && (
        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow} keyboardShouldPersistTaps="handled">
            <Chip label={t.allSubjects} selected={subjectId === null} onPress={() => setSubjectId(null)} />
            {subjects.map((subject) => (
              <Chip key={subject.id} label={subject.name} selected={subjectId === subject.id} onPress={() => setSubjectId(subject.id)} />
            ))}
          </ScrollView>
        </View>
      )}
      <ErrorText message={error} />
      {loading && items.length === 0 ? <ActivityIndicator color={palette.accent} style={{ marginTop: 24 }} /> : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item, index }) => (
            <LessonCard lesson={item} accentIndex={index} onOpen={onOpen} onAttendance={markAttendance} dateLabel={shortDate(item.localDate, language)} />
          )}
          contentContainerStyle={{ paddingBottom: 30 }}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={10}
          windowSize={7}
          removeClippedSubviews
          ListEmptyComponent={<Text style={styles.emptyText}>{t.historyEmpty}</Text>}
          ListFooterComponent={items.length === 0 ? undefined : hasMore ? (
            <Pressable accessibilityRole="button" disabled={loadingMore} onPress={() => void loadMore()} style={[styles.secondaryButton, loadingMore && styles.disabled]}>
              {loadingMore ? <ActivityIndicator color={palette.accent} /> : <Text style={styles.secondaryButtonText}>{t.loadMore}</Text>}
            </Pressable>
          ) : <Text style={styles.retentionHint}>{t.historyEnd}</Text>}
        />
      )}
    </View>
  );
}
