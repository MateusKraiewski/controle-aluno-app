import { Modal, Pressable, SafeAreaView, ScrollView, Text } from 'react-native';
import { ModalHeader } from '../components/ModalHeader';
import { DataSettings } from './DataSettings';
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
};

export function SettingsModal({ visible, themePreference, onClose, onLanguage, onTheme, onDataChanged }: SettingsModalProps) {
  const { styles, t, language } = useApp();
  const themes: [ThemePreference, string][] = [['system', t.system], ['light', t.light], ['dark', t.dark]];
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalSafe}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <ModalHeader eyebrow={t.settings} title={t.settings} onClose={onClose} />
          <Text style={styles.fieldLabel}>{t.language}</Text>
          {LANGUAGES.map(([value, label]) => (
            <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: language === value }} onPress={() => onLanguage(value)} style={[styles.option, language === value && styles.optionSelected]}>
              <Text style={[styles.optionText, language === value && styles.optionTextSelected]}>{label}</Text>
            </Pressable>
          ))}
          <Text style={[styles.fieldLabel, styles.themeLabel]}>{t.theme}</Text>
          {themes.map(([value, label]) => (
            <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: themePreference === value }} onPress={() => onTheme(value)} style={[styles.option, themePreference === value && styles.optionSelected]}>
              <Text style={[styles.optionText, themePreference === value && styles.optionTextSelected]}>{label}</Text>
            </Pressable>
          ))}
          <DataSettings onChanged={onDataChanged} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
