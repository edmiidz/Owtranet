import React, { useState } from 'react';
import { useRouter } from 'expo-router';
import { usersApi } from '@/api';
import { useAsync } from '@/lib/useAsync';
import { Card, Empty, ErrorBox, Input, Loading, Row, Screen } from '@/components/ui';

export default function MembersScreen() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const { data, loading, error, reload, refresh, refreshing } = useAsync(() => usersApi.list(), []);
  const list = (data || []).filter(u => !['system'].includes(u.role)).filter(u => !q || [u.name, u.email, u.position, u.department, u.company, u.intranet_username].join(' ').toLowerCase().includes(q.toLowerCase()));
  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Input placeholder="Search by name, role, department…" value={q} onChangeText={setQ} />
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : list.length === 0 ? <Empty icon="people-outline" title="No members found" /> : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {list.map(u => <Row key={u.id} avatar={{ uri: u.avatar_url, name: u.name }} title={u.name} subtitle={[u.position, u.department, u.company].filter(Boolean).join(' · ') || u.email} onPress={() => router.push(`/members/${u.intranet_username || u.github_username || u.id}` as any)} />)}
        </Card>
      )}
    </Screen>
  );
}
