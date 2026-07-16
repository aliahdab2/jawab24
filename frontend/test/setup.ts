import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { cloneElement, isValidElement, type ReactNode } from 'react';

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

// Load real English translations from namespace files so tests assert actual user-visible strings.
// Falls back to 'namespace.key' format for any key not found in the JSON.
const enModules = import.meta.glob('../src/i18n/en/*.json', { eager: true });
const EN_MESSAGES: Record<string, Record<string, unknown>> = {};
for (const [path, mod] of Object.entries(enModules)) {
  const ns = path.replace('../src/i18n/en/', '').replace('.json', '');
  EN_MESSAGES[ns] = (mod as { default: Record<string, unknown> }).default;
}
// flagReason translations live in @jawab24/shared (not a local JSON file)
import { flagReasonEn } from '@jawab24/shared';
EN_MESSAGES['flagReason'] = flagReasonEn as Record<string, unknown>;

function resolveNestedKey(obj: Record<string, unknown>, key: string): string | undefined {
  const parts = key.split('.');
  let val: unknown = obj;
  for (const part of parts) {
    if (typeof val !== 'object' || val === null) return undefined;
    val = (val as Record<string, unknown>)[part];
  }
  return typeof val === 'string' ? val : undefined;
}

/** Resolve ICU plural format: "{count, plural, one {# item} other {# items}}" */
function resolveICUPlural(str: string, params: Record<string, unknown>): string {
  return str.replace(/\{(\w+),\s*plural\s*,([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, (_, varName, cases) => {
    const count = Number(params[varName] ?? 0);
    const form = new Intl.PluralRules('en').select(count);
    // Try to match the exact form, then fall back to 'other'
    const formMatch = cases.match(new RegExp(`${form}\\s*\\{([^}]*)\\}`));
    const otherMatch = cases.match(/other\s*\{([^}]*)\}/);
    const text = (formMatch?.[1] ?? otherMatch?.[1] ?? String(count)).trim();
    return text.replace(/#/g, String(count));
  });
}

// Mock next-intl: returns real English translation values so tests verify actual UI text.
vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => {
    const t = (key: string, params?: Record<string, unknown>) => {
      const raw = ns
        ? resolveNestedKey(EN_MESSAGES[ns] ?? {}, key) ?? `${ns}.${key}`
        : key;
      if (!params) return raw;
      // First resolve ICU plural expressions, then do simple {key} substitution
      const afterPlural = resolveICUPlural(raw, params);
      return Object.entries(params).reduce(
        (str, [k, v]) => str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v)),
        afterPlural,
      );
    };
    t.has = () => true;
    t.raw = (key: string) =>
      ns ? resolveNestedKey(EN_MESSAGES[ns] ?? {}, key) ?? `${ns}.${key}` : key;
    // Minimal t.rich: resolves the raw string and replaces <tag>chunk</tag> segments
    // with the render function passed for that tag (e.g. { kb: (chunks) => <Link/> }).
    t.rich = (key: string, params?: Record<string, unknown>): ReactNode => {
      const raw = ns
        ? resolveNestedKey(EN_MESSAGES[ns] ?? {}, key) ?? `${ns}.${key}`
        : key;
      const nodes: ReactNode[] = [];
      const tagRegex = /<(\w+)>([^<]*)<\/\1>/g;
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = tagRegex.exec(raw))) {
        if (m.index > last) nodes.push(raw.slice(last, m.index));
        const renderFn = params?.[m[1]];
        const rendered: ReactNode = typeof renderFn === 'function' ? renderFn(m[2]) : m[2];
        nodes.push(isValidElement(rendered) ? cloneElement(rendered, { key: nodes.length }) : rendered);
        last = m.index + m[0].length;
      }
      if (last < raw.length) nodes.push(raw.slice(last));
      return nodes;
    };
    return t;
  },
  useLocale: () => 'en',
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
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

// Mock IntersectionObserver (not available in jsdom)
class IntersectionObserverMock {
  readonly root: Element | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn().mockReturnValue([]);
  constructor(_cb: IntersectionObserverCallback, _opts?: IntersectionObserverInit) {}
}
// configurable so individual tests can swap in a callback-driving mock via vi.stubGlobal
Object.defineProperty(window, 'IntersectionObserver', { value: IntersectionObserverMock, configurable: true });

// Mock ResizeObserver (not available in jsdom)
class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(_cb: ResizeObserverCallback) {}
}
Object.defineProperty(window, 'ResizeObserver', { value: ResizeObserverMock });

// Mock Element.scrollIntoView (not implemented in jsdom)
Element.prototype.scrollIntoView = vi.fn();

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

