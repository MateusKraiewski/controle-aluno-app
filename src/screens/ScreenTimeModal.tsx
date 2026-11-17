import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Modal, Pressable, SafeAreaView, ScrollView, Text, View } from 'react-native';
import { ErrorText } from '../components/ErrorText';
import { ModalHeader } from '../components/ModalHeader';
import { formatTemplate, toLocalDate, weekdayOf } from '../features/lessons/domain';
import { averageOfPrevious, barRatio, dayBounds, formatDuration, lastDays, totalMs } from '../features/screenTime/domain';
import type { DayUsage } from '../features/screenTime/domain';
import { hasUsageAccess, openUsageAccessSettings, readIcon, readUsage, screenTimeAvailable } from '../features/screenTime/native';
import { prettyDate } from '../lib/format';
import { weekdayLabel } from '../lib/locales';
import { androidTopInset } from '../theme/insets';
import { useApp } from '../theme/AppContext';

const MAX_APPS = 40;

type ScreenTimeModalProps = { visible: boolean; onClose: () => void };

/** Phone-wide screen time (like Digital Wellbeing): last 7 days and the apps of the chosen day. */
export function ScreenTimeModal({ visible, onClose }: ScreenTimeModalProps) {
  const { styles, modalAnimation } = useApp();
  return (
    <Modal visible={visible} animationType={modalAnimation} presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.modalSafe, { paddingTop: androidTopInset }]} accessibilityViewIsModal>
        {visible && <ScreenTimeBody onClose={onClose} />}
      </SafeAreaView>
    </Modal>
  );
}

function ScreenTimeBody({ onClose }: { onClose: () => void }) {
  const { styles, t, palette, language } = useApp();
  const [access, setAccess] = useState(() => hasUsageAccess());
  const [days, setDays] = useState<{ localDate: string; usage: DayUsage }[]>([]);
  const [selected, setSelected] = useState(() => toLocalDate(new Date()));
  const [icons, setIcons] = useState<Record<string, string | null>>({});
  const iconsRef = useRef<Record<string, string | null>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const today = toLocalDate(new Date());
  const labels = { hour: t.screenHour, minute: t.screenMinute, lessThanMinute: t.screenLessThanMinute };

  const load = useCallback(async () => {
    const granted = hasUsageAccess();
    setAccess(granted);
    if (!granted) return;
    setLoading(true);
    try {
      const result = [];
      for (const localDate of lastDays(toLocalDate(new Date()))) {
        const { start, end } = dayBounds(localDate);
        result.push({ localDate, usage: await readUsage(start, Math.min(end, Date.now())) });
      }
      setDays(result);
      setError('');
    } catch {
      setError(t.screenError);
    } finally {
      setLoading(false);
    }
  }, [t.screenError]);

  // Re-read when coming back from the Android "Usage access" settings page.
  useEffect(() => {
    void load();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void load(); });
    return () => subscription.remove();
  }, [load]);

  const day = days.find((item) => item.localDate === selected);
  const apps = (day?.usage.apps ?? []).slice(0, MAX_APPS);

  const appKey = apps.map((app) => app.packageName).join('|');
  useEffect(() => {
    const missing = appKey.split('|').filter((name) => name && !(name in iconsRef.current));
    if (missing.length === 0) return;
    for (const name of missing) iconsRef.current[name] = null;
    Promise.all(missing.map(async (name) => [name, await readIcon(name).catch(() => null)] as const)).then((entries) => {
      Object.assign(iconsRef.current, Object.fromEntries(entries));
      setIcons({ ...iconsRef.current });
    });
  }, [appKey]);

  const totals = days.map((item) => ({ localDate: item.localDate, ms: totalMs(item.usage) }));
  const maxDay = Math.max(0, ...totals.map((item) => item.ms));
  const selectedTotal = day ? totalMs(day.usage) : 0;
  const average = averageOfPrevious(totals, today);
  const maxApp = apps[0]?.foregroundMs ?? 0;

  return (
    <ScrollView contentContainerStyle={styles.form}>
      <ModalHeader eyebrow={t.screenEyebrow} title={t.screenTitle} onClose={onClose} />
      {!screenTimeAvailable ? <Text style={styles.info}>{t.screenUnavailable}</Text> : !access ? (
        <View>
          <Text style={styles.info}>{t.screenAccessBody}</Text>
          <Pressable accessibilityRole="button" onPress={() => openUsageAccessSettings()} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
            <Text style={styles.secondaryButtonText}>{t.screenAccessButton}</Text>
          </Pressable>
          <Text style={styles.info}>{t.screenAccessHint}</Text>
        </View>
      ) : loading && days.length === 0 ? <ActivityIndicator accessibilityLabel={t.loading} color={palette.accent} style={{ marginTop: 32 }} /> : (
        <View>
          <ErrorText message={error} />
          <Text style={{ color: palette.muted, fontSize: 14, marginTop: 4 }}>{selected === today ? t.today : prettyDate(selected, language)}</Text>
          <Text accessibilityRole="header" style={{ color: palette.ink, fontSize: 40, fontWeight: '800', marginTop: 2 }}>{formatDuration(selectedTotal, labels)}</Text>
          <Text style={{ color: palette.muted, fontSize: 14, marginBottom: 14 }}>
            {formatTemplate(t.screenUnlocks, { count: day?.usage.unlocks ?? 0 })}
            {selected === today && average !== null ? ` · ${formatTemplate(t.screenAverage, { time: formatDuration(average, labels) })}` : ''}
          </Text>

          {/* Last 7 days: tap a bar to see that day's apps. */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 150, gap: 8, paddingVertical: 8 }} accessibilityRole="radiogroup" accessibilityLabel={t.screenWeek}>
            {totals.map((item) => {
              const isSelected = item.localDate === selected;
              return (
                <Pressable key={item.localDate} accessibilityRole="radio" accessibilityState={{ checked: isSelected }}
                  accessibilityLabel={`${prettyDate(item.localDate, language)}: ${formatDuration(item.ms, labels)}`}
                  onPress={() => setSelected(item.localDate)} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                  <View style={{ width: '100%', height: `${Math.max(3, barRatio(item.ms, maxDay) * 100)}%`, maxHeight: 110, borderRadius: 6,
                    backgroundColor: isSelected ? palette.green : palette.line }} />
                  <Text style={{ color: isSelected ? palette.ink : palette.muted, fontSize: 12, fontWeight: isSelected ? '700' : '400', marginTop: 6 }}>
                    {weekdayLabel(t, weekdayOf(item.localDate)).slice(0, 3)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text accessibilityRole="header" style={[styles.fieldLabel, { marginTop: 18 }]}>{t.screenApps}</Text>
          {apps.length === 0 && <Text style={styles.info}>{t.screenNoData}</Text>}
          {apps.map((app) => (
            <View key={app.packageName} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: palette.line }}
              accessible accessibilityLabel={`${app.label}: ${formatDuration(app.foregroundMs, labels)}, ${formatTemplate(t.screenOpens, { count: app.opens })}`}>
              {icons[app.packageName]
                ? <Image source={{ uri: icons[app.packageName] as string }} style={{ width: 36, height: 36, borderRadius: 8, marginRight: 12 }} />
                : <View style={{ width: 36, height: 36, borderRadius: 8, marginRight: 12, backgroundColor: palette.line }} />}
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text numberOfLines={1} style={{ color: palette.ink, fontSize: 15, fontWeight: '600', flex: 1, marginRight: 8 }}>{app.label}</Text>
                  <Text style={{ color: palette.ink, fontSize: 14, fontWeight: '600' }}>{formatDuration(app.foregroundMs, labels)}</Text>
                </View>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: palette.line, marginTop: 6, overflow: 'hidden' }}>
                  <View style={{ height: 6, width: `${barRatio(app.foregroundMs, maxApp) * 100}%`, backgroundColor: palette.orange }} />
                </View>
                <Text style={{ color: palette.muted, fontSize: 12, marginTop: 3 }}>{formatTemplate(t.screenOpens, { count: app.opens })}</Text>
              </View>
            </View>
          ))}
          <Text style={[styles.info, { marginTop: 14 }]}>{t.screenPrivacy}</Text>
        </View>
      )}
    </ScrollView>
  );
}
