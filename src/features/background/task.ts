import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { i18n } from '@/i18n';

import { checkRouters } from './check';

/** AP-5 (design §19): the periodic check, defined at load time (the entry file imports this module). */
export const CHECK_TASK = 'routelink-router-check';
export const CHANNEL = 'router-alerts';

export async function notify(title: string, body: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    // Immediate; on Android through the alerts channel.
    trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
  });
}

TaskManager.defineTask(CHECK_TASK, async () => {
  try {
    await checkRouters({ notify });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Registered while at least one router is watched. Every 15 minutes is the shortest the systems allow. */
export async function syncBackgroundCheck(enabled: boolean): Promise<void> {
  const registered = await TaskManager.isTaskRegisteredAsync(CHECK_TASK);
  if (enabled && !registered) await BackgroundTask.registerTaskAsync(CHECK_TASK, { minimumInterval: 15 });
  else if (!enabled && registered) await BackgroundTask.unregisterTaskAsync(CHECK_TASK);
}

/** At app start: how notifications show while the app is open, and Android's channel. */
export async function setupNotifications(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: i18n.t('settings:notify.section'),
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
}

/** Asks once; afterwards only the system settings can change it. */
export async function allowNotifications(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}
