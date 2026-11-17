import { Modal, Pressable, ScrollView, Text, View, SafeAreaView } from 'react-native';
import { androidTopInset } from '../theme/insets';
import { ModalHeader } from '../components/ModalHeader';
import { DataSettings } from './DataSettings';
import { ReminderSettings } from './ReminderSettings';
import { ScreenTimeModal } from './ScreenTimeModal';
import { useState } from 'react';
import type { Language, ThemePreference } from '../lib/preferences';
import { useApp } from '../theme/AppContext';

const LANGUAGES: [Language, string][] = [['pt-BR', 'Português (Brasil)'], ['pt-PT', 'Português (Portugal)'], ['en', 'English'], ['es', 'Español']];

type SettingsModalProps = {
  visible: boolean;
  themePreference: ThemePreference;
  onClose: () => void;
  onLanguage: (language: Language) => void;
  onTheme: (theme: ThemePreference) => void;
  /** Called after a restore or erase so visible screens re-read local data. */
  onDataChanged: () => void;
  remindersEnabled: boolean;
  onReminders: (enabled: boolean) => void;
};

export function SettingsModal({ visible, themePreference, onClose, onLanguage, onTheme, onDataChanged, remindersEnabled, onReminders }: SettingsModalProps) {
  const { styles, t, language, modalAnimation } = useApp();
  const [screenTime, setScreenTime] = useState(false);
  const themes: [ThemePreference, string][] = [['system', t.system], ['light', t.light], ['dark', t.dark]];
  return (
    <Modal visible={visible} animationType={modalAnimation} presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.modalSafe, { paddingTop: androidTopInset }]} accessibilityViewIsModal>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <ModalHeader eyebrow={t.settings} title={t.settings} onClose={onClose} />
          <Pressable accessibilityRole="button" accessibilityHint={t.screenMenuHint} onPress={() => setScreenTime(true)}
            style={({ pressed }) => [styles.secondaryButton, { marginBottom: 6 }, pressed && styles.pressed]}>
            <Text style={styles.secondaryButtonText}>{t.screenMenu}</Text>
          </Pressable>
          <Text style={styles.info}>{t.screenMenuHint}</Text>
          <Text accessibilityRole="header" style={styles.fieldLabel}>{t.language}</Text>
          <View accessibilityRole="radiogroup" accessibilityLabel={t.language}>
            {LANGUAGES.map(([value, label]) => (
              <Pressable key={value} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: language === value }} onPress={() => onLanguage(value)}
                style={({ pressed }) => [styles.option, language === value && styles.optionSelected, pressed && styles.pressed]}>
                <Text style={[styles.optionText, language === value && styles.optionTextSelected]}>{language === value ? `✓ ${label}` : label}</Text>
              </Pressable>
            ))}
          </View>
          <Text accessibilityRole="header" style={[styles.fieldLabel, styles.themeLabel]}>{t.theme}</Text>
          <View accessibilityRole="radiogroup" accessibilityLabel={t.theme}>
            {themes.map(([value, label]) => (
              <Pressable key={value} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: themePreference === value }} onPress={() => onTheme(value)}
                style={({ pressed }) => [styles.option, themePreference === value && styles.optionSelected, pressed && styles.pressed]}>
                <Text style={[styles.optionText, themePreference === value && styles.optionTextSelected]}>{themePreference === value ? `✓ ${label}` : label}</Text>
              </Pressable>
            ))}
          </View>
          <ReminderSettings enabled={remindersEnabled} onEnabled={onReminders} visible={visible} />
          <DataSettings onChanged={onDataChanged} />
        </ScrollView>
        <ScreenTimeModal visible={screenTime} onClose={() => setScreenTime(false)} />
      </SafeAreaView>
    </Modal>
  );
}
