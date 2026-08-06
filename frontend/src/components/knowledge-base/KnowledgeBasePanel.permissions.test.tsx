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
 *
 * Every expected string is READ FROM THE i18n JSON, never retyped. A negative
 * assertion against a hand-written label is the one kind of test that fails
 * open: `queryByText(/add (a )?section/i)` passed happily against the real
 * label "Add new section" whether the button rendered or not.
 */
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, WorkspaceRole } from '@jawab24/shared';
import commonEn from '@/i18n/en/common.json';
import kbEn from '@/i18n/en/kb.json';
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

const GAP_QUESTION = 'هل لديكم توصيل؟';

function withGap() {
  getKbGaps.mockResolvedValue({
    data: { data: [{ id: 'gap-1', queryText: GAP_QUESTION, occurrenceCount: 2, createdAt: '2026-08-06T00:00:00.000Z' }] },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getKbGaps.mockResolvedValue({ data: { data: [] } });
  asRole('owner');
});

describe('KnowledgeBasePanel — who may edit Business Info', () => {
  it('member: view-only banner, no Save, and the text stays readable and copyable', async () => {
    asRole('member');
    await renderPanel();

    expect(screen.getByText(commonEn.viewOnlyHint)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: commonEn.save })).not.toBeInTheDocument();

    // readOnly, NOT disabled: a member must still be able to read, select and
    // copy the Business Info. A disabled textarea is unreachable by keyboard.
    const editors = screen.getAllByRole('textbox');
    expect(editors.length).toBeGreaterThan(0);
    for (const el of editors) {
      expect(el).toHaveAttribute('readonly');
      expect(el).not.toBeDisabled();
    }
  });

  it('member: every write affordance is gone — add-section and file upload', async () => {
    asRole('member');
    await renderPanel();

    // The exact labels, from the JSON — the previous hand-typed regex could not
    // match `addCustomSection` ("Add new section") and so proved nothing.
    //
    // The voice button is deliberately NOT asserted: `VoiceRecordButton` bails
    // to `null` when `useVoiceRecorder` reports no support, and jsdom has no
    // `navigator.mediaDevices` — so it is absent for EVERY role here and
    // "member cannot see it" would be true no matter what the code did. The
    // paired owner test below is what makes these two assertions mean anything.
    expect(screen.queryByText(kbEn.addCustomSection)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: kbEn.uploadFile })).not.toBeInTheDocument();
  });

  it('owner: those same affordances ARE present (so the assertions above can fail)', async () => {
    await renderPanel();

    expect(screen.getByText(kbEn.addCustomSection)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: kbEn.uploadFile })).toBeInTheDocument();
  });

  it('member: raw mode is read-only too — the whole KB in one textarea is the widest write surface', async () => {
    asRole('member');
    await renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByText(kbEn.showRawText));
    });

    const raw = screen.getByRole('textbox', { name: kbEn.title });
    expect(raw).toHaveAttribute('readonly');
    expect(raw).not.toBeDisabled();
    // Raw mode shows the SERIALIZED sections, so the merchant's text is in
    // there under its section heading — the point is that it is all readable.
    expect((raw as HTMLTextAreaElement).value).toContain(page().knowledgeBase);
  });

  it('member: the modal still offers a way out, and it works', async () => {
    asRole('member');
    const { onClose } = await renderPanel();

    // Cancel becomes Close — with Save gone it is the only exit. Asserted by
    // USING it, not by inspecting its class list.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: commonEn.close }));
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('member: sees the unanswered questions, but none of their admin actions', async () => {
    asRole('member');
    withGap();
    await renderPanel();

    // The QUESTION is information — the member working the inbox is often the
    // one who knows the answer. Only approve/skip (both admin-only) go.
    expect(screen.getByText(GAP_QUESTION)).toBeInTheDocument();
    expect(screen.getByText(kbEn.gaps.hintViewOnly)).toBeInTheDocument();
    expect(screen.queryByText(kbEn.gaps.hint)).not.toBeInTheDocument();

    // The card cannot be opened, so neither action is reachable.
    await act(async () => {
      fireEvent.click(screen.getByText(GAP_QUESTION));
    });
    expect(screen.queryByRole('button', { name: kbEn.gaps.addToKb })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: kbEn.gaps.skip })).not.toBeInTheDocument();
  });

  it('admin: the same gap card opens onto its actions', async () => {
    asRole('admin');
    withGap();
    await renderPanel();

    expect(screen.getByText(kbEn.gaps.hint)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText(GAP_QUESTION));
    });
    expect(screen.getByRole('button', { name: kbEn.gaps.skip })).toBeInTheDocument();
  });

  it.each(['owner', 'admin'] as const)('%s: full editor — Save present, no banner, nothing read-only', async (role) => {
    asRole(role);
    await renderPanel();

    expect(screen.queryByText(commonEn.viewOnlyHint)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: commonEn.save })).toBeInTheDocument();
    for (const el of screen.getAllByRole('textbox')) {
      expect(el).not.toHaveAttribute('readonly');
    }
  });
});
