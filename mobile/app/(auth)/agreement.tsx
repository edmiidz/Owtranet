import React, { useState } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { agreementsApi } from '@/api';
import { errorMessage } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useAsync } from '@/lib/useAsync';
import { Button, Card, ErrorBox, H1, Input, Loading, P, Screen, Small } from '@/components/ui';
import { Markdown } from '@/components/Markdown';

/** Gate shown when the account is `pending_agreement` (mirrors the web AgreementPage). */
export default function AgreementGate() {
  const router = useRouter();
  const { user, login, setRequiresAgreement, logout, updateUser } = useAuthStore();
  const { data, loading, error, reload } = useAsync(() => agreementsApi.current(), []);
  const [fullName, setFullName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [quiz, setQuiz] = useState('');
  const [signature, setSignature] = useState('');
  const [busy, setBusy] = useState(false);

  async function sign() {
    if (!fullName.trim() || !signature.trim()) { Alert.alert('Please fill in your name and signature'); return; }
    setBusy(true);
    try {
      const r = await agreementsApi.sign({ full_name: fullName.trim(), email: email.trim(), quiz_answer: quiz.trim() || undefined, digital_signature: signature.trim() });
      if (r.token && r.user) await login(r.token, r.user);
      else updateUser({ role: 'user' });
      setRequiresAgreement(false);
      router.replace('/(app)/(tabs)');
    } catch (e) { Alert.alert('Could not sign', errorMessage(e)); }
    finally { setBusy(false); }
  }

  return (
    <Screen edges={['top', 'bottom', 'left', 'right']}>
      <H1>Team agreement</H1>
      <P muted>You need to sign the current agreement before using the intranet.</P>
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : data ? (
        <>
          <Card><Small>{data.title} · v{data.version}</Small><Markdown>{data.content}</Markdown></Card>
          <Card>
            <Input label="Full legal name" value={fullName} onChangeText={setFullName} />
            <Input label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            {data.quiz_question ? <Input label={data.quiz_question} value={quiz} onChangeText={setQuiz} /> : null}
            <Input label="Type your name as a digital signature" value={signature} onChangeText={setSignature} />
            <Button title="I agree and sign" onPress={sign} loading={busy} />
          </Card>
        </>
      ) : null}
      <Button title="Sign out" variant="ghost" onPress={async () => { await logout(); router.replace('/login'); }} />
    </Screen>
  );
}
