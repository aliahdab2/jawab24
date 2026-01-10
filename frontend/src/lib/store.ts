import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from './zustandStorage';

export type Language = 'ar' | 'en';

interface User {
  id: string;
  name: string;
  email?: string;
  facebookId: string;
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
        // Sync to legacy key for compatibility with non-Zustand code and tests
        if (typeof window !== 'undefined') {
          localStorage.setItem('token', token);
          localStorage.setItem('user', JSON.stringify(user));
        }
        // Zustand persist handles storage automatically
        set({ user, token, fbToken, isAuthenticated: true });
      },
      logout: async () => {
        // 1. Immediately clear reactive state to prevent UI flickers or auto-redirects
        set({ user: null, token: null, fbToken: null, isAuthenticated: false });

        // 2. Perform background cleanups
        if (typeof window !== 'undefined') {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          
          // Clear Native Facebook Session (non-blocking but we import Capacitor)
          try {
            const { Capacitor } = await import('@capacitor/core');
            if (Capacitor.isNativePlatform()) {
              const { FacebookLogin } = await import('@capacitor-community/facebook-login');
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
    }
  )
);

interface UIState {
  sidebarOpen: boolean;
  language: Language;
  _hasHydrated: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setLanguage: (lang: Language) => void;
  setHasHydrated: (state: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      language: 'ar' as Language,
      _hasHydrated: false,
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setLanguage: (lang) => set({ language: lang }),
      setHasHydrated: (state) => set({ _hasHydrated: state }),
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
