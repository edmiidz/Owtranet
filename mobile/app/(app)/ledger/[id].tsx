import React from 'react';
import { Alert, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ledgerApi } from '@/api';
import { errorMessage } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useAsync } from '@/lib/useAsync';
import { formatDate, humanStatus, money } from '@/lib/format';
import { openPublicFile } from '@/lib/files';
import { Button, Card, ErrorBox, Loading, Row, Screen, Small, StatusPill } from '@/components/ui';
import { useTheme } from '@/theme';

export default function LedgerEntryScreen() {
  const t = useTheme();
  const router = useRouter();
  const me = useAuthStore(s => s.user);
  const branding = useAuthStore(s => s.branding);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: e, loading, error, reload, refresh } = useAsync(() => ledgerApi.get(Number(id)), [id]);
  const cur = branding?.baseCurrency || 'USD';

  async function act(label: string, fn: () => Promise<any>) {
    try { await fn(); refresh(); } catch (err) { Alert.alert(`${label} failed`, errorMessage(err)); }
  }

  return (
    <Screen>
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : e ? (
        <>
          <Text style={{ color: t.text, fontSize: 21, fontWeight: '800' }}>{e.title}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 8 }}><StatusPill status={e.status} /><Small>{humanStatus(e.expense_category)} · {formatDate(e.expense_date)}</Small></View>
          <Card>
            <Text style={{ color: t.text, fontSize: 30, fontWeight: '800' }}>{money(e.total_with_tax ?? e.amount, cur)}</Text>
            {e.original_currency && e.original_currency !== cur ? <Small>Originally {money(e.original_amount, e.original_currency)}</Small> : null}
            {e.tax_total ? <Small>incl. tax {money(e.tax_total, cur)}</Small> : null}
          </Card>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {e.vendor_name ? <Row icon="storefront-outline" title={e.vendor_name} subtitle="Vendor" chevron={false} /> : null}
            {e.receipt_number ? <Row icon="pricetag-outline" title={e.receipt_number} subtitle="Receipt / invoice #" chevron={false} /> : null}
            {e.project_code ? <Row icon="briefcase-outline" title={e.project_code} subtitle="Project" chevron={false} /> : null}
            <Row icon="person-outline" title={e.submitter_name || e.user_name || `User #${e.user_id}`} subtitle={`Submitted · ${e.is_reimbursable ? 'reimbursable' : 'not reimbursable'}${e.payee_name ? ` · pay ${e.payee_name}` : ''}`} chevron={false} />
            {e.receipt_filename ? <Row icon="image-outline" title={e.receipt_original_name || 'Receipt'} subtitle="Open receipt" onPress={() => openPublicFile(`/uploads/ledger-receipts/${e.receipt_filename}`)} /> : null}
            <Row icon="time-outline" title={`Source: ${e.source || 'manual'}`} subtitle={`Created ${formatDate(e.created_at)}`} chevron={false} />
          </Card>
          {e.description ? <Card><Text style={{ color: t.text, lineHeight: 22 }}>{e.description}</Text></Card> : null}
          {me?.role === 'admin' && ['pending', 'under_review'].includes(e.status) ? <Button title="Approve" icon="checkmark" onPress={() => act('Approve', () => ledgerApi.approve(e.id))} style={{ marginBottom: 8 }} /> : null}
          {me?.role === 'admin' && e.status === 'approved' ? <Button title="Mark as paid" icon="cash-outline" onPress={() => act('Pay', () => ledgerApi.pay(e.id))} style={{ marginBottom: 8 }} /> : null}
          {(me?.id === e.user_id || me?.role === 'admin') && ['draft', 'pending'].includes(e.status) ? (
            <>
              {e.status === 'draft' ? <Button title="Submit for approval" variant="secondary" onPress={() => act('Submit', () => ledgerApi.update(e.id, { status: 'pending', is_draft: false }))} style={{ marginBottom: 8 }} /> : null}
              <Button title="Delete" variant="danger" icon="trash-outline" onPress={() => Alert.alert('Delete expense?', '', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { try { await ledgerApi.remove(e.id); router.back(); } catch (err) { Alert.alert('Failed', errorMessage(err)); } } }])} />
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
