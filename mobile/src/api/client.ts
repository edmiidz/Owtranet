import axios, { AxiosError, AxiosInstance } from 'axios';
import { useAuthStore } from '@/stores/auth';

/**
 * Axios instance. Unlike the web client (relative '/api'), a native app has to
 * know the workspace URL — it's chosen on the login screen and kept in the auth
 * store, so the base URL is resolved on every request.
 */
export const api: AxiosInstance = axios.create({ timeout: 20000, headers: { 'Content-Type': 'application/json' } });

api.interceptors.request.use((config) => {
  const { token, workspaceUrl } = useAuthStore.getState();
  config.baseURL = `${workspaceUrl.replace(/\/$/, '')}/api`;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (error: AxiosError<any>) => {
    const status = error.response?.status;
    const url = error.config?.url || '';
    if (status === 403 && error.response?.data?.requiresAgreement) {
      useAuthStore.getState().setRequiresAgreement(true);
      return Promise.reject(error);
    }
    if (status === 401 && !url.includes('/auth/')) {
      // Token expired / revoked → drop that account; the root layout redirects to login
      // (or the next signed-in account). Skip a late 401 for an account we already left.
      const sent = String(error.config?.headers?.Authorization || '');
      const { token, logout } = useAuthStore.getState();
      if (token && sent === `Bearer ${token}`) logout();
    }
    return Promise.reject(error);
  }
);

export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  const err = e as AxiosError<any>;
  if (err?.response?.data?.error) return String(err.response.data.error);
  if (err?.response?.data?.message) return String(err.response.data.message);
  if (Array.isArray(err?.response?.data?.errors)) return err.response!.data.errors.map((x: any) => x.msg).join(', ');
  if (err?.message === 'Network Error') return 'Cannot reach the workspace. Check the URL and your connection.';
  return err?.message || fallback;
}

/** Absolute URL for a server-relative path such as /uploads/avatars/x.jpg (on `workspaceUrl`, default the active one). */
export function absoluteUrl(path?: string | null, workspaceUrl?: string): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  const base = (workspaceUrl || useAuthStore.getState().workspaceUrl).replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}
