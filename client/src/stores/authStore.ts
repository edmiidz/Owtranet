import { create } from 'zustand';
import { User } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
  updateUser: (user: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,
  
  login: (token: string, user: User) => {
    console.log('[AUTH] Login called with user:', user);
    console.log('[AUTH] User has github_username:', user.github_username);
    console.log('[AUTH] User has intranet_username:', user.intranet_username);
    try {
      localStorage.setItem('owtranet-token', token);
      localStorage.setItem('owtranet-user', JSON.stringify(user));
      localStorage.setItem('owtranet-cache-version', CACHE_VERSION);
      console.log('[AUTH] Successfully saved to localStorage');
      set({
        token,
        user,
        isAuthenticated: true,
        isLoading: false
      });
      console.log('[AUTH] Login completed successfully');
    } catch (error) {
      console.error('[AUTH] Login failed:', error);
      throw error;
    }
  },
  
  logout: () => {
    console.log('[AUTH] Logout called');
    console.trace('[AUTH] Logout stack trace');
    localStorage.removeItem('owtranet-token');
    localStorage.removeItem('owtranet-user');
    localStorage.removeItem('owtranet-redirect-after-login'); // Clean up any stored redirect
    set({
      token: null,
      user: null,
      isAuthenticated: false,
      isLoading: false
    });
  },
  
  setLoading: (loading: boolean) => {
    set({ isLoading: loading });
  },
  
  updateUser: (userData: Partial<User>) => {
    const currentUser = get().user;
    if (currentUser) {
      const updatedUser = { ...currentUser, ...userData };
      localStorage.setItem('owtranet-user', JSON.stringify(updatedUser));
      set({ user: updatedUser });
    }
  },
}));

// Helper to check if JWT token is expired
const isTokenExpired = (token: string): boolean => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const exp = payload.exp;
    if (!exp) return false;
    // Check if token expires in less than 1 minute (to avoid edge cases)
    return Date.now() >= (exp * 1000 - 60000);
  } catch {
    return true;
  }
};

// Version for cache invalidation - increment when User type changes
const CACHE_VERSION = '2';

// Initialize from localStorage
const initializeAuth = () => {
  console.log('[AUTH INIT] Starting auth initialization');
  const token = localStorage.getItem('owtranet-token');
  const userStr = localStorage.getItem('owtranet-user');
  const cachedVersion = localStorage.getItem('owtranet-cache-version');

  console.log('[AUTH INIT] Has token:', !!token);
  console.log('[AUTH INIT] Has user:', !!userStr);
  console.log('[AUTH INIT] Cache version:', cachedVersion, 'Expected:', CACHE_VERSION);

  // Only check cache version if user data exists
  // If no cached version but user data exists, this is a migration - set version and continue
  if (token && userStr) {
    if (cachedVersion && cachedVersion !== CACHE_VERSION) {
      // Version exists but doesn't match - clear cache
      console.log('[AUTH INIT] Cache version mismatch, clearing auth data');
      localStorage.removeItem('owtranet-token');
      localStorage.removeItem('owtranet-user');
      localStorage.removeItem('owtranet-redirect-after-login');
      localStorage.setItem('owtranet-cache-version', CACHE_VERSION);
      return;
    } else if (!cachedVersion) {
      // No version set - this is existing user, set version and continue
      console.log('[AUTH INIT] Migrating existing session to versioned cache');
      localStorage.setItem('owtranet-cache-version', CACHE_VERSION);
    }
  }

  if (token && userStr) {
    // Check if token is expired
    if (isTokenExpired(token)) {
      console.log('[AUTH INIT] Token expired, clearing auth');
      localStorage.removeItem('owtranet-token');
      localStorage.removeItem('owtranet-user');
      return;
    }

    try {
      const user = JSON.parse(userStr);
      console.log('[AUTH INIT] Parsed user:', user);
      useAuthStore.setState({
        token,
        user,
        isAuthenticated: true
      });
      console.log('[AUTH INIT] Auth initialization successful');
    } catch (error) {
      console.error('[AUTH INIT] Failed to parse cached user, clearing auth:', error);
      localStorage.removeItem('owtranet-token');
      localStorage.removeItem('owtranet-user');
    }
  } else {
    console.log('[AUTH INIT] No cached auth data found');
  }
};

// Initialize on load
if (typeof window !== 'undefined') {
  initializeAuth();
}