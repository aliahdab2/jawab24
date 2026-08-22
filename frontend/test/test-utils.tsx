import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

// ----------------------------------------------------------------------
// Mocks
// ----------------------------------------------------------------------

// next-intl is mocked globally in test/setup.ts — no local @/i18n mock needed

// 1. Mock API modules (generic mock, specific tests can override)
vi.mock('@/lib/api', () => ({
  commentsApi: {
    getAll: vi.fn(),
  },
  messagesApi: {
    getAll: vi.fn(),
    getStats: vi.fn(),
  },
  pagesApi: {
    getAll: vi.fn(),
    dismissGap: vi.fn(),
  },
  settingsApi: {
    get: vi.fn(),
  },
}));

// 3. Mock Store
const mockUIState = {
  sidebarOpen: true,
  language: 'en',
  _hasHydrated: true,
  isOnboardingVisible: false,
  unreadComments: 0,
  unreadMessages: 0,
  sseStatus: 'disconnected',
  theme: 'light' as const,
  toggleSidebar: vi.fn(),
  setTheme: vi.fn(),
  setSidebarOpen: vi.fn(),
  setLanguage: vi.fn(),
  setHasHydrated: vi.fn(),
  setOnboardingVisible: vi.fn(),
  incrementUnreadComments: vi.fn(),
  incrementUnreadMessages: vi.fn(),
  resetUnreadComments: vi.fn(),
  resetUnreadMessages: vi.fn(),
  setSSEStatus: vi.fn(),
};

vi.mock('@/lib/store', () => ({
  useAuthStore: vi.fn(() => ({
    isAuthenticated: true,
  })),
  useUIStore: vi.fn((selector?: (state: typeof mockUIState) => unknown) =>
    selector ? selector(mockUIState) : mockUIState,
  ),
}));

// 4. Mock Router
vi.mock('next/router', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    pathname: '/',
    query: {},
    asPath: '/',
    isReady: true,
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  }),
}));

// 5. Mock Navigation (Next.js 13+)
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: vi.fn(),
  }),
}));


// ----------------------------------------------------------------------
// Custom Render
// ----------------------------------------------------------------------

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false, // Turn off retries for testing
    },
  },
});

type CustomRenderOptions = RenderOptions;

const customRender = (
  ui: ReactElement,
  options?: CustomRenderOptions
) => {
  const queryClient = createTestQueryClient();
  
  const AllTheProviders = ({ children }: { children: React.ReactNode }) => {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };

  return render(ui, { wrapper: AllTheProviders, ...options });
};

/**
 * The parsed JSON-LD object of the given `@type` rendered into `container`.
 * Only useful in tests that mock `next/head` to render its children inline —
 * the default mock drops them, and the JSON-LD lives inside <Head>.
 */
export function jsonLdOfType(container: HTMLElement, type: string): Record<string, unknown> {
  const found = Array.from(container.querySelectorAll('script[type="application/ld+json"]'))
    .map((s) => JSON.parse(s.textContent ?? '{}') as Record<string, unknown>)
    .find((j) => j['@type'] === type);
  if (!found) throw new Error(`no JSON-LD of @type ${type} in the rendered page`);
  return found;
}

// Re-export everything
export * from '@testing-library/react';
export { customRender as render };
