import React from 'react';
import { Alert, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { messagesApi, usersApi } from '@/api';
import { errorMessage } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useAsync } from '@/lib/useAsync';
import { formatDate } from '@/lib/format';
import { openExternal } from '@/lib/files';
import { Avatar, Button, Card, ErrorBox, Loading, P, Row, Screen, Small } from '@/components/ui';
import { LinkifiedText } from '@/components/LinkifiedText';
import { useTheme } from '@/theme';

// Matches the web profile's violet agent Message button (Tailwind violet-600).
const AGENT_VIOLET = '#7c3aed';

export default function MemberScreen() {
  const t = useTheme();
  const router = useRouter();
  const me = useAuthStore(s => s.user);
  const { username } = useLocalSearchParams<{ username: string }>();
  const { data: u, loading, error, reload } = useAsync(() => usersApi.get(String(username)), [username]);

  async function message() {
    if (!u) return;
    try {
      const convs = await messagesApi.conversations();
      const existing = convs.find(c => c.other_user_id === u.id);
      if (existing) router.push(`/messages/${existing.conversation_id}` as any);
      else router.push({ pathname: '/messages/new', params: { to: String(u.id), name: u.name } } as any);
    } catch (e) { Alert.alert('Error', errorMessage(e)); }
  }

  const isAgent = u?.account_type === 'ai_agent';

  return (
    <Screen>
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : u ? (
        <>
          <View style={{ alignItems: 'center', marginBottom: 14 }}>
            <Avatar uri={u.avatar_url} name={u.name} size={88} />
            <Text style={{ color: t.text, fontSize: 22, fontWeight: '800', marginTop: 10 }}>{u.name}</Text>
            <Small>{isAgent ? `AI agent${u.ai_agent?.tagline ? ` · ${u.ai_agent.tagline}` : ''}` : [u.position, u.department, u.company].filter(Boolean).join(' · ') || u.role}</Small>
          </View>
          {u.id !== me?.id ? <Button title={isAgent ? `Message ${u.name}` : 'Message'} icon={isAgent ? 'sparkles-outline' : 'mail-outline'} onPress={message} style={[{ marginBottom: 14 }, isAgent && { backgroundColor: AGENT_VIOLET }]} /> : <Button title="Edit my profile" variant="secondary" onPress={() => router.push('/profile')} style={{ marginBottom: 14 }} />}
          {u.bio ? <Card><P><LinkifiedText text={u.bio} /></P></Card> : null}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <Row icon="mail-outline" title={u.email} subtitle="Email" onPress={() => openExternal(`mailto:${u.email}`)} chevron={false} />
            {u.company_email ? <Row icon="at-outline" title={u.company_email} subtitle="Company email" onPress={() => openExternal(`mailto:${u.company_email}`)} chevron={false} /> : null}
            {u.telephone ? <Row icon="call-outline" title={u.telephone} subtitle="Phone" onPress={() => openExternal(`tel:${u.telephone}`)} chevron={false} /> : null}
            {u.github_username ? <Row icon="logo-github" title={u.github_username} subtitle="GitHub" onPress={() => openExternal(`https://github.com/${u.github_username}`)} chevron={false} /> : null}
            {u.calendar_link ? <Row icon="calendar-outline" title="Book time" subtitle={u.calendar_link} onPress={() => openExternal(u.calendar_link!)} chevron={false} /> : null}
            {u.intranet_username ? <Row icon="person-outline" title={u.intranet_username} subtitle="Username (tap to copy)" onPress={() => Clipboard.setStringAsync(u.intranet_username!)} chevron={false} /> : null}
            <Row icon="time-outline" title={`Member since ${formatDate(u.created_at)}`} subtitle={u.last_login ? `Last active ${formatDate(u.last_login)}` : undefined} chevron={false} />
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
