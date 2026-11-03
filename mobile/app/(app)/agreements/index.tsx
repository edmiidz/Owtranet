import React from 'react';
import { useRouter } from 'expo-router';
import { agreementsApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useAsync } from '@/lib/useAsync';
import { formatDate } from '@/lib/format';
import { Card, Empty, ErrorBox, H2, Loading, P, Row, Screen, StatusPill } from '@/components/ui';

export default function AgreementsScreen() {
  const router = useRouter();
  const me = useAuthStore(s => s.user);
  const { data, loading, error, reload, refresh, refreshing } = useAsync(async () => {
    const [status, mine, signed] = await Promise.all([
      agreementsApi.status().catch(() => null),
      agreementsApi.mine().catch(() => []),
      me ? agreementsApi.userAgreements(me.id).catch(() => []) : Promise.resolve([]),
    ]);
    return { status, mine, signed };
  }, [me?.id]);

  const pending = (data?.mine || []).filter(a => a.status === 'pending');
  const done = (data?.mine || []).filter(a => a.status !== 'pending');

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : data ? (
        <>
          <Card>
            <H2 style={{ marginTop: 0 }}>Team agreement</H2>
            {data.status?.has_signed ? <P>Signed · version {data.status.current_version}{data.status.agreement_details?.signed_at ? ` · ${formatDate(data.status.agreement_details.signed_at)}` : ''}</P> : <P muted>Not signed{data.status?.current_version ? ` (current: v${data.status.current_version})` : ''}.</P>}
          </Card>
          <H2>Awaiting your signature</H2>
          {pending.length === 0 ? <Empty icon="checkmark-done-outline" title="Nothing to sign" /> : (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {pending.map(a => <Row key={a.id} icon="create-outline" title={a.title} subtitle={`v${a.version} · ${a.agreement_type} · requested ${formatDate(a.requested_at)}`} right={<StatusPill status={a.status} />} onPress={() => router.push(`/agreements/${a.id}` as any)} />)}
            </Card>
          )}
          {(done.length > 0 || data.signed.length > 0) ? (
            <>
              <H2>History</H2>
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {done.map(a => <Row key={`a${a.id}`} icon="document-text-outline" title={a.title} subtitle={`v${a.version}${a.signed_at ? ` · signed ${formatDate(a.signed_at)}` : ''}`} right={<StatusPill status={a.status} />} chevron={false} />)}
                {data.signed.map(s => <Row key={`s${s.id}`} icon="document-text-outline" title={s.title || 'Team agreement'} subtitle={`${s.version ? `v${s.version} · ` : ''}signed ${formatDate(s.signed_at)} as ${s.full_name}`} right={<StatusPill status={s.status} />} chevron={false} />)}
              </Card>
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
