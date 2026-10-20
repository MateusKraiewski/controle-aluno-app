import { Pressable, Text, View } from 'react-native';
import { useApp } from '../theme/AppContext';

export function ModalHeader({ eyebrow, title, onClose }: { eyebrow: string; title: string; onClose: () => void }) {
  const { styles, t } = useApp();
  return (
    <View style={styles.formHeading}>
      <View style={{ flex: 1 }}>
        <Text style={styles.sectionEyebrow}>{eyebrow}</Text>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t.close} onPress={onClose} hitSlop={8}>
        <Text style={styles.close}>{t.close}</Text>
      </Pressable>
    </View>
  );
}
