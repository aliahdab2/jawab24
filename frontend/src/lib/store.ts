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
        // Zustand persist handles storage automatically
        set({ user, token, fbToken, isAuthenticated: true });
      },
      logout: () => {
        // Zustand persist handles storage cleanup automatically
        set({ user: null, token: null, fbToken: null, isAuthenticated: false });
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
