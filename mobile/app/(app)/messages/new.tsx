import React, { useState } from 'react';
import { Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { messagesApi, usersApi } from '@/api';
import { errorMessage } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useAsync } from '@/lib/useAsync';
import { Button, Card, ErrorBox, Input, Loading, Row, Screen } from '@/components/ui';

export default function NewMessageScreen() {
  const router = useRouter();
  const me = useAuthStore(s => s.user);
  const { data, loading, error, reload } = useAsync(() => usersApi.list(), []);
  const [q, setQ] = useState('');
  // A member or AI agent profile opens this with ?to=<id>&name=<name> preselected
  // (agents aren't in the member list below).
  const params = useLocalSearchParams<{ to?: string; name?: string }>();
  const [to, setTo] = useState<{ id: number; name: string } | null>(
    params.to && Number(params.to) ? { id: Number(params.to), name: params.name || 'Member' } : null
  );
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!to || !text.trim()) return;
    setBusy(true);
    try {
      const r = await messagesApi.send(to.id, text.trim());
      router.replace({ pathname: `/messages/${r.conversation_id}`, params: r.agent_replying ? { agentTyping: to.name } : {} } as any);
    }
    catch (e) { Alert.alert('Could not send', errorMessage(e)); }
    finally { setBusy(false); }
  }

  const list = (data || []).filter(u => u.id !== me?.id && !['pending', 'deactivated', 'system'].includes(u.role) && (!q || u.name.toLowerCase().includes(q.toLowerCase())));

  return (
    <Screen>
      {to ? (
        <Card>
          <Row avatar={{ name: to.name }} title={to.name} subtitle="Recipient" onPress={() => setTo(null)} chevron={false} />
          <Input placeholder="Your message…" value={text} onChangeText={setText} multiline autoFocus style={{ marginTop: 10 }} />
          <Button title="Send" icon="send" onPress={send} loading={busy} disabled={!text.trim()} />
        </Card>
      ) : (
        <>
          <Input placeholder="Find a member…" value={q} onChangeText={setQ} autoFocus />
          {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {list.map(u => <Row key={u.id} avatar={{ uri: u.avatar_url, name: u.name }} title={u.name} subtitle={u.position || u.email} onPress={() => setTo({ id: u.id, name: u.name })} />)}
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}
