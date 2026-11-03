import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import type { AiAgentInfo, Branding, User } from '@/api/types';

const TOKEN_KEY = 'intranet.token';
const USER_KEY = 'intranet.user';
const WORKSPACE_KEY = 'intranet.workspaceUrl';
const BRANDING_KEY = 'intranet.branding';
const AI_AGENT_KEY = 'intranet.aiAgent';

export const DEFAULT_WORKSPACE_URL: string =
  process.env.EXPO_PUBLIC_DEFAULT_WORKSPACE_URL ||
  (Constants.expoConfig?.extra as any)?.defaultWorkspaceUrl ||
  'https://intranet.example.com';

function tokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now() + 60_000;
  } catch { return false; }
}

interface AuthState {
  hydrated: boolean;
  token: string | null;
  user: User | null;
  workspaceUrl: string;
  branding: Branding | null;
  /** Workspace voice agent for "Call AI" (null when the instance has no ELEVENLABS_* config). */
  aiAgent: AiAgentInfo | null;
  requiresAgreement: boolean;
  hydrate: () => Promise<void>;
  setWorkspaceUrl: (url: string) => Promise<void>;
  setBranding: (b: Branding) => void;
  setAiAgent: (a: AiAgentInfo | null | undefined) => void;
  login: (token: string, user: User) => Promise<void>;
  updateUser: (patch: Partial<User>) => void;
  setRequiresAgreement: (v: boolean) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  hydrated: false,
  token: null,
  user: null,
  workspaceUrl: DEFAULT_WORKSPACE_URL,
  branding: null,
  aiAgent: null,
  requiresAgreement: false,

  hydrate: async () => {
    try {
      const [token, userJson, ws, brandingJson, aiAgentJson] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY),
        AsyncStorage.getItem(USER_KEY),
        AsyncStorage.getItem(WORKSPACE_KEY),
        AsyncStorage.getItem(BRANDING_KEY),
        AsyncStorage.getItem(AI_AGENT_KEY),
      ]);
      const valid = token && !tokenExpired(token) ? token : null;
      if (token && !valid) await SecureStore.deleteItemAsync(TOKEN_KEY);
      set({
        token: valid,
        user: valid && userJson ? JSON.parse(userJson) : null,
        workspaceUrl: ws || DEFAULT_WORKSPACE_URL,
        branding: brandingJson ? JSON.parse(brandingJson) : null,
        aiAgent: aiAgentJson ? JSON.parse(aiAgentJson) : null,
        requiresAgreement: valid && userJson ? JSON.parse(userJson).role === 'pending_agreement' : false,
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },

  setWorkspaceUrl: async (url) => {
    const clean = url.trim().replace(/\/+$/, '');
    await AsyncStorage.setItem(WORKSPACE_KEY, clean);
    set({ workspaceUrl: clean });
  },

  setBranding: (branding) => {
    AsyncStorage.setItem(BRANDING_KEY, JSON.stringify(branding)).catch(() => {});
    set({ branding });
  },

  setAiAgent: (aiAgent) => {
    const value = aiAgent || null;
    AsyncStorage.setItem(AI_AGENT_KEY, JSON.stringify(value)).catch(() => {});
    set({ aiAgent: value });
  },

  login: async (token, user) => {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ token, user, requiresAgreement: user.role === 'pending_agreement' });
  },

  updateUser: (patch) => {
    const user = { ...(get().user as User), ...patch };
    AsyncStorage.setItem(USER_KEY, JSON.stringify(user)).catch(() => {});
    set({ user });
  },

  setRequiresAgreement: (v) => set({ requiresAgreement: v }),

  logout: async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
    await AsyncStorage.removeItem(USER_KEY).catch(() => {});
    set({ token: null, user: null, requiresAgreement: false });
  },
}));
