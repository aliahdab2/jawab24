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
  facebookId?: string | null;
  phone?: string | null;
  picture?: string;
  isAdmin?: boolean;
  // Reseller / country rep — gates the Partner nav entry only. Server-resolved
  // at login and refreshed from /auth/me, so a partner registered after this
  // device signed in picks it up without a re-login.
  isPartner?: boolean;
  hasEcommerceStore?: boolean;
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
  updateUser: (patch: Partial<User>) => void;
  /**
   * Replace the workspaces list. When `defaultWorkspaceId` is provided AND
   * present in the new list, it overrides the persisted activeWorkspaceId —
   * this is how the server tells the client "land here" on login. Without
   * an override, the existing activeWorkspaceId is preserved if still valid,
   * otherwise we fall back to workspaces[0].
   */
  setWorkspaces: (workspaces: WorkspaceSummary[], options?: { defaultWorkspaceId?: string | null }) => void;
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
      setWorkspaces: (workspaces, options) => set((state) => {
        // Server-recommended default takes precedence over persisted state.
        // This is how login responses pull a stale device into line — Noor's
        // device persisted her empty solo workspace; backend now says "use
        // Ali's workspace instead", and we honor it.
        if (options?.defaultWorkspaceId && workspaces.some(w => w.id === options.defaultWorkspaceId)) {
          return { workspaces, activeWorkspaceId: options.defaultWorkspaceId };
        }
        // No server override: preserve the current activeWorkspaceId if it's
        // still in the new list, otherwise fall back to workspaces[0]. This
        // keeps mid-session refreshes (workspace list re-fetches) from
        // surprising the user.
        const stillValid = state.activeWorkspaceId !== null &&
          workspaces.some(w => w.id === state.activeWorkspaceId);
        const activeId = stillValid ? state.activeWorkspaceId : (workspaces[0]?.id ?? null);
        return { workspaces, activeWorkspaceId: activeId };
      }),
      setActiveWorkspace: (id) => {
        set({ activeWorkspaceId: id });
        // Persist the choice on the server so other devices and future logins
        // pick up the same workspace. Fire-and-forget — UI shouldn't block on
        // this; if the network drops, the worst case is a stale last-active on
        // the server which gets corrected on the next switch.
        if (typeof window !== 'undefined') {
          import('./api').then(({ api }) => {
            api.patch('/me/last-workspace', { workspaceId: id }).catch(() => {
              // Swallow — the local state is correct, server retries on next switch
            });
          }).catch(() => {});
        }
      },
      updateUser: (patch) => set((state) => state.user ? { user: { ...state.user, ...patch } } : state),
      setAuth: (user, token, fbToken) => {
        // Defensive validation
        if (!user?.id || !token || token.trim() === '') {
          Sentry.captureMessage('Invalid auth data provided to setAuth', {
            level: 'error',
            extra: {
              hasUser: !!user,
              hasUserId: !!user?.id,
              userKeys: user && typeof user === 'object' ? Object.keys(user) : null,
              hasToken: !!token,
              tokenType: typeof token,
              tokenLength: typeof token === 'string' ? token.length : null,
              tokenIsEmptyString: token === '',
              tokenIsWhitespace: typeof token === 'string' && token.trim() === '' && token.length > 0,
              hasFbToken: !!fbToken,
            },
          });
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
        
        // Set Sentry user context so every frontend error is linked to the user
        Sentry.setUser({ id: user.id, email: user.email });

        // Zustand persist handles storage automatically
        set({ user, token, fbToken, isAuthenticated: true });
      },
      logout: async () => {
        // Clear Sentry user context on logout
        Sentry.setUser(null);

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
                // Persist user, isAuthenticated, activeWorkspaceId, and workspaces so the
                // workspace switcher and role checks survive page refreshes.
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { token, fbToken, ...rest } = state;
                return rest;
            }
        }
        // On Native: Persist everything including workspaces so the switcher and
        // useWorkspaceRole return correct values after a cold app restart.
        return state;
      },
    }
  )
);

export type SSEStatus = 'connected' | 'reconnecting' | 'disconnected';
export type Theme = 'light' | 'dark' | 'system';

interface UIState {
  sidebarOpen: boolean;
  language: Language;
  theme: Theme;
  _hasHydrated: boolean;
  isOnboardingVisible: boolean;
  // Ephemeral state (not persisted, reset on page reload)
  isOffline: boolean;
  unreadComments: number;
  unreadMessages: number;
  notificationUnreadCount: number;
  sseStatus: SSEStatus;
  setOffline: (offline: boolean) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setLanguage: (lang: Language) => void;
  setTheme: (theme: Theme) => void;
  setHasHydrated: (state: boolean) => void;
  setOnboardingVisible: (visible: boolean) => void;
  incrementUnreadComments: () => void;
  incrementUnreadMessages: () => void;
  resetUnreadComments: () => void;
  resetUnreadMessages: () => void;
  setNotificationUnreadCount: (count: number) => void;
  setSSEStatus: (status: SSEStatus) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      language: 'ar' as Language,
      theme: 'system' as Theme,
      _hasHydrated: false,
      isOnboardingVisible: false,
      isOffline: false,
      unreadComments: 0,
      unreadMessages: 0,
      sseStatus: 'disconnected' as SSEStatus,
      setOffline: (offline) => set({ isOffline: offline }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setLanguage: (lang) => set({ language: lang }),
      setTheme: (theme) => set({ theme }),
      setHasHydrated: (state) => set({ _hasHydrated: state }),
      setOnboardingVisible: (visible) => set({ isOnboardingVisible: visible }),
      incrementUnreadComments: () => set((state) => ({ unreadComments: state.unreadComments + 1 })),
      incrementUnreadMessages: () => set((state) => ({ unreadMessages: state.unreadMessages + 1 })),
      resetUnreadComments: () => set({ unreadComments: 0 }),
      resetUnreadMessages: () => set({ unreadMessages: 0 }),
      notificationUnreadCount: 0,
      setNotificationUnreadCount: (count) => set({ notificationUnreadCount: count }),
      setSSEStatus: (status) => set({ sseStatus: status }),
    }),
    {
      name: 'ui-storage',
      storage: createJSONStorage(() => ({
        getItem: async (name) => (await getPersistStorage()).getItem(name),
        setItem: async (name, value) => (await getPersistStorage()).setItem(name, value),
        removeItem: async (name) => (await getPersistStorage()).removeItem(name),
      })),
      partialize: (state) => ({ language: state.language, theme: state.theme }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
