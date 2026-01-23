import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from './zustandStorage';

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
  setAuth: (user: User, token: string, fbToken: string) => void;
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
      setAuth: (user, token, fbToken) => {
        // Defensive validation
        if (!user?.id || !token || token.trim() === '') {
          console.error('Invalid auth data provided to setAuth:', { hasUser: !!user, hasUserId: !!user?.id, hasToken: !!token });
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
            console.error('Failed to logout from Facebook SDK:', e);
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
            const isNative = !!(window as any).Capacitor?.isNativePlatform?.();
            if (!isNative) {
                // On Web: Do NOT persist token or fbToken (security + conflict with cookies)
                // We only persist the user object and isAuthenticated flag for UI state
                // The actual session is validated via cookies
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { token, fbToken, ...rest } = state;
                return rest;
            }
        }
        // On Native: Persist everything
        return state;
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
