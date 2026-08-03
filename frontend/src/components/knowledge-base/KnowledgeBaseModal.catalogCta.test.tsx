/**
 * The price-list notice and its "organize into catalog" CTA.
 *
 * Contract (owner ruling 2026-08-03):
 * - Merchants WITH a structured home for prices (catalog canary OR existing
 *   fact collections) get a LIVE notice while typing, before any save; the
 *   CTA only when the catalog import path is open.
 * - Everyone else keeps the pre-existing POST-SAVE "coming soon" banner,
 *   untouched, with no CTA.
 * The KB fixture uses Arabic-Indic digits on purpose — it pins the digit
 * normalization end to end (shared classifier → live banner).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from '@jawab24/shared';
import { KnowledgeBaseModal } from './KnowledgeBaseModal';

const { push, authState, listCollections } = vi.hoisted(() => ({
  push: vi.fn(),
  authState: { user: { isAdmin: false } as { isAdmin?: boolean } | null },
  listCollections: vi.fn(),
}));

vi.mock('next/router', () => ({
  useRouter: () => ({ push, replace: vi.fn(), query: {}, pathname: '/', locale: 'en', isReady: true }),
}));
vi.mock('@/lib/store', () => ({
  useAuthStore: () => ({ user: authState.user, workspaces: [] }),
}));
vi.mock('@/lib/api', () => ({
  pagesApi: {
    getKbGaps: vi.fn().mockResolvedValue({ data: { data: [] } }),
    dismissGap: vi.fn().mockResolvedValue({}),
  },
  factCollectionsApi: {
    list: listCollections,
  },
  kbApi: { extractText: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// ≥ 3 prices and ≥ 50 chars so the live detector fires; Arabic-Indic digits
// so the normalization pre-pass is exercised through the real UI. Product
// lines (not courses) so `reasons` stays a pure price_list and the banner
// title is deterministic.
const PRICEY_KB = [
  'قائمة أسعار المنتجات المتوفرة لدينا حالياً:',
  'عطر العود الملكي ٣٥٠٠ ل.س',
  'عطر الياسمين ٢٥٠٠ ل.س',
  'مجموعة الهدايا ١٥٠٠ ل.س',
].join('\n');

function page(overrides: Partial<Page> = {}): Page {
  return {
    id: 'page-1', name: 'Test Page', knowledgeBase: PRICEY_KB,
    ecommerceStoreId: null,
    ...overrides,
  } as Page;
}

const WARNINGS = { hasCatalog: true, reasons: ['price_list'], priceCount: 3 };

function renderModal(p: Page = page()) {
  const onSave = vi.fn().mockResolvedValue(WARNINGS);
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <KnowledgeBaseModal page={p} onClose={onClose} onSave={onSave} saving={false} saved={false} />
    </QueryClientProvider>,
  );
  return { onSave, onClose };
}

async function save(onSave: ReturnType<typeof vi.fn>) {
  fireEvent.click(screen.getByRole('button', { name: /save/i }));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  authState.user = { isAdmin: false };
  listCollections.mockResolvedValue({ data: { data: [] } });
});

describe('KnowledgeBaseModal — price notice gating', () => {
  it('no alternative home: NO live notice; the post-save banner keeps the pre-existing copy, no CTA', async () => {
    const { onSave } = renderModal();

    // Live detection fires (debounce ~400ms) but the gate holds it back.
    await new Promise((r) => setTimeout(r, 600));
    expect(screen.queryByText('This looks like a price list')).not.toBeInTheDocument();

    await save(onSave);
    expect(await screen.findByText('This looks like a price list')).toBeInTheDocument();
    expect(screen.getByText(/Soon you'll be able to store these/)).toBeInTheDocument();
    expect(screen.queryByText('Organize into Products & Services')).not.toBeInTheDocument();
  });

  it('platform admin: the notice appears LIVE before any save, with the CTA', async () => {
    authState.user = { isAdmin: true };
    renderModal();

    expect(await screen.findByText('This looks like a price list', undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByText(/Jawab can turn them into catalog items/)).toBeInTheDocument();
    expect(screen.getByText('Organize into Products & Services')).toBeInTheDocument();
  });

  it('CTA hands off draft + navigation (admin, live notice)', async () => {
    authState.user = { isAdmin: true };
    const { onClose } = renderModal();

    fireEvent.click(await screen.findByText('Organize into Products & Services', undefined, { timeout: 2000 }));

    const draft = JSON.parse(sessionStorage.getItem('jawab24:catalog-import-draft') ?? '{}');
    expect(draft.pageId).toBe('page-1');
    // The modal serializes its sections (headers included) — the price line
    // must survive verbatim; the extractor skips non-offering lines anyway.
    expect(draft.text).toContain('عطر العود الملكي ٣٥٠٠ ل.س');
    expect(onClose).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/business?page=page-1&import=1');
  });

  it('existing fact collections open the live notice WITHOUT the CTA (lists copy)', async () => {
    listCollections.mockResolvedValue({ data: { data: [{ id: 'col-1', label: 'أسعار', rows: [] }] } });
    renderModal();

    expect(await screen.findByText('This looks like a price list', undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByText(/Exact prices belong in your lists/)).toBeInTheDocument();
    expect(screen.queryByText('Organize into Products & Services')).not.toBeInTheDocument();
  });

  it('store-linked pages get no live notice and no CTA even for a platform admin', async () => {
    authState.user = { isAdmin: true };
    const { onSave } = renderModal(page({ ecommerceStoreId: 'store-1' }));

    await new Promise((r) => setTimeout(r, 600));
    expect(screen.queryByText('This looks like a price list')).not.toBeInTheDocument();

    await save(onSave);
    expect(await screen.findByText('This looks like a price list')).toBeInTheDocument();
    expect(screen.queryByText('Organize into Products & Services')).not.toBeInTheDocument();
  });

  it('dismissing the live notice hides it for the session', async () => {
    authState.user = { isAdmin: true };
    renderModal();

    await screen.findByText('This looks like a price list', undefined, { timeout: 2000 });
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText('This looks like a price list')).not.toBeInTheDocument();
  });
});
