import React, { useEffect } from 'react';
import { Pressable } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';

type HomeTab = '/(app)/(tabs)' | '/(app)/(tabs)/forum' | '/(app)/(tabs)/messages';

/**
 * Screens reached via replace or a deep link (share sheet, push notification) are the
 * root of the stack, so iOS draws no back chevron and the user is stuck. When there is
 * nothing to go back to, show a chevron that lands on the given tab instead.
 */
export function useBackFallback(tab: HomeTab) {
  const nav = useNavigation();
  const router = useRouter();
  const t = useTheme();
  useEffect(() => {
    if (nav.canGoBack()) return;
    nav.setOptions({
      headerLeft: () => (
        <Pressable onPress={() => router.replace(tab as any)} hitSlop={12} style={{ paddingHorizontal: 4 }}>
          <Ionicons name="chevron-back" size={26} color={t.text} />
        </Pressable>
      ),
    });
  }, [nav, router, tab, t.text]);
}
