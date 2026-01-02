import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

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
        if (typeof window !== 'undefined') {
          localStorage.setItem('token', token);
        }
        set({ user, token, fbToken, isAuthenticated: true });
      },
      logout: () => {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('token');
        }
        set({ user: null, token: null, fbToken: null, isAuthenticated: false });
      },
      setHasHydrated: (state) => {
        set({ _hasHydrated: state });
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
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
      language: 'ar' as Language, // Arabic is default
      _hasHydrated: false,
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setLanguage: (lang) => set({ language: lang }),
      setHasHydrated: (state) => set({ _hasHydrated: state }),
    }),
    {
      name: 'ui-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ language: state.language }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
