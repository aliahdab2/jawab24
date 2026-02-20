import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Setup environment variables for tests
process.env.NEXT_PUBLIC_FB_APP_ID = 'test-fb-app-id-123456';
process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4000/api';
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';

// ──────────────────────────────────────────────
// Suppress expected jsdom network noise
// jsdom fires console.error for XMLHttpRequest and fetch
// failures that are *expected* in tests (mocked APIs,
// aborted requests, etc.). These hide real failures.
// ──────────────────────────────────────────────
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

const SUPPRESSED_PATTERNS = [
  /AggregateError/,
  /Error: connect ECONNREFUSED/,
  /Error: getaddrinfo/,
  /Failed to fetch/,
  /Network Error/,
  /XMLHttpRequest/,
  /Simulating Sanctions/,
  /Geo check/i,
  /Using fallback plans/,
  /Logout triggered:/,
  /Not implemented: navigation/,
  /Error: Not implemented/,
];

console.error = (...args: unknown[]) => {
  const msg = args.map(String).join(' ');
  if (SUPPRESSED_PATTERNS.some(p => p.test(msg))) return;
  originalConsoleError(...args);
};

console.warn = (...args: unknown[]) => {
  const msg = args.map(String).join(' ');
  if (SUPPRESSED_PATTERNS.some(p => p.test(msg))) return;
  originalConsoleWarn(...args);
};

// Mock Next.js router
vi.mock('next/router', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    query: {},
    pathname: '/',
    locale: 'en',
  }),
}));

// Mock window.matchMedia for responsive tests
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock localStorage with functional implementation
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

