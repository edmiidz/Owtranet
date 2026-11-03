import React, { useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { ledgerApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useAsync } from '@/lib/useAsync';
import { formatDate, humanStatus, money } from '@/lib/format';
import { Button, Card, Chip, Empty, ErrorBox, Loading, P, Row, Screen, Small, StatusPill } from '@/components/ui';

const STATUSES = ['all', 'draft', 'pending', 'under_review', 'approved', 'paid', 'rejected'];

export default function LedgerScreen() {
  const router = useRouter();
  const branding = useAuthStore(s => s.branding);
  const [status, setStatus] = useState('all');
  const { data, loading, error, reload, refresh, refreshing, refreshIfLoaded } = useAsync(() => ledgerApi.list(status === 'all' ? undefined : { status }), [status]);
  useFocusEffect(refreshIfLoaded);
  const cur = branding?.baseCurrency || 'USD';
  const total = (data || []).reduce((a, e) => a + Number(e.total_with_tax ?? e.amount ?? 0), 0);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Button title="New expense" icon="camera-outline" onPress={() => router.push('/ledger/new')} style={{ marginBottom: 12 }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>{STATUSES.map(s => <Chip key={s} label={humanStatus(s)} active={status === s} onPress={() => setStatus(s)} />)}</View>
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : !data?.length ? <Empty icon="receipt-outline" title="No expenses" hint="Snap a receipt to add one." /> : (
        <>
          <Small style={{ marginBottom: 8 }}>{data.length} entries · {money(total, cur)}</Small>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {data.map(e => (
              <Row key={e.id} title={e.title} subtitle={`${formatDate(e.expense_date)} · ${humanStatus(e.expense_category)}${e.vendor_name ? ` · ${e.vendor_name}` : ''}${e.payee_name ? ` · ${e.payee_name}` : ''}`}
                right={<View style={{ alignItems: 'flex-end', gap: 4 }}><P style={{ fontWeight: '700' }}>{money(e.total_with_tax ?? e.amount, e.original_currency && e.original_amount != null && e.total_with_tax == null ? e.original_currency : cur)}</P><StatusPill status={e.status} /></View>}
                onPress={() => router.push(`/ledger/${e.id}` as any)} />
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
