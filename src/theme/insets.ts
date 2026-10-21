import { Platform, StatusBar } from 'react-native';

/**
 * Top inset for Android, where Android 15 draws apps edge to edge under the status bar.
 * iOS keeps using SafeAreaView. Avoids a native dependency whose C++ paths exceed
 * Windows' 260-character limit when building the APK locally.
 */
export const androidTopInset = Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 0;
