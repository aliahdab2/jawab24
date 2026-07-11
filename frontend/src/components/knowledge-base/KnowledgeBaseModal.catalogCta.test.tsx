/**
 * The price-list warning's "organize into catalog" CTA is the ONLY part of this
 * shared modal that belongs to the catalog canary. These tests pin the gate:
 * outside the allowlist the banner must look exactly as it did pre-import
 * (no CTA), and inside it the CTA hands off draft + navigation correctly.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from '@jawab24/shared';
import { KnowledgeBaseModal } from './KnowledgeBaseModal';

const { push, authState } = vi.hoisted(() => ({
  push: vi.fn(),
  authState: { user: { email: 'someone@example.com' } as { email: string } | null },
}));

vi.mock('next/router', () => ({
  useRouter: () => ({ push, replace: vi.fn(), query: {}, pathname: '/', locale: 'en', isReady: true }),
}));
vi.mock('@/lib/store', () => ({
  useAuthStore: () => ({ user: authState.user }),
}));
vi.mock('@/lib/api', () => ({
  pagesApi: {
    getKbGaps: vi.fn().mockResolvedValue({ data: { data: [] } }),
    dismissGap: vi.fn().mockResolvedValue({}),
  },
  kbApi: { extractText: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function page(overrides: Partial<Page> = {}): Page {
  return {
    id: 'page-1', name: 'Test Page', knowledgeBase: 'دورة ICDL ٣٥٠٠ ل.س',
    ecommerceStoreId: null,
    ...overrides,
  } as Page;
}

const WARNINGS = { hasCatalog: true, reasons: ['price_list'], priceCount: 3 };

async function renderAndSave(p: Page = page()) {
  const onSave = vi.fn().mockResolvedValue(WARNINGS);
  const onClose = vi.fn();
  render(
    <KnowledgeBaseModal page={p} onClose={onClose} onSave={onSave} saving={false} saved={false} />,
  );
  fireEvent.click(screen.getByRole('button', { name: /save/i }));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(await screen.findByText('This looks like a price list')).toBeInTheDocument();
  return { onSave, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  authState.user = { email: 'someone@example.com' };
});

describe('KnowledgeBaseModal — catalog import CTA gating', () => {
  it('shows NO catalog CTA for a user outside the canary allowlist', async () => {
    await renderAndSave();
    expect(screen.queryByText('Organize into Products & Services')).not.toBeInTheDocument();
    // Pre-import copy stays for everyone else.
    expect(screen.getByText(/Soon you'll be able to store these/)).toBeInTheDocument();
  });

  it('shows the CTA for the canary account and hands off draft + navigation', async () => {
    authState.user = { email: 'aliahdab@gmail.com' };
    const { onClose } = await renderAndSave();

    fireEvent.click(screen.getByText('Organize into Products & Services'));

    const draft = JSON.parse(sessionStorage.getItem('jawab24:catalog-import-draft') ?? '{}');
    expect(draft.pageId).toBe('page-1');
    // The modal serializes its sections (headers included) — the price line
    // must survive verbatim; the extractor skips non-offering lines anyway.
    expect(draft.text).toContain('دورة ICDL ٣٥٠٠ ل.س');
    expect(onClose).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/catalog?page=page-1&import=1');
  });

  it('hides the CTA on store-linked pages even for the canary account', async () => {
    authState.user = { email: 'aliahdab@gmail.com' };
    await renderAndSave(page({ ecommerceStoreId: 'store-1' }));
    expect(screen.queryByText('Organize into Products & Services')).not.toBeInTheDocument();
  });
});
