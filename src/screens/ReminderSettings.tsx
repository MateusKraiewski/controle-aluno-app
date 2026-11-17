import { useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { ErrorText } from '../components/ErrorText';
import { getReminderPermission, sendTestReminder } from '../features/reminders/notifications';
import type { ReminderPermission } from '../features/reminders/notifications';
import { useApp } from '../theme/AppContext';

type ReminderSettingsProps = {
  enabled: boolean;
  onEnabled: (enabled: boolean) => void;
  /** Re-checked when the settings screen opens. */
  visible: boolean;
};

/** On/off switch for the lesson-notes reminders, Android permission state and a test button. */
export function ReminderSettings({ enabled, onEnabled, visible }: ReminderSettingsProps) {
  const { styles, t } = useApp();
  const [permission, setPermission] = useState<ReminderPermission>('undetermined');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    setMessage('');
    getReminderPermission().then(setPermission).catch(() => undefined);
  }, [visible, enabled]);

  async function test() {
    setError('');
    try {
      await sendTestReminder(t, t.remindersTestSubject);
      setMessage(t.remindersTestSent);
    } catch {
      setError(t.remindersError);
    }
  }

  const options: [boolean, string][] = [[true, t.remindersOn], [false, t.remindersOff]];
  return (
    <View>
      <Text accessibilityRole="header" style={[styles.fieldLabel, styles.themeLabel]}>{t.remindersTitle}</Text>
      <Text style={styles.info}>{t.remindersHint}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={t.remindersTitle}>
        {options.map(([value, label]) => (
          <Pressable key={label} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: enabled === value }} onPress={() => onEnabled(value)}
            style={({ pressed }) => [styles.option, enabled === value && styles.optionSelected, pressed && styles.pressed]}>
            <Text style={[styles.optionText, enabled === value && styles.optionTextSelected]}>{enabled === value ? `✓ ${label}` : label}</Text>
          </Pressable>
        ))}
      </View>
      {enabled && permission === 'denied' && (
        <>
          <Text accessibilityLiveRegion="polite" style={styles.info}>{t.remindersBlocked}</Text>
          <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
            <Text style={styles.secondaryButtonText}>{t.remindersOpenSettings}</Text>
          </Pressable>
        </>
      )}
      {enabled && permission === 'granted' && (
        <Pressable accessibilityRole="button" onPress={() => void test()} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
          <Text style={styles.secondaryButtonText}>{t.remindersTest}</Text>
        </Pressable>
      )}
      {!!message && <Text accessibilityLiveRegion="polite" style={styles.info}>{message}</Text>}
      <ErrorText message={error} />
    </View>
  );
}
