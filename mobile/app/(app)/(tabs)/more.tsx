import React from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/stores/auth';
import { useBadges } from '@/stores/badges';
import { useRadio } from '@/stores/radio';
import { unregisterPush } from '@/lib/push';
import { openExternal } from '@/lib/files';
import { Avatar, Badge, Button, Card, H2, P, Row, Screen, Small } from '@/components/ui';

export default function MoreScreen() {
  const router = useRouter();
  const { user, workspaceUrl, branding, aiAgent, logout } = useAuthStore();
  const b = useBadges();

  async function signOut() {
    Alert.alert('Sign out', 'Sign out of this workspace on this device?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => { useRadio.getState().stop(); await unregisterPush(); await logout(); router.replace('/login'); } },
    ]);
  }

  return (
    <Screen>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Avatar uri={user?.avatar_url} name={user?.name} size={52} />
        <View style={{ flex: 1 }}>
          <P style={{ fontWeight: '700', fontSize: 17 }}>{user?.name}</P>
          <Small>{user?.position || user?.role}{user?.department ? ` · ${user.department}` : ''}</Small>
        </View>
        <Button title="Edit" variant="secondary" onPress={() => router.push('/profile')} />
      </Card>

      <H2>Team</H2>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {aiAgent ? <Row icon="call-outline" title={`Call ${aiAgent.name}`} subtitle="Voice call with the intranet AI assistant" onPress={() => router.push('/call-ai')} /> : null}
        <Row icon="people-outline" title="Members" subtitle="Directory and profiles" onPress={() => router.push('/members')} />
        <Row icon="chatbubble-ellipses-outline" title="Group chat" onPress={() => router.push('/groups')} />
        <Row icon="notifications-outline" title="Notifications" right={<Badge value={b.unread_notifications} />} onPress={() => router.push('/notifications')} />
        <Row icon="search-outline" title="Search" subtitle="Posts, comments, people, investments" onPress={() => router.push('/search')} />
      </Card>

      <H2>Work</H2>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <Row icon="checkmark-done-outline" title="Tasks" subtitle="Assigned to you and the team" right={<Badge value={b.open_tasks} />} onPress={() => router.push('/tasks')} />
        <Row icon="folder-open-outline" title="Documents" subtitle="Files shared on posts and deliverables" onPress={() => router.push('/documents')} />
        <Row icon="document-text-outline" title="Agreements" subtitle="E-sign and review" right={<Badge value={b.pending_agreements} />} onPress={() => router.push('/agreements')} />
        <Row icon="receipt-outline" title="Expenses (Ledger)" subtitle="Receipts and reimbursements" onPress={() => router.push('/ledger')} />
        <Row icon="trending-up-outline" title="Investment tracker" subtitle="Deliverables and sweat equity" onPress={() => router.push('/investments')} />
        <Row icon="share-social-outline" title="Quick share" subtitle="Post a link from your clipboard" onPress={() => router.push('/share')} />
      </Card>

      <H2>Workspace</H2>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <Row icon="globe-outline" title={branding?.companyName || 'Intranet'} subtitle={workspaceUrl} onPress={() => openExternal(workspaceUrl)} chevron={false} />
        <Row icon="radio-outline" title="Radio settings" onPress={() => router.push('/radio-settings')} />
        <Row icon="log-out-outline" title="Sign out" onPress={signOut} chevron={false} />
      </Card>
      <Small style={{ textAlign: 'center', marginTop: 10 }}>Intranet mobile · v1.0.0</Small>
    </Screen>
  );
}
