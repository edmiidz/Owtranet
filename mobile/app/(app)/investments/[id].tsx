import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { deliverablesApi } from '@/api';
import { errorMessage } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useAsync } from '@/lib/useAsync';
import { bytes, formatDate, humanStatus, money } from '@/lib/format';
import { downloadAndShare } from '@/lib/files';
import { Button, Card, ErrorBox, Input, Loading, Row, Screen, Small, StatusPill } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import { useTheme } from '@/theme';

export default function DeliverableScreen() {
  const t = useTheme();
  const me = useAuthStore(s => s.user);
  const branding = useAuthStore(s => s.branding);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: d, loading, error, reload, refresh } = useAsync(() => deliverablesApi.get(Number(id)), [id]);
  const [reason, setReason] = useState('');
  const cur = branding?.baseCurrency || 'USD';

  async function setStatus(status: string) {
    if (!d) return;
    try { await deliverablesApi.update(d.id, { status, rejection_reason: status === 'rejected' ? reason || 'Rejected' : undefined }); refresh(); }
    catch (e) { Alert.alert('Update failed', errorMessage(e)); }
  }

  return (
    <Screen>
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : d ? (
        <>
          <Text style={{ color: t.text, fontSize: 21, fontWeight: '800' }}>{d.title}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 8 }}><StatusPill status={d.status} /><Small>{humanStatus(d.investment_category || d.type)} · {formatDate(d.deliverable_date || d.created_at)}</Small></View>
          <Card>
            <Text style={{ color: t.text, fontSize: 30, fontWeight: '800' }}>{money(d.theoretical_value_usd ?? d.amount, cur)}</Text>
            <Small>{d.original_amount != null ? `${money(d.original_amount, d.original_currency || cur)} × rate ${Number(d.exchange_rate ?? 1).toFixed(4)} × risk ${Number(d.risk_multiplier ?? 1).toFixed(2)}` : 'Amount'}</Small>
          </Card>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <Row icon="person-outline" title={d.nominee_name || d.user_name || `User #${d.user_id}`} subtitle="Credited to" chevron={false} />
            {d.approver_name ? <Row icon="checkmark-circle-outline" title={d.approver_name} subtitle="Approved by" chevron={false} /> : null}
            {d.tags ? <Row icon="pricetags-outline" title={Array.isArray(d.tags) ? d.tags.join(', ') : String(d.tags)} subtitle="Tags" chevron={false} /> : null}
            {(d.attachments || []).map(a => <Row key={a.id} icon="document-attach-outline" title={a.file_name} subtitle={bytes(a.file_size)} onPress={() => downloadAndShare(`/api/deliverables/documents/${a.file_path.split('/').pop()}`, a.file_name)} />)}
          </Card>
          {d.content || d.description ? <Card><Markdown>{d.content || d.description || ''}</Markdown></Card> : null}
          {me?.role === 'admin' && ['pending', 'pending_review', 'negotiating'].includes(d.status) ? (
            <Card>
              <Button title="Approve" icon="checkmark" onPress={() => setStatus('approved')} style={{ marginBottom: 8 }} />
              <Input placeholder="Rejection reason" value={reason} onChangeText={setReason} />
              <Button title="Reject" variant="danger" onPress={() => setStatus('rejected')} />
            </Card>
          ) : null}
          {me?.role === 'admin' && d.status === 'approved' ? <Button title="Mark as paid" icon="cash-outline" onPress={() => setStatus('paid')} /> : null}
        </>
      ) : null}
    </Screen>
  );
}
