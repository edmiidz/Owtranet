import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { deliverablesApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useAsync } from '@/lib/useAsync';
import { formatDate, humanStatus, money } from '@/lib/format';
import { Button, Card, Chip, Empty, ErrorBox, Loading, P, Row, Screen, Small, StatusPill } from '@/components/ui';

const FILTERS = ['all', 'mine', 'pending', 'approved', 'paid', 'rejected'];

export default function InvestmentsScreen() {
  const router = useRouter();
  const me = useAuthStore(s => s.user);
  const branding = useAuthStore(s => s.branding);
  const [filter, setFilter] = useState('all');
  const { data, loading, error, reload, refresh, refreshing } = useAsync(() => deliverablesApi.list(), []);
  useFocusEffect(useCallback(() => { if (data) refresh(); }, [])); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = branding?.baseCurrency || 'USD';
  const list = (data || []).filter(d => filter === 'all' ? true : filter === 'mine' ? (d.user_id === me?.id || d.nominee_user_id === me?.id) : d.status === filter);
  const totalValue = list.reduce((a, d) => a + Number(d.theoretical_value_usd ?? d.amount ?? 0), 0);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Button title="Submit a deliverable" icon="add-circle-outline" onPress={() => router.push('/investments/new')} style={{ marginBottom: 12 }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>{FILTERS.map(f => <Chip key={f} label={humanStatus(f)} active={filter === f} onPress={() => setFilter(f)} />)}</View>
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : list.length === 0 ? <Empty icon="trending-up-outline" title="No deliverables" /> : (
        <>
          <Small style={{ marginBottom: 8 }}>{list.length} deliverables · {money(totalValue, cur)} theoretical value</Small>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {list.map(d => (
              <Row key={d.id} title={d.title} subtitle={`${d.nominee_name || d.user_name || ''} · ${humanStatus(d.investment_category || d.type)} · ${formatDate(d.deliverable_date || d.created_at)}`}
                right={<View style={{ alignItems: 'flex-end', gap: 4 }}><P style={{ fontWeight: '700' }}>{money(d.theoretical_value_usd ?? d.amount, cur)}</P><StatusPill status={d.status} /></View>}
                onPress={() => router.push(`/investments/${d.id}` as any)} />
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
