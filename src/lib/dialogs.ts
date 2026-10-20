import { Alert } from 'react-native';

export type DialogChoice<T extends string> = { label: string; value: T; destructive?: boolean };

/**
 * Promise wrapper around the native Alert. Resolves with the chosen value, or null
 * when the person taps the cancel button or dismisses the dialog (Android back).
 * Android shows at most three buttons, including the cancel button.
 */
export function ask<T extends string>(title: string, message: string, cancelLabel: string, choices: DialogChoice<T>[]): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T | null) => { if (!settled) { settled = true; resolve(value); } };
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: 'cancel', onPress: () => finish(null) },
        ...choices.map((choice) => ({ text: choice.label, style: choice.destructive ? 'destructive' as const : 'default' as const, onPress: () => finish(choice.value) })),
      ],
      { cancelable: true, onDismiss: () => finish(null) },
    );
  });
}
