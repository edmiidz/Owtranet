import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { mobileApi } from '@/api';

const TOKEN_KEY = 'intranet.pushToken';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true,
  }),
});

/**
 * Ask for permission, fetch the native FCM registration token and register it
 * with the workspace. Safe to call on every launch; failures are swallowed
 * (simulators, missing google-services.json, denied permission).
 */
export async function registerForPush(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 250, 250],
      });
    }
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;

    // Native FCM registration token — the server talks to FCM HTTP v1 directly,
    // so there is no Expo push service and no EAS project id in the loop.
    const tokenResponse = await Notifications.getDevicePushTokenAsync();
    const token = String(tokenResponse.data);
    await mobileApi.registerDevice({
      push_token: token,
      platform: Platform.OS,
      device_name: `${Device.manufacturer || ''} ${Device.modelName || ''}`.trim() || undefined,
      app_version: Constants.expoConfig?.version,
    });
    await AsyncStorage.setItem(TOKEN_KEY, token);
    return token;
  } catch (e) {
    console.warn('[push] registration skipped:', (e as Error).message);
    return null;
  }
}

export async function unregisterPush(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (token) { await mobileApi.unregisterDevice(token); await AsyncStorage.removeItem(TOKEN_KEY); }
  } catch { /* ignore */ }
}

/**
 * Deep link from a tapped notification, waiting for the (app) navigator.
 *
 * On a cold start the tap arrives while the root layout is still showing
 * <Loading /> (session not hydrated), i.e. before any navigator exists.
 * expo-router queues a router.push() made at that point and replays it as
 * soon as the root navigator mounts — against the initial `index` state and
 * racing the index → (tabs) redirect — which leaves an empty navigator: a
 * white screen (TestFlight, iOS DM pushes). So the root layout never navigates
 * for a notification; it parks the href here and `(app)/_layout.tsx` pushes it
 * once the app stack (with the tabs beneath it) is on screen. The same path
 * serves warm taps, where the (app) layout is already mounted.
 */
export const usePendingNotificationHref = create<{ href: string | null; set: (href: string | null) => void }>((set) => ({
  href: null,
  set: (href) => set({ href }),
}));

/** Park the tapped notification's target route; safe to call with null. */
export function queueNotificationResponse(resp: Notifications.NotificationResponse | null | undefined): void {
  const href = resp ? hrefForNotificationData(resp.notification.request.content.data) : null;
  if (href) usePendingNotificationHref.getState().set(href);
  // A response is handled once: otherwise it would replay every time the (app)
  // layout mounts (logout → login) or the root layout re-runs its effect.
  try { Notifications.clearLastNotificationResponse(); } catch { /* older native module */ }
}

/** Route a tapped notification to the right screen. Returns an expo-router href. */
export function hrefForNotificationData(data: any): string | null {
  if (!data) return null;
  if (data.kind === 'dm' && data.conversation_id) return `/messages/${data.conversation_id}`;
  if (data.kind === 'group' && data.group_id) return `/groups/${data.group_id}`;
  if (data.kind === 'notification') {
    if (typeof data.url === 'string' && data.url.startsWith('/forum/post/')) return data.url;
    if (data.post_slug) return `/forum/${data.post_slug}`;
    return '/notifications';
  }
  return null;
}
