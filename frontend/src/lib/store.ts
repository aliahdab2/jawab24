/**
 * Global Zustand stores for authentication and UI state.
 *
 * - **useAuthStore** — user session, tokens, workspace selection.
 *   Persisted via Capacitor Preferences (native) or localStorage (web).
 *   On web, tokens are NOT persisted (session relies on HttpOnly cookies).
 * - **useUIStore** — sidebar toggle, language preference, onboarding visibility.
 *   Only the `language` field is persisted across sessions.
 *
 * Both stores expose a `_hasHydrated` flag that flips to `true` once
 * async rehydration finishes — the app renders a skeleton until then.
 *
 * @module store
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as Sentry from '@sentry/nextjs';
import { getPersistStorage } from './zustandStorage';
import { isNativePlatform } from './capacitor';
import { addErrorBreadcrumb } from '@/lib/sentryHelpers';
import type { WorkspaceSummary } from '@jawab24/shared';

export type { WorkspaceSummary };

export type Language = 'ar' | 'en';

interface User {
  id: string;
  name: string;
  email?: string;
  facebookId: string;
  picture?: string;
  isAdmin?: boolean;
}

interface AuthState {
  user: User | null;
  token: string | null;
  fbToken: string | null;
  isAuthenticated: boolean;
  _hasHydrated: boolean;
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
  setAuth: (user: User, token: string, fbToken: string) => void;
  setWorkspaces: (workspaces: WorkspaceSummary[]) => void;
  setActiveWorkspace: (id: string) => void;
  logout: () => void;
  setHasHydrated: (state: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      fbToken: null,
      isAuthenticated: false,
      _hasHydrated: false,
      workspaces: [],
      activeWorkspaceId: null,
      setWorkspaces: (workspaces) => {
        const activeId = workspaces[0]?.id ?? null;
        set({ workspaces, activeWorkspaceId: activeId });
      },
      setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
      setAuth: (user, token, fbToken) => {
        // Defensive validation
        if (!user?.id || !token || token.trim() === '') {
          Sentry.captureMessage('Invalid auth data provided to setAuth', { level: 'error', extra: { hasUser: !!user, hasUserId: !!user?.id, hasToken: !!token } });
          return;
        }

        // Sync to legacy key for compatibility but ONLY for Native (Mobile)
        // Web uses HttpOnly cookies so we should NOT store token in localStorage
        if (typeof window !== 'undefined') {
          // Dynamic import to avoid SSR issues
          import('@capacitor/core').then(({ Capacitor }) => {
              if (Capacitor.isNativePlatform()) {
                  localStorage.setItem('token', token);
                  localStorage.setItem('user', JSON.stringify(user));
              } else {
                  // Clean up legacy tokens on web to ensure we switch to cookies
                  localStorage.removeItem('token');
                  localStorage.removeItem('user');
              }
          });
        }
        
        // Zustand persist handles storage automatically
        set({ user, token, fbToken, isAuthenticated: true });
      },
      logout: async () => {
        // Use centralized AuthManager for consistent logout behavior
        // This ensures the same logout flow is used everywhere (interceptors, UI, etc.)
        const { authManager } = await import('./authManager');
        
        // Don't redirect here - let the caller handle navigation
        await authManager.logout({ redirect: false, reason: 'User initiated logout' });
        
        // Clear Native Facebook Session (mobile-specific, non-blocking)
        if (typeof window !== 'undefined') {
          try {
            const { Capacitor } = await import('@capacitor/core');
            if (Capacitor.isNativePlatform()) {
              const { FacebookLogin } = await import('@capacitor-community/facebook-login');
              const fbAppId = process.env.NEXT_PUBLIC_FB_APP_ID;
              if (fbAppId) {
                try {
                  await FacebookLogin.initialize({ appId: fbAppId });
                } catch {
                  // May already be initialized - ignore
                }
              }
              await FacebookLogin.logout();
            }
          } catch (e) {
            addErrorBreadcrumb('auth', 'Facebook SDK logout failed', { error: String(e) });
          }
        }
      },
      setHasHydrated: (state) => {
        set({ _hasHydrated: state });
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => ({
        getItem: async (name) => (await getPersistStorage()).getItem(name),
        setItem: async (name, value) => (await getPersistStorage()).setItem(name, value),
        removeItem: async (name) => (await getPersistStorage()).removeItem(name),
      })),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      partialize: (state) => {
        if (typeof window !== 'undefined') {
            // Dynamic check for native platform
            const isNative = isNativePlatform();
            if (!isNative) {
                // On Web: Do NOT persist token or fbToken (security + conflict with cookies)
                // We only persist the user object, isAuthenticated flag, and activeWorkspaceId for UI state
                // The actual session is validated via cookies
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { token, fbToken, workspaces, ...rest } = state;
                return rest; // includes activeWorkspaceId so header survives page refresh
            }
        }
        // On Native: Persist everything except workspaces list (refetched on login)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { workspaces, ...rest } = state;
        return rest;
      },
    }
  )
);

interface UIState {
  sidebarOpen: boolean;
  language: Language;
  _hasHydrated: boolean;
  isOnboardingVisible: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setLanguage: (lang: Language) => void;
  setHasHydrated: (state: boolean) => void;
  setOnboardingVisible: (visible: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      language: 'ar' as Language,
      _hasHydrated: false,
      isOnboardingVisible: false,
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setLanguage: (lang) => set({ language: lang }),
      setHasHydrated: (state) => set({ _hasHydrated: state }),
      setOnboardingVisible: (visible) => set({ isOnboardingVisible: visible }),
    }),
    {
      name: 'ui-storage',
      storage: createJSONStorage(() => ({
        getItem: async (name) => (await getPersistStorage()).getItem(name),
        setItem: async (name, value) => (await getPersistStorage()).setItem(name, value),
        removeItem: async (name) => (await getPersistStorage()).removeItem(name),
      })),
      partialize: (state) => ({ language: state.language }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
