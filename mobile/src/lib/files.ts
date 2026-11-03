import * as WebBrowser from 'expo-web-browser';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { Alert, Linking } from 'react-native';
import { absoluteUrl } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

/** Open a public /uploads path in the in-app browser. */
export async function openPublicFile(path?: string | null) {
  const url = absoluteUrl(path);
  if (!url) return;
  try { await WebBrowser.openBrowserAsync(url); } catch { Linking.openURL(url).catch(() => {}); }
}

/** Download an auth-protected file (e.g. /api/deliverables/documents/x) and hand it to the share sheet. */
export async function downloadAndShare(path: string, filename: string) {
  const url = absoluteUrl(path)!;
  const { token } = useAuthStore.getState();
  try {
    const dest = new File(Paths.cache, filename.replace(/[^\w.\-]+/g, '_'));
    const out = await File.downloadFileAsync(url, dest, { headers: { Authorization: `Bearer ${token}` } });
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(out.uri);
    else Alert.alert('Downloaded', out.uri);
  } catch (e) {
    Alert.alert('Download failed', (e as Error).message);
  }
}

export function openExternal(url: string) {
  Linking.openURL(url).catch(() => Alert.alert('Cannot open link', url));
}
