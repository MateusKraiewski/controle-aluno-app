import { Text } from 'react-native';
import { useApp } from '../theme/AppContext';

export function ErrorText({ message }: { message: string }) {
  const { styles } = useApp();
  if (!message) return null;
  return <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{message}</Text>;
}
