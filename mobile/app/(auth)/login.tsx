import React, { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { authApi, mobileApi } from '@/api';
import { errorMessage } from '@/api/client';
import { DEFAULT_WORKSPACE_URL, useAuthStore } from '@/stores/auth';
import { cancelAddAccount } from '@/lib/accounts';
import { Button, Card, H1, Input, P, Screen, Small } from '@/components/ui';
import { useTheme } from '@/theme';

export default function LoginScreen() {
  const t = useTheme();
  const router = useRouter();
  const { workspaceUrl, setWorkspaceUrl, branding, setBranding, setAiAgent, login, accounts } = useAuthStore();
  // "Add account" from the switcher: another account is parked, so offer a way back to it.
  const adding = accounts.length > 0;
  const [url, setUrl] = useState(workspaceUrl || DEFAULT_WORKSPACE_URL);
  // First launch (no community chosen yet) and "Add account" both start by asking for the address.
  const [showWorkspace, setShowWorkspace] = useState(adding || !workspaceUrl);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpMode, setOtpMode] = useState(false);
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setUrl(workspaceUrl); }, [workspaceUrl]);

  async function applyWorkspace(): Promise<boolean> {
    let clean = url.trim().replace(/\/+$/, '');
    if (!clean) { Alert.alert('Enter your community address', 'Ask your administrator — it looks like intranet.yourcompany.com'); return false; }
    if (!/^https?:\/\//i.test(clean)) clean = `https://${clean}`;
    try {
      const cfg = await mobileApi.config(clean);
      await setWorkspaceUrl(clean);
      setBranding(cfg);
      setAiAgent(cfg.ai_agent);
      return true;
    } catch (e) {
      Alert.alert('Workspace not reachable', errorMessage(e, 'Check the URL — it should look like https://intranet.example.com'));
      return false;
    }
  }

  async function onLogin() {
    if (!email.trim() || !password) return;
    setBusy(true);
    try {
      if (!(await applyWorkspace())) return;
      const res = await authApi.login(email.trim(), password);
      await login(res.token, res.user);
      router.replace(res.user.role === 'pending_agreement' ? '/agreement' : '/(app)/(tabs)');
    } catch (e: any) {
      if (e?.response?.status === 403 && e.response.data?.requiresAgreement) {
        // Server may still return a token with the 403; otherwise the user must sign on the web first.
        Alert.alert('Agreement required', 'Please sign the team agreement to continue.');
      } else {
        Alert.alert('Sign in failed', errorMessage(e));
      }
    } finally { setBusy(false); }
  }

  async function onEmailCode() {
    if (!email.trim()) { Alert.alert('Enter your email first'); return; }
    setBusy(true);
    try {
      if (!(await applyWorkspace())) return;
      const r = await authApi.requestEmailLogin(email.trim());
      setOtpMode(true);
      Alert.alert('Check your email', r.message || 'We sent you a one-time code.');
    } catch (e) { Alert.alert('Could not send code', errorMessage(e)); }
    finally { setBusy(false); }
  }

  async function onVerifyOtp() {
    setBusy(true);
    try {
      const res = await authApi.verifyOtp(otp.trim());
      await login(res.token, res.user);
      router.replace(res.user.role === 'pending_agreement' ? '/agreement' : '/(app)/(tabs)');
    } catch (e) { Alert.alert('Invalid code', errorMessage(e)); }
    finally { setBusy(false); }
  }

  return (
    <Screen edges={['top', 'bottom', 'left', 'right']}>
      <View style={{ alignItems: 'center', marginTop: 40, marginBottom: 24 }}>
        <View style={{ width: 72, height: 72, borderRadius: 20, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
          <Ionicons name="business" size={36} color="#fff" />
        </View>
        <H1 style={{ marginBottom: 2 }}>{adding ? 'Add account' : (workspaceUrl && branding?.companyShortName) || 'Owtranet'}</H1>
        <Small>{url ? url.replace(/^https?:\/\//, '') : 'Sign in to your community'}</Small>
      </View>

      <Card>
        {showWorkspace ? (
          <Input label="Community address" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="intranet.yourcompany.com" />
        ) : null}
        {!otpMode ? (
          <>
            <Input label="Email or username" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="username" />
            <Input label="Password" value={password} onChangeText={setPassword} secureTextEntry textContentType="password" onSubmitEditing={onLogin} />
            <Button title="Sign in" onPress={onLogin} loading={busy} />
            <Button title="Email me a one-time code instead" variant="ghost" onPress={onEmailCode} disabled={busy} style={{ marginTop: 6 }} />
          </>
        ) : (
          <>
            <P muted style={{ marginBottom: 10 }}>Enter the code we emailed to {email}.</P>
            <Input label="One-time code" value={otp} onChangeText={setOtp} keyboardType="number-pad" autoFocus />
            <Button title="Verify" onPress={onVerifyOtp} loading={busy} />
            <Button title="Back to password" variant="ghost" onPress={() => setOtpMode(false)} style={{ marginTop: 6 }} />
          </>
        )}
      </Card>
      <Button title={showWorkspace ? 'Hide community address' : 'Change community'} variant="ghost" icon="globe-outline" onPress={() => setShowWorkspace(v => !v)} />
      {adding ? <Button title="Cancel" variant="ghost" icon="arrow-back-outline" onPress={() => { cancelAddAccount(); }} disabled={busy} /> : null}
      <Text style={{ color: t.muted, textAlign: 'center', fontSize: 12, marginTop: 20 }}>Accounts are created by invitation on the web intranet.</Text>
    </Screen>
  );
}
