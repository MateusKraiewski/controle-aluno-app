import { Pressable, Text } from 'react-native';
import { useApp } from '../theme/AppContext';

type ChipProps = {
  label: string;
  selected?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
};

export function Chip({ label, selected = false, onPress, accessibilityLabel, disabled }: ChipProps) {
  const { styles } = useApp();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}
