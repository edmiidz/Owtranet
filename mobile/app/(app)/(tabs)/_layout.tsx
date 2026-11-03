import React from 'react';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { useBadges } from '@/stores/badges';

export default function TabsLayout() {
  const t = useTheme();
  const b = useBadges();
  const router = useRouter();
  const icon = (name: keyof typeof Ionicons.glyphMap, focusedName: keyof typeof Ionicons.glyphMap) =>
    ({ color, focused }: { color: any; focused: boolean }) => <Ionicons name={focused ? focusedName : name} size={24} color={color} />;
  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: t.primary, tabBarInactiveTintColor: t.muted,
      tabBarStyle: { backgroundColor: t.tabBar, borderTopColor: t.border },
      headerStyle: { backgroundColor: t.card }, headerTintColor: t.text, headerTitleStyle: { fontWeight: '700' }, headerShadowVisible: false,
      sceneStyle: { backgroundColor: t.bg },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home-outline', 'home'), tabBarBadge: b.unread_notifications || undefined }} />
      <Tabs.Screen name="forum" options={{ title: 'Forum', tabBarIcon: icon('chatbubbles-outline', 'chatbubbles') }} />
      <Tabs.Screen name="radio" options={{ title: 'Radio', tabBarIcon: icon('radio-outline', 'radio'), tabBarBadge: b.radio_unheard || undefined }} />
      <Tabs.Screen name="messages" options={{ title: 'Messages', tabBarIcon: icon('mail-outline', 'mail'), tabBarBadge: b.unread_messages || undefined }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('grid-outline', 'grid'), tabBarBadge: b.pending_agreements || undefined }}
        listeners={{ tabLongPress: () => router.push('/accounts') }} />
    </Tabs>
  );
}
