import React from 'react';
import { useRouter } from 'expo-router';
import { groupChatApi } from '@/api';
import { useAsync } from '@/lib/useAsync';
import { Badge, Card, Empty, ErrorBox, Loading, Row, Screen } from '@/components/ui';

export default function GroupsScreen() {
  const router = useRouter();
  const { data, loading, error, reload, refresh, refreshing } = useAsync(() => groupChatApi.groups(), []);
  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : !data?.length ? <Empty icon="people-outline" title="You're not in any groups" hint="An admin can add you to a group on the web intranet." /> : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {data.map(g => <Row key={g.id} icon="people-outline" title={g.display_name} subtitle={g.last_message ? `${g.last_sender_name ? g.last_sender_name + ': ' : ''}${g.last_message}` : g.description || ''} right={<Badge value={g.unread_count} />} onPress={() => router.push(`/groups/${g.id}` as any)} />)}
        </Card>
      )}
    </Screen>
  );
}
