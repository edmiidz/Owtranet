import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import type { AiAgentInfo, Branding, User } from '@/api/types';

// Single-session keys from before account switching. Read once to migrate.
const LEGACY_TOKEN_KEY = 'intranet.token';
const LEGACY_USER_KEY = 'intranet.user';
const LEGACY_AI_AGENT_KEY = 'intranet.aiAgent';

/** Workspace + branding the login screen shows when no account is active. */
const WORKSPACE_KEY = 'intranet.workspaceUrl';
const BRANDING_KEY = 'intranet.branding';

/**
 * Signed-in accounts (Owtranet#6): one per workspace + user, Instagram-style.
 * The index and every token live in SecureStore — the iOS keychain survives a
 * reinstall/TestFlight update while AsyncStorage does not — and the display
 * metadata (user, branding, agent) is a re-fetchable cache in AsyncStorage.
 */
const ACCOUNTS_KEY = 'intranet.accounts';
const ACTIVE_KEY = 'intranet.activeAccount';
const META_KEY = 'intranet.accounts.meta';
const tokenKey = (key: string) => `intranet.token.${key}`;

/**
 * Pre-filled community URL on first launch. Empty by default: one store app can
 * serve every community, so the login screen asks for the address. Set
 * `extra.defaultWorkspaceUrl` (or EXPO_PUBLIC_DEFAULT_WORKSPACE_URL) for a
 * single-community, white-label build.
 */
export const DEFAULT_WORKSPACE_URL: string =
  process.env.EXPO_PUBLIC_DEFAULT_WORKSPACE_URL ||
  (Constants.expoConfig?.extra as any)?.defaultWorkspaceUrl ||
  '';

function tokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now() + 60_000;
  } catch { return false; }
}

function cleanUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function newKey(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export interface Account {
  /** Opaque id, also the suffix of the account's SecureStore token key. */
  key: string;
  workspaceUrl: string;
  userId: number | null;
  user: User | null;
  branding: Branding | null;
  aiAgent: AiAgentInfo | null;
}

type IndexEntry = Pick<Account, 'key' | 'workspaceUrl' | 'userId'>;
type Meta = Record<string, Pick<Account, 'user' | 'branding' | 'aiAgent'>>;

async function persistAccounts(accounts: Account[], activeKey: string | null): Promise<void> {
  const index: IndexEntry[] = accounts.map(({ key, workspaceUrl, userId }) => ({ key, workspaceUrl, userId }));
  const meta: Meta = {};
  for (const a of accounts) meta[a.key] = { user: a.user, branding: a.branding, aiAgent: a.aiAgent };
  await SecureStore.setItemAsync(ACCOUNTS_KEY, JSON.stringify(index));
  if (activeKey) await SecureStore.setItemAsync(ACTIVE_KEY, activeKey);
  else await SecureStore.deleteItemAsync(ACTIVE_KEY).catch(() => {});
  await AsyncStorage.setItem(META_KEY, JSON.stringify(meta)).catch(() => {});
}

interface AuthState {
  hydrated: boolean;
  /** Every account signed in on this device; the active one is mirrored below. */
  accounts: Account[];
  activeKey: string | null;
  /** Account to return to when "Add account" is cancelled on the login screen. */
  addingFromKey: string | null;
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
  /** Sign in: adds the account (or refreshes its token) and makes it active. */
  login: (token: string, user: User) => Promise<void>;
  updateUser: (patch: Partial<User>) => void;
  setRequiresAgreement: (v: boolean) => void;
  /** Make another signed-in account active. Callers stop per-account work first (lib/accounts.ts). */
  switchAccount: (key: string) => Promise<void>;
  /** Park the active account and show the login screen; cancelAddAccount() returns to it. */
  beginAddAccount: () => void;
  cancelAddAccount: () => Promise<void>;
  /** Sign out of the active account only; the next signed-in account (if any) becomes active. */
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => {
  /** Load `account` (or nothing) into the active-session fields. */
  async function activate(account: Account | null, accounts = get().accounts): Promise<void> {
    const token = account ? await SecureStore.getItemAsync(tokenKey(account.key)) : null;
    const ws = account?.workspaceUrl || get().workspaceUrl;
    set({
      accounts,
      activeKey: account && token ? account.key : null,
      addingFromKey: null,
      token: account ? token : null,
      user: account ? account.user : null,
      workspaceUrl: ws,
      branding: account ? account.branding : get().branding,
      aiAgent: account ? account.aiAgent : null,
      requiresAgreement: account?.user?.role === 'pending_agreement',
    });
    await persistAccounts(accounts, account && token ? account.key : null);
    if (account) {
      await AsyncStorage.setItem(WORKSPACE_KEY, ws).catch(() => {});
      if (account.branding) await AsyncStorage.setItem(BRANDING_KEY, JSON.stringify(account.branding)).catch(() => {});
    }
  }

  /** Update the active account's cached metadata (no-op while signed out / adding). */
  function patchActive(patch: Partial<Pick<Account, 'user' | 'userId' | 'branding' | 'aiAgent'>>): void {
    const { accounts, activeKey } = get();
    if (!activeKey) return;
    const next = accounts.map(a => (a.key === activeKey ? { ...a, ...patch } : a));
    set({ accounts: next });
    persistAccounts(next, activeKey).catch(() => {});
  }

  /** Drop an account and its token from the device. */
  async function forget(key: string): Promise<Account[]> {
    await SecureStore.deleteItemAsync(tokenKey(key)).catch(() => {});
    return get().accounts.filter(a => a.key !== key);
  }

  return {
    hydrated: false,
    accounts: [],
    activeKey: null,
    addingFromKey: null,
    token: null,
    user: null,
    workspaceUrl: DEFAULT_WORKSPACE_URL,
    branding: null,
    aiAgent: null,
    requiresAgreement: false,

    hydrate: async () => {
      try {
        const [indexJson, activeKey, metaJson, ws, brandingJson] = await Promise.all([
          SecureStore.getItemAsync(ACCOUNTS_KEY),
          SecureStore.getItemAsync(ACTIVE_KEY),
          AsyncStorage.getItem(META_KEY),
          AsyncStorage.getItem(WORKSPACE_KEY),
          AsyncStorage.getItem(BRANDING_KEY),
        ]);
        const meta: Meta = metaJson ? JSON.parse(metaJson) : {};
        let accounts: Account[] = (indexJson ? (JSON.parse(indexJson) as IndexEntry[]) : []).map(e => ({
          ...e, user: meta[e.key]?.user ?? null, branding: meta[e.key]?.branding ?? null, aiAgent: meta[e.key]?.aiAgent ?? null,
        }));
        let active = activeKey;

        // Migrate the pre-switching single session into the account list.
        const legacyToken = await SecureStore.getItemAsync(LEGACY_TOKEN_KEY);
        if (legacyToken) {
          if (!indexJson) {
            const [userJson, aiAgentJson] = await Promise.all([AsyncStorage.getItem(LEGACY_USER_KEY), AsyncStorage.getItem(LEGACY_AI_AGENT_KEY)]);
            const user: User | null = userJson ? JSON.parse(userJson) : null;
            const key = newKey();
            await SecureStore.setItemAsync(tokenKey(key), legacyToken);
            accounts = [{
              key, workspaceUrl: cleanUrl(ws || DEFAULT_WORKSPACE_URL), userId: user?.id ?? null, user,
              branding: brandingJson ? JSON.parse(brandingJson) : null, aiAgent: aiAgentJson ? JSON.parse(aiAgentJson) : null,
            }];
            active = key;
          }
          await SecureStore.deleteItemAsync(LEGACY_TOKEN_KEY).catch(() => {});
          await AsyncStorage.multiRemove([LEGACY_USER_KEY, LEGACY_AI_AGENT_KEY]).catch(() => {});
        }

        // Expired (7-day JWT) or missing tokens: those accounts are signed out.
        const live: Account[] = [];
        for (const a of accounts) {
          const tok = await SecureStore.getItemAsync(tokenKey(a.key));
          if (tok && !tokenExpired(tok)) live.push(a);
          else await SecureStore.deleteItemAsync(tokenKey(a.key)).catch(() => {});
        }
        const current = live.find(a => a.key === active) || live[0] || null;
        set({ workspaceUrl: ws || DEFAULT_WORKSPACE_URL, branding: brandingJson ? JSON.parse(brandingJson) : null });
        await activate(current, live);
        set({ hydrated: true });
      } catch {
        set({ hydrated: true });
      }
    },

    setWorkspaceUrl: async (url) => {
      const clean = cleanUrl(url);
      await AsyncStorage.setItem(WORKSPACE_KEY, clean);
      set({ workspaceUrl: clean });
    },

    setBranding: (branding) => {
      AsyncStorage.setItem(BRANDING_KEY, JSON.stringify(branding)).catch(() => {});
      set({ branding });
      patchActive({ branding });
    },

    setAiAgent: (aiAgent) => {
      const value = aiAgent || null;
      set({ aiAgent: value });
      patchActive({ aiAgent: value });
    },

    login: async (token, user) => {
      const { accounts, workspaceUrl, branding, aiAgent } = get();
      const ws = cleanUrl(workspaceUrl);
      const existing = accounts.find(a => cleanUrl(a.workspaceUrl) === ws && a.userId === user.id);
      const account: Account = { key: existing?.key || newKey(), workspaceUrl: ws, userId: user.id, user, branding, aiAgent };
      await SecureStore.setItemAsync(tokenKey(account.key), token);
      const next = existing ? accounts.map(a => (a.key === account.key ? account : a)) : [...accounts, account];
      await activate(account, next);
    },

    updateUser: (patch) => {
      const user = { ...(get().user as User), ...patch };
      set({ user });
      patchActive({ user, userId: user.id ?? null });
    },

    setRequiresAgreement: (v) => set({ requiresAgreement: v }),

    switchAccount: async (key) => {
      const account = get().accounts.find(a => a.key === key);
      if (!account || key === get().activeKey) return;
      await activate(account);
    },

    beginAddAccount: () => {
      const { activeKey } = get();
      set({ addingFromKey: activeKey, activeKey: null, token: null, user: null, aiAgent: null, requiresAgreement: false });
    },

    cancelAddAccount: async () => {
      const { accounts, addingFromKey } = get();
      const back = accounts.find(a => a.key === addingFromKey) || accounts[0] || null;
      await activate(back);
    },

    logout: async () => {
      const { activeKey } = get();
      const remaining = activeKey ? await forget(activeKey) : get().accounts;
      await activate(remaining[0] || null, remaining);
    },
  };
});
