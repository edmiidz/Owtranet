import { useEffect } from 'react';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useColorScheme } from 'react-native';
import { mobileApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { usePendingNotificationHref } from '@/lib/push';
import { palette } from '@/theme';

export default function AppLayout() {
  const token = useAuthStore(s => s.token);
  const requiresAgreement = useAuthStore(s => s.requiresAgreement);

  // Re-sync the signed-in user (id, name, role, avatar…) from the server whenever
  // the app starts with a token. The iOS keychain keeps the token across a
  // reinstall/TestFlight update but AsyncStorage loses the cached user, which
  // left `user === null`: own messages rendered as someone else's and DM replies
  // were addressed to "yourself". Errors are ignored — a 401 already logs out.
  useEffect(() => {
    if (!token) return;
    mobileApi.bootstrap().then(b => {
      const { updateUser, setBranding, setAiAgent, setRequiresAgreement } = useAuthStore.getState();
      if (b.user) { updateUser(b.user); setRequiresAgreement(b.user.role === 'pending_agreement'); }
      if (b.branding) setBranding(b.branding);
      setAiAgent(b.ai_agent);
    }).catch(() => {});
  }, [token]);
  // A tapped push notification parks its route in usePendingNotificationHref
  // (root layout). Push it from here, where the app stack — with the tabs as
  // its first screen — is mounted, so the thread opens with a real back button
  // instead of an empty navigator (cold-start white screen).
  const router = useRouter();
  const pendingHref = usePendingNotificationHref(s => s.href);
  useEffect(() => {
    if (!token || requiresAgreement || !pendingHref) return;
    usePendingNotificationHref.getState().set(null);
    router.push(pendingHref as any);
  }, [token, requiresAgreement, pendingHref, router]);
  const scheme = useColorScheme();
  const t = scheme === 'dark' ? palette.dark : palette.light;
  if (!token) return <Redirect href="/login" />;
  if (requiresAgreement) return <Redirect href="/agreement" />;
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: t.card }, headerTintColor: t.text, headerTitleStyle: { fontWeight: '700' }, contentStyle: { backgroundColor: t.bg }, headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="forum/[slug]" options={{ title: 'Post' }} />
      <Stack.Screen name="forum/create" options={{ title: 'New post', presentation: 'modal' }} />
      <Stack.Screen name="messages/[conversationId]" options={{ title: 'Conversation' }} />
      <Stack.Screen name="messages/new" options={{ title: 'New message', presentation: 'modal' }} />
      <Stack.Screen name="groups/index" options={{ title: 'Group chat' }} />
      <Stack.Screen name="groups/[groupId]" options={{ title: 'Group' }} />
      <Stack.Screen name="members/index" options={{ title: 'Members' }} />
      <Stack.Screen name="members/[username]" options={{ title: 'Profile' }} />
      <Stack.Screen name="documents" options={{ title: 'Documents' }} />
      <Stack.Screen name="agreements/index" options={{ title: 'Agreements' }} />
      <Stack.Screen name="agreements/[assignmentId]" options={{ title: 'Sign agreement' }} />
      <Stack.Screen name="tasks/index" options={{ title: 'Tasks' }} />
      <Stack.Screen name="tasks/new" options={{ title: 'New task', presentation: 'modal' }} />
      <Stack.Screen name="tasks/[id]" options={{ title: 'Task' }} />
      <Stack.Screen name="ledger/index" options={{ title: 'Ledger' }} />
      <Stack.Screen name="ledger/new" options={{ title: 'New expense', presentation: 'modal' }} />
      <Stack.Screen name="ledger/[id]" options={{ title: 'Expense' }} />
      <Stack.Screen name="investments/index" options={{ title: 'Investment tracker' }} />
      <Stack.Screen name="investments/new" options={{ title: 'New deliverable', presentation: 'modal' }} />
      <Stack.Screen name="investments/[id]" options={{ title: 'Deliverable' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="profile" options={{ title: 'My profile' }} />
      <Stack.Screen name="share" options={{ title: 'Quick share', presentation: 'modal' }} />
      <Stack.Screen name="search" options={{ title: 'Search' }} />
      <Stack.Screen name="radio-settings" options={{ title: 'Radio settings', presentation: 'modal' }} />
      <Stack.Screen name="call-ai" options={{ title: 'Call', presentation: 'fullScreenModal', gestureEnabled: false }} />
    </Stack>
  );
}
