import { Redirect, Stack } from 'expo-router';
import { useAuthStore } from '@/stores/auth';

export default function AuthLayout() {
  const token = useAuthStore(s => s.token);
  const requiresAgreement = useAuthStore(s => s.requiresAgreement);
  if (token && !requiresAgreement) return <Redirect href="/(app)/(tabs)" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
