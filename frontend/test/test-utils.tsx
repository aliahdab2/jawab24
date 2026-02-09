import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

// ----------------------------------------------------------------------
// Mocks
// ----------------------------------------------------------------------

// 1. Mock i18n globally for all tests using this utility
vi.mock('@/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    language: 'en',
    setLanguage: vi.fn(),
  }),
}));

// 2. Mock API modules (generic mock, specific tests can override)
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
  },
  settingsApi: {
    get: vi.fn(),
  },
}));

// 3. Mock Store
vi.mock('@/lib/store', () => ({
  useAuthStore: vi.fn(() => ({
    isAuthenticated: true,
  })),
  useUIStore: vi.fn(() => ({})),
}));

// 4. Mock Router
vi.mock('next/router', () => ({
  useRouter: () => ({
    push: vi.fn(),
    pathname: '/',
    query: {},
    asPath: '/',
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

// Re-export everything
export * from '@testing-library/react';
export { customRender as render };
