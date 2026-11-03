import React, { useEffect, useRef } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppState, useColorScheme } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useShareIntent } from 'expo-share-intent';
import { mobileApi } from '@/api';
import { ConversationProvider } from '@elevenlabs/react-native';
import { useAuthStore } from '@/stores/auth';
import { useBadges } from '@/stores/badges';
import { useRadio } from '@/stores/radio';
import { queueNotificationResponse, registerForPush } from '@/lib/push';
import { Loading } from '@/components/ui';
import { palette } from '@/theme';

export default function RootLayout() {
  const scheme = useColorScheme();
  const t = scheme === 'dark' ? palette.dark : palette.light;
  const hydrated = useAuthStore(s => s.hydrated);
  const token = useAuthStore(s => s.token);
  const hydrate = useAuthStore(s => s.hydrate);
  const refreshBadges = useBadges(s => s.refresh);
  const router = useRouter();
  const registered = useRef<string | null>(null);

  useEffect(() => { hydrate(); useRadio.getState().loadSettings(); }, [hydrate]);

  // Push registration + badge refresh whenever we have a session / come to foreground.
  useEffect(() => {
    if (!token) { registered.current = null; return; }
    refreshBadges();
    if (registered.current !== token) {
      registered.current = token;
      registerForPush();
      // Refresh workspace branding + feature info (e.g. the Call AI agent) for sessions that predate them.
      const { workspaceUrl, setBranding, setAiAgent } = useAuthStore.getState();
      mobileApi.config(workspaceUrl).then((cfg) => { setBranding(cfg); setAiAgent(cfg.ai_agent); }).catch(() => {});
    }
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') refreshBadges(); });
    const timer = setInterval(refreshBadges, 60_000);
    return () => { sub.remove(); clearInterval(timer); };
  }, [token, refreshBadges]);

  // Tapping a push notification deep-links into the app. Never navigate from
  // here: on a cold start no navigator exists yet (see usePendingNotificationHref);
  // the (app) layout consumes the parked href once it is mounted.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(queueNotificationResponse);
    try { queueNotificationResponse(Notifications.getLastNotificationResponse()); } catch { /* not available on this platform */ }
    const fg = Notifications.addNotificationReceivedListener(() => refreshBadges());
    return () => { sub.remove(); fg.remove(); };
  }, [refreshBadges]);

  // iOS share sheet / Android "Share to…" → Quick share screen (post or DM). Must live in the root layout (expo-router).
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ resetOnBackground: false });
  useEffect(() => {
    if (!hydrated || !hasShareIntent) return;
    const url = shareIntent.webUrl || (shareIntent.text && /^https?:\/\/\S+$/i.test(shareIntent.text.trim()) ? shareIntent.text.trim() : '');
    const text = shareIntent.text && shareIntent.text.trim() !== url ? shareIntent.text : '';
    const title = shareIntent.meta?.title || '';
    resetShareIntent();
    if (!token) return; // login first; the clipboard fallback on /share still helps afterwards
    // +native-intent.tsx already routed the share URL to /share; replace so the form gets the payload without stacking screens.
    router.replace({ pathname: '/share', params: { url, title, text } } as any);
  }, [hydrated, hasShareIntent, shareIntent, resetShareIntent, token, router]);

  if (!hydrated) return <Loading />;

  return (
    <ConversationProvider>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{
        headerStyle: { backgroundColor: t.card }, headerTintColor: t.text, headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: t.bg }, headerShadowVisible: false,
      }}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack>
    </ConversationProvider>
  );
}
