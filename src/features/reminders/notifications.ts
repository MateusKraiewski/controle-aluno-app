// Turns the planned reminders into local notifications (no server, no internet).
// Every sync cancels what was scheduled and plans again from the local database, so a
// lesson whose notes were just written, a lesson cancelled by a holiday or a new
// timetable is reflected the next time the app writes data or comes to the front.
import * as Notifications from 'expo-notifications';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';
import type { Translations } from '../../lib/locales';
import { addDays, toMoment } from '../lessons/domain';
import { LOOKAHEAD_DAYS, LOOKBACK_DAYS, NAG_LEVELS, planReminders, reminderText } from './domain';
import { listReminderLessons } from './repository';

const CHANNEL_ID = 'lesson-notes';
const KIND = 'lesson-notes';

export type ReminderPermission = 'granted' | 'denied' | 'undetermined';

let handlerInstalled = false;

/** Shows reminders even while the app is open. Safe to call more than once. */
export function installReminderHandler() {
  if (handlerInstalled) return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

async function ensureChannel(t: Translations) {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: t.remindersChannel,
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 150, 250],
    lightColor: '#243d34',
  });
}

export async function getReminderPermission(): Promise<ReminderPermission> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
}

/** Asks Android 13+ for the notification permission (the channel must exist first). */
export async function requestReminderPermission(t: Translations): Promise<ReminderPermission> {
  await ensureChannel(t);
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
}

function toDate(localDate: string, minute: number): Date {
  const [year, month, day] = localDate.split('-').map(Number);
  return new Date(year, month - 1, day, Math.floor(minute / 60), minute % 60, 0, 0);
}

function lessonIdsOf(data: unknown): number[] {
  if (!data || typeof data !== 'object' || (data as { kind?: unknown }).kind !== KIND) return [];
  const ids = (data as { lessonIds?: unknown }).lessonIds;
  return Array.isArray(ids) ? ids.filter((id): id is number => typeof id === 'number') : [];
}

/** Lesson to open when a reminder is tapped, or null for other notifications. */
export function lessonIdFromResponse(response: Notifications.NotificationResponse | null | undefined): number | null {
  const data = response?.notification.request.content.data;
  if (!data || (data as { kind?: unknown }).kind !== KIND) return null;
  const id = (data as { lessonId?: unknown }).lessonId;
  return typeof id === 'number' ? id : null;
}

let queue: Promise<void> = Promise.resolve();

/** Replans every reminder. Calls are serialised so overlapping syncs never double-schedule. */
export function syncReminders(db: SQLiteDatabase, t: Translations, enabled: boolean): Promise<void> {
  const run = queue.then(() => doSync(db, t, enabled));
  queue = run.catch(() => undefined);
  return run;
}

async function doSync(db: SQLiteDatabase, t: Translations, enabled: boolean) {
  await Notifications.cancelAllScheduledNotificationsAsync();
  const now = toMoment(new Date());
  const lessons = await listReminderLessons(db, addDays(now.localDate, -LOOKBACK_DAYS), addDays(now.localDate, LOOKAHEAD_DAYS));

  // Take reminders already in the tray away once their lessons have notes (or were cancelled).
  const stillPending = new Set(lessons.filter((lesson) => lesson.status === 'planned' && lesson.attendance !== 'absent' && !lesson.hasNotes).map((lesson) => lesson.id));
  const presented = await Notifications.getPresentedNotificationsAsync();
  for (const notification of presented) {
    const ids = lessonIdsOf(notification.request.content.data);
    if (ids.length > 0 && (!enabled || ids.every((id) => !stillPending.has(id)))) {
      await Notifications.dismissNotificationAsync(notification.request.identifier);
    }
  }

  if (!enabled || (await getReminderPermission()) !== 'granted') return;
  await ensureChannel(t);
  const nowMs = Date.now();
  for (const reminder of planReminders(lessons, now)) {
    const date = toDate(reminder.at.localDate, reminder.at.minute);
    if (date.getTime() <= nowMs) continue;
    const { title, body } = reminderText(t, reminder);
    await Notifications.scheduleNotificationAsync({
      content: {
        title, body,
        data: { kind: KIND, lessonId: reminder.lessonId, lessonIds: reminder.lessonIds, level: reminder.level },
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: CHANNEL_ID },
    });
  }
}

/** Shows the most dramatic reminder a few seconds from now, to try the feature. */
export async function sendTestReminder(t: Translations, subject: string) {
  await ensureChannel(t);
  const { title, body } = reminderText(t, { level: NAG_LEVELS - 1, subject, pendingCount: 1 });
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: { kind: 'test' } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5, channelId: CHANNEL_ID },
  });
}
