import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { mobileApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useBadges } from '@/stores/badges';
import { useAsync } from '@/lib/useAsync';
import { timeAgo } from '@/lib/format';
import { openLink } from '@/lib/deepLinks';
import { Avatar, Badge, Card, ErrorBox, H1, H2, Loading, P, Row, Screen, Small } from '@/components/ui';
import { useTheme } from '@/theme';

export default function HomeScreen() {
  const t = useTheme();
  const router = useRouter();
  const user = useAuthStore(s => s.user);
  const branding = useAuthStore(s => s.branding);
  const aiAgent = useAuthStore(s => s.aiAgent);
  const setBadges = useBadges(s => s.set);
  const { data, loading, error, refreshing, refresh, reload, refreshIfLoaded } = useAsync(async () => {
    const home = await mobileApi.home();
    setBadges(home.counts);
    return home;
  }, []);
  useFocusEffect(refreshIfLoaded);

  const first = (user?.name || '').split(' ')[0];
  const quick = [
    { label: 'New post', icon: 'create-outline' as const, href: '/forum/create' },
    { label: 'Share link', icon: 'share-social-outline' as const, href: '/share' },
    { label: 'Expense', icon: 'receipt-outline' as const, href: '/ledger/new' },
    { label: 'Search', icon: 'search-outline' as const, href: '/search' },
  ];

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <View>
          <Small>{branding?.companyName || 'Owtranet'}</Small>
          <H1 style={{ marginBottom: 0 }}>Hi {first || 'there'}</H1>
        </View>
        <Pressable onPress={() => router.push('/notifications')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="notifications-outline" size={26} color={t.text} />
          <Badge value={data?.counts.unread_notifications} />
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
        {quick.map(q => (
          <Pressable key={q.label} onPress={() => router.push(q.href as any)} style={{ flex: 1, backgroundColor: t.card, borderRadius: 14, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: t.border }}>
            <Ionicons name={q.icon} size={22} color={t.primary} />
            <Text style={{ color: t.text, fontSize: 12, fontWeight: '600', marginTop: 6 }}>{q.label}</Text>
          </Pressable>
        ))}
      </View>

      {aiAgent ? (
        <Pressable onPress={() => router.push('/call-ai')}>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderColor: t.primary }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="call" size={22} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontWeight: '700', fontSize: 16 }}>Call {aiAgent.name}</Text>
              <Text style={{ color: t.muted }}>Ask about posts and people, or dictate an update</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={t.muted} />
          </Card>
        </Pressable>
      ) : null}

      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : data ? (
        <>
          {data.counts.radio_unheard > 0 ? (
            <Pressable onPress={() => router.push('/(app)/(tabs)/radio')}>
              <Card style={{ backgroundColor: t.primary, borderColor: t.primary, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Ionicons name="radio" size={28} color="#fff" />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>{branding?.companyShortName || 'Company'} Radio</Text>
                  <Text style={{ color: '#e0e7ff' }}>{data.counts.radio_unheard} new {data.counts.radio_unheard === 1 ? 'story' : 'stories'} to listen to</Text>
                </View>
                <Ionicons name="play-circle" size={36} color="#fff" />
              </Card>
            </Pressable>
          ) : null}

          {data.pending_agreements.length > 0 ? (
            <Card style={{ borderColor: t.warning }}>
              <H2 style={{ marginTop: 0 }}>Action required</H2>
              {data.pending_agreements.map(a => (
                <Row key={a.id} icon="document-text-outline" title={a.title} subtitle={`v${a.version} · requested ${timeAgo(a.requested_at)}`} onPress={() => router.push(`/agreements/${a.id}` as any)} />
              ))}
            </Card>
          ) : null}

          <H2>Latest posts</H2>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {data.recent_posts.length === 0 ? <P muted style={{ padding: 16 }}>No posts yet.</P> : data.recent_posts.map(p => (
              <Row key={p.id} avatar={{ uri: p.avatar_url, name: p.author_name }} title={p.title}
                subtitle={`${p.author_name} · ${timeAgo(p.created_at)} · ${p.comment_count} ${p.comment_count === 1 ? 'reply' : 'replies'}`}
                onPress={() => router.push(`/forum/${p.slug}` as any)} />
            ))}
          </Card>

          {data.recent_conversations.length > 0 ? (
            <>
              <H2>Messages</H2>
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {data.recent_conversations.map(c => (
                  <Row key={c.conversation_id} avatar={{ uri: c.other_user_avatar, name: c.other_user_name }} title={c.other_user_name}
                    right={<Badge value={c.unread} />} onPress={() => router.push(`/messages/${c.conversation_id}` as any)} />
                ))}
              </Card>
            </>
          ) : null}

          {data.quicklinks.length > 0 ? (
            <>
              <H2>Quick links</H2>
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {data.quicklinks.map(q => <Row key={q.id} icon="link-outline" title={q.title} subtitle={q.description || q.url} onPress={() => openLink(q.url)} chevron={false} />)}
              </Card>
            </>
          ) : null}
        </>
      ) : null}
      <View style={{ height: 8 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
        <Avatar uri={user?.avatar_url} name={user?.name} size={22} /><Small>Signed in as {user?.email}</Small>
      </View>
    </Screen>
  );
}
