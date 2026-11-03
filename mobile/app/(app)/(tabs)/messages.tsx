import React, { useCallback } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { groupChatApi, messagesApi } from '@/api';
import { useAsync } from '@/lib/useAsync';
import { timeAgo } from '@/lib/format';
import { Badge, Button, Card, Empty, ErrorBox, H2, Loading, Row, Screen, Small } from '@/components/ui';

export default function MessagesScreen() {
  const router = useRouter();
  const { data, loading, error, refreshing, refresh, reload } = useAsync(async () => {
    const [conversations, groups] = await Promise.all([messagesApi.conversations(), groupChatApi.groups().catch(() => [])]);
    return { conversations, groups };
  }, []);
  useFocusEffect(useCallback(() => { if (data) refresh(); }, [])); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Button title="New message" icon="create-outline" onPress={() => router.push('/messages/new')} style={{ marginBottom: 14 }} />
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : data ? (
        <>
          {data.groups.length > 0 ? (
            <>
              <H2>Groups</H2>
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {data.groups.map(g => (
                  <Row key={g.id} icon="people-outline" title={g.display_name}
                    subtitle={g.last_message ? `${g.last_sender_name ? g.last_sender_name + ': ' : ''}${g.last_message}` : g.description || ''}
                    right={<Badge value={g.unread_count} />} onPress={() => router.push(`/groups/${g.id}` as any)} />
                ))}
              </Card>
            </>
          ) : null}
          <H2>Direct messages</H2>
          {data.conversations.length === 0 ? <Empty icon="mail-outline" title="No conversations yet" hint="Start one with a team member." /> : (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {data.conversations.map(c => (
                <Row key={c.conversation_id} avatar={{ uri: c.other_user_avatar, name: c.other_user_name }} title={c.other_user_name}
                  subtitle={c.last_message ? `${c.last_message}` : ''}
                  right={<View style={{ alignItems: 'flex-end', gap: 4 }}><Badge value={c.unread_count} />{c.last_message_at ? <TimeText iso={c.last_message_at} /> : null}</View>}
                  onPress={() => router.push(`/messages/${c.conversation_id}` as any)} />
              ))}
            </Card>
          )}
        </>
      ) : null}
    </Screen>
  );
}

function TimeText({ iso }: { iso: string }) {
  return <Small>{timeAgo(iso)}</Small>;
}
