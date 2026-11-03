import { Redirect } from 'expo-router';
import { useAuthStore } from '@/stores/auth';

export default function Index() {
  const token = useAuthStore(s => s.token);
  const requiresAgreement = useAuthStore(s => s.requiresAgreement);
  if (!token) return <Redirect href="/login" />;
  if (requiresAgreement) return <Redirect href="/agreement" />;
  return <Redirect href="/(app)/(tabs)" />;
}
