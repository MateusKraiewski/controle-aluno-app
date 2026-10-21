import { Pressable, Text } from 'react-native';
import { useApp } from '../theme/AppContext';

type ChipProps = {
  label: string;
  selected?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
  /** For chips that show/hide a section. */
  accessibilityState?: { expanded?: boolean };
};

export function Chip({ label, selected = false, onPress, accessibilityLabel, disabled, accessibilityState }: ChipProps) {
  const { styles } = useApp();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled, ...accessibilityState }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{selected ? `✓ ${label}` : label}</Text>
    </Pressable>
  );
}
