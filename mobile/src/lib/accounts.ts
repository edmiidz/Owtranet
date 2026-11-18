import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth';
import { useBadges } from '@/stores/badges';
import { useRadio } from '@/stores/radio';
import { unregisterPush, usePendingNotificationHref } from '@/lib/push';

/**
 * Account switching (Owtranet#6). Only the active account is "signed in" as far
 * as its server knows: before the session changes, stop the radio, drop the
 * cached counts and unregister this device's push token with the outgoing
 * account's server (the root layout registers it with the new one). Push tokens
 * are per install, not per account, so this is what keeps another account's
 * notifications off the screen.
 */
async function leaveActiveAccount(): Promise<void> {
  const radio = useRadio.getState();
  radio.stop();
  useRadio.setState({ feed: null, queue: [], index: 0, loops: 0, error: null });
  usePendingNotificationHref.getState().set(null);
  if (useAuthStore.getState().token) await unregisterPush();
  useBadges.getState().set({ unread_notifications: 0, unread_messages: 0, pending_agreements: 0, open_tasks: 0, radio_unheard: 0 });
}

export async function switchToAccount(key: string): Promise<void> {
  if (key === useAuthStore.getState().activeKey) return;
  await leaveActiveAccount();
  await useAuthStore.getState().switchAccount(key);
  router.replace(useAuthStore.getState().requiresAgreement ? '/agreement' : '/(app)/(tabs)');
}

/** Show the login screen for another workspace/user without signing out of this one. */
export async function addAccount(): Promise<void> {
  await leaveActiveAccount();
  useAuthStore.getState().beginAddAccount();
  router.replace('/login');
}

/** Back from the login screen to the account that was active before "Add account". */
export async function cancelAddAccount(): Promise<void> {
  await useAuthStore.getState().cancelAddAccount();
  router.replace('/(app)/(tabs)');
}

/** Sign out of the active account; land on the next signed-in account, or the login screen. */
export async function signOutActiveAccount(): Promise<void> {
  await leaveActiveAccount();
  await useAuthStore.getState().logout();
  const { token, requiresAgreement } = useAuthStore.getState();
  router.replace(!token ? '/login' : requiresAgreement ? '/agreement' : '/(app)/(tabs)');
}
