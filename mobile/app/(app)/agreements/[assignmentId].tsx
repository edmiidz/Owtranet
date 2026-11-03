import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { agreementsApi } from '@/api';
import { errorMessage } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useBadges } from '@/stores/badges';
import { useAsync } from '@/lib/useAsync';
import { Button, Card, ErrorBox, H2, Input, Loading, P, Screen, Small } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import { useTheme } from '@/theme';

const PAYROLL_FIELDS: Array<[string, string, boolean]> = [
  ['sin', 'Social Insurance Number', true], ['date_of_birth', 'Date of birth (YYYY-MM-DD)', false],
  ['bank_institution', 'Bank institution number', false], ['bank_transit', 'Bank transit number', false], ['bank_account', 'Bank account number', true],
  ['address_line1', 'Address line 1', false], ['address_line2', 'Address line 2', false], ['city', 'City', false], ['province', 'Province', false], ['postal_code', 'Postal code', false],
];

export default function SignAssignmentScreen() {
  const t = useTheme();
  const router = useRouter();
  const me = useAuthStore(s => s.user);
  const refreshBadges = useBadges(s => s.refresh);
  const { assignmentId } = useLocalSearchParams<{ assignmentId: string }>();
  const { data, loading, error, reload } = useAsync(() => agreementsApi.assignment(String(assignmentId)), [assignmentId]);
  const [fullName, setFullName] = useState(me?.name || '');
  const [email, setEmail] = useState(me?.email || '');
  const [quiz, setQuiz] = useState('');
  const [signature, setSignature] = useState('');
  const [confirms, setConfirms] = useState<Record<string, boolean>>({});
  const [payroll, setPayroll] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (data?.confirmations) setConfirms(Object.fromEntries(data.confirmations.map(c => [c.key, false]))); }, [data]);

  const needsPayroll = (data?.required_fields || []).some(f => PAYROLL_FIELDS.some(([k]) => k === f));
  const requiredPayroll = new Set(data?.required_fields || []);

  async function sign() {
    if (!data) return;
    if (!fullName.trim() || !signature.trim()) { Alert.alert('Enter your full name and signature'); return; }
    if (data.confirmations?.some(c => !confirms[c.key])) { Alert.alert('Please confirm every statement'); return; }
    for (const f of requiredPayroll) if (PAYROLL_FIELDS.some(([k]) => k === f) && !payroll[f]?.trim()) { Alert.alert('Missing required field', PAYROLL_FIELDS.find(([k]) => k === f)?.[1]); return; }
    setBusy(true);
    try {
      await agreementsApi.signAssignment(data.id, { full_name: fullName.trim(), email: email.trim(), quiz_answer: quiz.trim() || undefined, digital_signature: signature.trim(), confirmations: confirms, payroll: needsPayroll ? payroll : undefined });
      refreshBadges();
      Alert.alert('Signed', `${data.title} has been signed.`, [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e) { Alert.alert('Could not sign', errorMessage(e)); }
    finally { setBusy(false); }
  }

  return (
    <Screen>
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : data ? (
        <>
          <Text style={{ color: t.text, fontSize: 21, fontWeight: '800' }}>{data.title}</Text>
          <Small>Version {data.version} · {data.agreement_type}</Small>
          <Card style={{ marginTop: 12 }}><Markdown>{data.content}</Markdown></Card>
          {data.status !== 'pending' ? <P muted>This agreement is {data.status}.</P> : (
            <Card>
              <H2 style={{ marginTop: 0 }}>Sign</H2>
              <Input label="Full legal name" value={fullName} onChangeText={setFullName} />
              <Input label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
              {data.quiz_question ? <Input label={data.quiz_question} value={quiz} onChangeText={setQuiz} /> : null}
              {data.confirmations?.map(c => (
                <Pressable key={c.key} onPress={() => setConfirms(s => ({ ...s, [c.key]: !s[c.key] }))} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
                  <Ionicons name={confirms[c.key] ? 'checkbox' : 'square-outline'} size={22} color={confirms[c.key] ? t.primary : t.muted} />
                  <P style={{ flex: 1 }}>{c.label}</P>
                </Pressable>
              ))}
              {needsPayroll ? (
                <View style={{ marginTop: 6 }}>
                  <H2>Payroll details</H2>
                  <Small style={{ marginBottom: 8 }}>Encrypted on the server; only masked values are ever shown again.</Small>
                  {PAYROLL_FIELDS.filter(([k]) => requiredPayroll.has(k) || ['address_line1', 'city', 'province', 'postal_code', 'bank_institution', 'bank_transit'].includes(k)).map(([k, label, secret]) => (
                    <Input key={k} label={`${label}${requiredPayroll.has(k) ? ' *' : ''}`} value={payroll[k] || ''} onChangeText={v => setPayroll(p => ({ ...p, [k]: v }))} secureTextEntry={secret} autoCapitalize="none" />
                  ))}
                </View>
              ) : null}
              <Input label="Type your full name as your digital signature" value={signature} onChangeText={setSignature} />
              <Button title="Sign agreement" onPress={sign} loading={busy} />
            </Card>
          )}
        </>
      ) : null}
    </Screen>
  );
}
