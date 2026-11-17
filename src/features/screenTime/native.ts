// Bridge to the local native module in modules/screen-time (Android only). Reads the
// phone's own usage events on the device; nothing is stored in SQLite or sent anywhere.
import { requireOptionalNativeModule } from 'expo';
import type { DayUsage } from './domain';

type ScreenTimeNative = {
  hasAccess(): boolean;
  openAccessSettings(): void;
  getUsageAsync(startMs: number, endMs: number): Promise<DayUsage>;
  getIconAsync(packageName: string): Promise<string | null>;
};

const native = requireOptionalNativeModule<ScreenTimeNative>('ScreenTime');

export const screenTimeAvailable = native !== null;

export function hasUsageAccess(): boolean {
  return native?.hasAccess() ?? false;
}

export function openUsageAccessSettings(): void {
  native?.openAccessSettings();
}

export async function readUsage(startMs: number, endMs: number): Promise<DayUsage> {
  if (!native) return { apps: [], unlocks: 0 };
  return native.getUsageAsync(startMs, endMs);
}

export async function readIcon(packageName: string): Promise<string | null> {
  return native ? native.getIconAsync(packageName) : null;
}
