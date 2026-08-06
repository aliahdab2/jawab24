/**
 * Business Info follows the SAME permission rule as the rest of /pages and
 * /settings: everyone in the workspace reads it, only owner/admin (مشرف) may
 * write. Server-side, every write path here is `requireRole('admin')`
 * (`PUT /pages/:id`, `POST /pages/:id/kb-gaps/:gapId/dismiss`).
 *
 * The bug these pin (reported 2026-08-06): a `member` was shown the full
 * editor, typed a complete Business Info document, hit Save — and got a
 * generic "Failed to save. Please try again." with no reason, plus a Sentry
 * error for what is an ordinary authorization outcome.
 *
 * Gating lives in KnowledgeBasePanel because it is the single choke point for
 * all four entry points (/pages, /business, and the comment + message detail
 * modals via InlineKbEditorModal) — these tests drive the real
 * `useWorkspaceRole` against a mocked store rather than stubbing the hook, so
 * a change to the role→permission mapping cannot pass them silently.
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, WorkspaceRole } from '@jawab24/shared';
import { KnowledgeBasePanel } from './KnowledgeBasePanel';

const { storeState, getKbGaps } = vi.hoisted(() => ({
  storeState: {
    value: {} as Record<string, unknown>,
  },
  getKbGaps: vi.fn(),
}));

vi.mock('next/router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), query: {}, pathname: '/', locale: 'en', isReady: true }),
}));

// Honors the selector form, so the REAL useWorkspaceRole runs against it —
// it reads `workspaces` / `activeWorkspaceId` via selectors and the panel
// destructures `user` / `workspaces` from a bare call.
vi.mock('@/lib/store', () => ({
  useAuthStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    (selector ? selector(storeState.value) : storeState.value),
}));

vi.mock('@/lib/api', () => ({
  pagesApi: { getKbGaps, dismissGap: vi.fn().mockResolvedValue({}) },
  factCollectionsApi: { list: vi.fn().mockResolvedValue({ data: { data: [] } }) },
  kbApi: { extractText: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

const WORKSPACE_ID = 'ws-1';

function asRole(role: WorkspaceRole) {
  storeState.value = {
    user: { isAdmin: false },
    workspaces: [{ id: WORKSPACE_ID, role }],
    activeWorkspaceId: WORKSPACE_ID,
  };
}

function page(overrides: Partial<Page> = {}): Page {
  return {
    id: 'page-1',
    name: 'Test Page',
    knowledgeBase: 'ساعات العمل من التاسعة صباحاً حتى الخامسة مساءً.',
    ecommerceStoreId: null,
    ...overrides,
  } as Page;
}

// Async so the panel's kb-gaps fetch settles inside act() — otherwise every
// test logs an "update not wrapped in act(...)" warning as it resolves late.
async function renderPanel(p: Page = page()) {
  const onSave = vi.fn().mockResolvedValue({ ok: true });
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <KnowledgeBasePanel page={p} onSave={onSave} saving={false} saved={false} onClose={onClose} />
      </QueryClientProvider>,
    );
  });
  return { onSave, onClose };
}

const VIEW_ONLY = 'Only admins can make changes';

beforeEach(() => {
  vi.clearAllMocks();
  getKbGaps.mockResolvedValue({ data: { data: [] } });
  asRole('owner');
});

describe('KnowledgeBasePanel — who may edit Business Info', () => {
  it('member: view-only banner, no Save, and the text stays readable and copyable', async () => {
    asRole('member');
    await renderPanel();

    expect(screen.getByText(VIEW_ONLY)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();

    // readOnly, NOT disabled: a member must still be able to read, select and
    // copy the Business Info. A disabled textarea is unreachable by keyboard.
    const editors = screen.getAllByRole('textbox');
    expect(editors.length).toBeGreaterThan(0);
    for (const el of editors) {
      expect(el).toHaveAttribute('readonly');
      expect(el).not.toBeDisabled();
    }
  });

  it('member: every write affordance is gone — add-section, file upload, voice', async () => {
    asRole('member');
    await renderPanel();

    expect(screen.queryByText(/add (a )?section/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upload|file/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /record|voice|mic/i })).not.toBeInTheDocument();
  });

  it('member: the modal still offers a way out, promoted to the primary action', async () => {
    asRole('member');
    const { onClose } = await renderPanel();

    // Cancel becomes Close — with Save gone it is the only exit, so it must
    // not keep `max-sm:hidden`.
    const close = screen.getByRole('button', { name: /close/i });
    expect(close).toBeInTheDocument();
    expect(close.className).not.toContain('max-sm:hidden');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('member: unanswered-question gap cards are hidden (both actions are admin-only)', async () => {
    asRole('member');
    getKbGaps.mockResolvedValue({
      data: { data: [{ id: 'gap-1', queryText: 'هل لديكم توصيل؟', createdAt: new Date().toISOString() }] },
    });
    await renderPanel();

    expect(screen.queryByText('هل لديكم توصيل؟')).not.toBeInTheDocument();
  });

  it.each(['owner', 'admin'] as const)('%s: full editor — Save present, no banner, nothing read-only', async (role) => {
    asRole(role);
    await renderPanel();

    expect(screen.queryByText(VIEW_ONLY)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
    for (const el of screen.getAllByRole('textbox')) {
      expect(el).not.toHaveAttribute('readonly');
    }
  });
});
