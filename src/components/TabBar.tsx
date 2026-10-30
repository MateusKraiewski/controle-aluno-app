import { Pressable, Text, View } from 'react-native';
import { useApp } from '../theme/AppContext';

export type TabKey = 'agenda' | 'history' | 'lunch' | 'subjects';

export function TabBar({ active, onChange }: { active: TabKey; onChange: (tab: TabKey) => void }) {
  const { styles, t } = useApp();
  const tabs: [TabKey, string][] = [['agenda', t.tabAgenda], ['history', t.tabHistory], ['lunch', t.tabLunch], ['subjects', t.tabSubjects]];
  return (
    <View accessibilityRole="tablist" style={styles.tabBar}>
      {tabs.map(([key, label]) => (
        <Pressable key={key} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: active === key }} onPress={() => onChange(key)} style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
          {active === key && <View style={styles.tabIndicator} />}
          <Text style={[styles.tabText, active === key && styles.tabTextActive]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
