import React from 'react';
import { useRouter } from 'expo-router';
import { notificationsApi } from '@/api';
import { useBadges } from '@/stores/badges';
import { useAsync } from '@/lib/useAsync';
import { timeAgo } from '@/lib/format';
import { Button, Card, Empty, ErrorBox, Loading, Row, Screen } from '@/components/ui';
import { useTheme } from '@/theme';
import { View } from 'react-native';

const ICONS: Record<string, any> = { mention: 'at-outline', post_reply: 'chatbubble-outline', like: 'heart-outline', system: 'information-circle-outline', direct_message: 'mail-outline', deliverable: 'trending-up-outline', agreement: 'document-text-outline' };

export default function NotificationsScreen() {
  const t = useTheme();
  const router = useRouter();
  const refreshBadges = useBadges(s => s.refresh);
  const { data, loading, error, reload, refresh, refreshing } = useAsync(() => notificationsApi.list(), []);

  function hrefFor(n: any): string | null {
    let d: any = n.data; try { if (typeof d === 'string') d = JSON.parse(d); } catch { d = null; }
    if (d?.conversation_id) return `/messages/${d.conversation_id}`;
    if (d?.post_slug) return `/forum/${d.post_slug}`;
    if (typeof d?.url === 'string' && d.url.startsWith('/forum/post/')) return `/forum/${d.url.split('/').pop()}`;
    if (d?.deliverable_id) return `/investments/${d.deliverable_id}`;
    if (d?.assignment_id) return `/agreements/${d.assignment_id}`;
    return null;
  }

  async function open(n: any) {
    if (!n.is_read) { notificationsApi.markRead(n.id).catch(() => {}); refreshBadges(); }
    const href = hrefFor(n);
    if (href) router.push(href as any); else refresh();
  }

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Button title="Mark all as read" variant="secondary" onPress={async () => { await notificationsApi.markAllRead().catch(() => {}); refresh(); refreshBadges(); }} style={{ marginBottom: 12 }} />
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : !data?.length ? <Empty icon="notifications-off-outline" title="No notifications" /> : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {data.map(n => (
            <View key={n.id} style={{ backgroundColor: n.is_read ? undefined : t.chip }}>
              <Row icon={ICONS[n.type] || 'notifications-outline'} title={n.title || n.type} subtitle={`${n.message || ''} · ${timeAgo(n.created_at)}`} onPress={() => open(n)} chevron={!!hrefFor(n)} />
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
