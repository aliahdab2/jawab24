/**
 * The price-list notice and its "organize into catalog" CTA.
 *
 * Contract (GA 2026-08-15 — previously an allowlist canary, owner ruling
 * 2026-08-03):
 * - EVERY merchant (no gate) gets a LIVE notice while typing, before any
 *   save, with the import CTA — except store-linked pages, whose catalog is
 *   store-owned.
 * - Merchants with existing fact collections get the lists copy, no CTA.
 * - The CTA PERSISTS the editor text before handing off (review H1): it can
 *   fire mid-edit, the handoff closes the editor, and the cleanup sheet
 *   matches against the SAVED KB — an unsaved draft would be silently lost.
 * The KB fixture uses Arabic-Indic digits on purpose — it pins the digit
 * normalization end to end (shared classifier → live banner).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from '@jawab24/shared';
import { KnowledgeBasePanel } from './KnowledgeBasePanel';

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
const SAVE_OK = { ok: true, kbWarnings: WARNINGS };

function renderPanel(p: Page = page()) {
  const onSave = vi.fn().mockResolvedValue(SAVE_OK);
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { rerender } = render(
    <QueryClientProvider client={client}>
      <KnowledgeBasePanel page={p} onClose={onClose} onSave={onSave} saving={false} saved={false} />
    </QueryClientProvider>,
  );
  const rerenderWithPage = (next: Page) =>
    rerender(
      <QueryClientProvider client={client}>
        <KnowledgeBasePanel page={next} onClose={onClose} onSave={onSave} saving={false} saved={false} />
      </QueryClientProvider>,
    );
  return { onSave, onClose, rerenderWithPage };
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

describe('KnowledgeBasePanel — price notice gating', () => {
  it('regular merchant (GA): the notice appears LIVE before any save, with the CTA', async () => {
    renderPanel();

    expect(await screen.findByText('This looks like a price list', undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByText(/Jawab can turn them into catalog items/)).toBeInTheDocument();
    expect(screen.getByText('Organize into Products & Services')).toBeInTheDocument();
  });

  it('CTA persists the editor text, then hands off draft + navigation (live notice)', async () => {
    const { onSave } = renderPanel();

    fireEvent.click(await screen.findByText('Organize into Products & Services', undefined, { timeout: 2000 }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/business?page=page-1&import=1'));
    // The save is NOT optional (review H1): the CTA fires mid-edit and the
    // handoff closes the editor — skipping it discards unsaved KB edits.
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toContain('عطر العود الملكي ٣٥٠٠ ل.س');

    const draft = JSON.parse(sessionStorage.getItem('jawab24:catalog-import-draft') ?? '{}');
    expect(draft.pageId).toBe('page-1');
    // The panel serializes its sections (headers included) — the price line
    // must survive verbatim; the extractor skips non-offering lines anyway.
    // Closing on handoff is the MODAL wrapper's job (onImportNavigate), not
    // the panel's — the panel only saves, writes the draft, and navigates.
    expect(draft.text).toContain('عطر العود الملكي ٣٥٠٠ ل.س');
  });

  it('CTA save failure: stays in the editor — no draft, no navigation, no close', async () => {
    const { onSave, onClose } = renderPanel();
    onSave.mockResolvedValue({ ok: false });

    fireEvent.click(await screen.findByText('Organize into Products & Services', undefined, { timeout: 2000 }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(sessionStorage.getItem('jawab24:catalog-import-draft')).toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // The editor is still open with the notice intact.
    expect(screen.getByText('This looks like a price list')).toBeInTheDocument();
  });

  it('store-linked page with fact collections: live notice WITHOUT the CTA (lists copy)', async () => {
    // Post-GA the import path is open to every non-store page, so the
    // lists-copy variant is only reachable where the import stays closed:
    // a store-linked page whose workspace already authors lists.
    listCollections.mockResolvedValue({ data: { data: [{ id: 'col-1', label: 'أسعار', rows: [] }] } });
    renderPanel(page({ ecommerceStoreId: 'store-1' }));

    expect(await screen.findByText('This looks like a price list', undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByText(/Exact prices belong in your lists/)).toBeInTheDocument();
    expect(screen.queryByText('Organize into Products & Services')).not.toBeInTheDocument();
  });

  it('store-linked pages get no live notice and no CTA — their catalog is store-owned', async () => {
    const { onSave } = renderPanel(page({ ecommerceStoreId: 'store-1' }));

    await new Promise((r) => setTimeout(r, 600));
    expect(screen.queryByText('This looks like a price list')).not.toBeInTheDocument();

    await save(onSave);
    expect(await screen.findByText('This looks like a price list')).toBeInTheDocument();
    expect(screen.queryByText('Organize into Products & Services')).not.toBeInTheDocument();
  });

  it('dismissing the live notice hides it for the session', async () => {
    renderPanel();

    await screen.findByText('This looks like a price list', undefined, { timeout: 2000 });
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText('This looks like a price list')).not.toBeInTheDocument();
  });

  it('a dismissed notice survives a save — the pages refetch mints a new page object, same id (review M1)', async () => {
    const { onSave, rerenderWithPage } = renderPanel();

    await screen.findByText('This looks like a price list', undefined, { timeout: 2000 });
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText('This looks like a price list')).not.toBeInTheDocument();

    await save(onSave);
    // Simulate the ['pages'] invalidation after save: a NEW object, same id.
    rerenderWithPage(page());

    // Give the debounce time to re-run detection against the "new" page.
    await new Promise((r) => setTimeout(r, 600));
    expect(screen.queryByText('This looks like a price list')).not.toBeInTheDocument();
  });

  it('save racing the collections probe: the post-save copy is replaced by the live copy, and ONE dismiss clears the slot (review M2)', async () => {
    // The probe stays pending until we resolve it — models a save landing
    // before the fact-collections request returns.
    let resolveProbe: (v: { data: { data: Array<{ id: string; label: string; rows: never[] }> } }) => void;
    listCollections.mockReturnValue(new Promise((r) => { resolveProbe = r; }));
    // Store-linked: the only page shape where the probe still gates the live
    // notice post-GA (non-store pages have the import home unconditionally).
    const { onSave } = renderPanel(page({ ecommerceStoreId: 'store-1' }));

    // Save while hasAlternativeHome is still (wrongly) false → post-save state.
    await save(onSave);
    expect(await screen.findByText('This looks like a price list')).toBeInTheDocument();
    expect(screen.getByText(/Soon you'll be able to store these/)).toBeInTheDocument();

    // The probe resolves: this merchant HAS lists → live territory. The stale
    // post-save state must be dropped, not left shadowing the live notice.
    await act(async () => { resolveProbe!({ data: { data: [{ id: 'col-1', label: 'أسعار', rows: [] }] } }); });
    expect(await screen.findByText(/Exact prices belong in your lists/, undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.queryByText(/Soon you'll be able to store these/)).not.toBeInTheDocument();

    // One click dismisses the SLOT — the other variant must not un-shadow.
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText('This looks like a price list')).not.toBeInTheDocument();
  });
});
