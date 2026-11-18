import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, type Account } from '@/stores/auth';
import { addAccount, signOutActiveAccount, switchToAccount } from '@/lib/accounts';
import { Avatar, Card, Screen, Small } from '@/components/ui';
import { spacing, useTheme } from '@/theme';

/** Instagram-style account switcher (Owtranet#6): one row per signed-in workspace + user. */
export default function AccountsScreen() {
  const t = useTheme();
  const router = useRouter();
  const accounts = useAuthStore(s => s.accounts);
  const activeKey = useAuthStore(s => s.activeKey);
  const [busy, setBusy] = useState<string | null>(null);

  async function pick(a: Account) {
    if (a.key === activeKey) { router.back(); return; }
    setBusy(a.key);
    try { await switchToAccount(a.key); } finally { setBusy(null); }
  }

  function signOut() {
    const others = accounts.length - 1;
    Alert.alert('Sign out', others > 0
      ? `Sign out of this account? You'll stay signed in to ${others === 1 ? 'your other account' : `your ${others} other accounts`}.`
      : 'Sign out of this workspace on this device?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => { signOutActiveAccount(); } },
    ]);
  }

  return (
    <Screen>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {accounts.map(a => {
          const active = a.key === activeKey;
          const host = a.workspaceUrl.replace(/^https?:\/\//, '');
          return (
            <Pressable key={a.key} onPress={() => pick(a)} disabled={!!busy}
              style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.chip : t.card, borderBottomColor: t.border }]}>
              <Avatar uri={a.user?.avatar_url} name={a.user?.name || host} size={44} workspaceUrl={a.workspaceUrl} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: t.text, fontSize: 15.5, fontWeight: '600' }}>{a.user?.name || a.user?.email || 'Signed in'}</Text>
                <Text numberOfLines={1} style={{ color: t.muted, fontSize: 13, marginTop: 2 }}>{a.branding?.companyName ? `${a.branding.companyName} · ${host}` : host}</Text>
              </View>
              {busy === a.key ? <ActivityIndicator color={t.primary} />
                : active ? <Ionicons name="checkmark-circle" size={24} color={t.primary} /> : null}
            </Pressable>
          );
        })}
        <Pressable onPress={() => { addAccount(); }} disabled={!!busy}
          style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.chip : t.card, borderBottomColor: t.border }]}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="add" size={26} color={t.chipText} />
          </View>
          <Text style={{ flex: 1, color: t.text, fontSize: 15.5, fontWeight: '600' }}>Add account</Text>
        </Pressable>
      </Card>
      <Pressable onPress={signOut} disabled={!!busy} style={{ alignItems: 'center', paddingVertical: 14 }}>
        <Text style={{ color: t.danger, fontWeight: '600', fontSize: 15 }}>Sign out of this account</Text>
      </Pressable>
      <Small style={{ textAlign: 'center' }}>Add another workspace, or another user on the same one. Only the active account gets notifications.</Small>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
});
