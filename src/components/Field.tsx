import { Text, TextInput, View } from 'react-native';
import type { KeyboardTypeOptions } from 'react-native';
import { useApp } from '../theme/AppContext';

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
};

export function Field({ label, value, onChangeText, placeholder, multiline, keyboardType, maxLength }: FieldProps) {
  const { styles, palette } = useApp();
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.placeholder}
        keyboardType={keyboardType ?? 'default'}
        multiline={multiline}
        maxLength={maxLength}
        style={[styles.input, multiline && styles.multiline]}
      />
    </View>
  );
}
