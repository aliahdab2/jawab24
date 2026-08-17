import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OnboardingWizard } from './OnboardingWizard';

const { getAll, getById, sync, toggle, testReply, apiGet, apiPut } = vi.hoisted(() => ({
  getAll: vi.fn(),
  // The wizard prefills the info editor from the SINGLE-page read: the list
  // endpoint no longer ships knowledgeBase / suggestedKnowledgeBase (see
  // serializeListPage, backend controllers/pages.ts).
  getById: vi.fn(),
  sync: vi.fn(),
  toggle: vi.fn(),
  testReply: vi.fn(),
  apiGet: vi.fn(),
  apiPut: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  pagesApi: { getAll, getById, sync, toggle, testReply },
  api: { get: apiGet, put: apiPut },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/store', () => ({ useAuthStore: () => ({ fbToken: null }) }));
vi.mock('@/lib/sentryHelpers', () => ({ captureError: vi.fn() }));

// Mock the three step bodies — this test exercises the wizard's orchestration
// (step flow, persist-on-enter, finish CTA), not the steps' internals. The real
// TryReplyStep is covered by TryReplyStep.test.tsx.
vi.mock('./PickPageStep', () => ({
  PickPageStep: ({ pages, onToggle }: { pages: { length: number }; onToggle: (id: string, enabled: boolean) => void }) => (
    <div>
      <span>loaded-{pages.length}</span>
      <button onClick={() => onToggle('page-1', true)}>mock-enable-page</button>
    </div>
  ),
}));
vi.mock('./ReviewInfoStep', () => ({ ReviewInfoStep: () => <div>mock-review</div> }));
vi.mock('./TryReplyStep', () => ({
  TryReplyStep: ({ onReplyShown }: { onReplyShown: () => void }) => (
    <button onClick={onReplyShown}>mock-try</button>
  ),
}));

const PAGE = {
  id: 'page-1',
  name: 'My Page',
  knowledgeBase: 'We sell shoes',
  suggestedKnowledgeBase: '',
  autoReplyEnabled: false,
  instagramAutoReplyEnabled: false,
};

function renderWizard() {
  const onComplete = vi.fn();
  const onSkip = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <OnboardingWizard onComplete={onComplete} onSkip={onSkip} />
    </QueryClientProvider>,
  );
  return { onComplete, onSkip };
}

describe('OnboardingWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAll.mockResolvedValue({ data: [PAGE] });
    // Same row, but this is the shape that carries the business-info TEXT.
    getById.mockResolvedValue({ data: PAGE });
    sync.mockResolvedValue({ data: [PAGE] });
    toggle.mockResolvedValue({ data: {} });
    apiGet.mockResolvedValue({ data: { pages: { limit: 5 } } });
    apiPut.mockResolvedValue({ data: {} });
  });

  it('runs the 3-step flow, saving Business Info before the Try step and on finish', async () => {
    const { onComplete } = renderWizard();

    // Step 1/3 — pick page. Wait for pages to load, then enable one.
    expect(await screen.findByText('Step 1 of 3')).toBeInTheDocument();
    await screen.findByText('loaded-1');
    fireEvent.click(screen.getByText('mock-enable-page'));

    // Advance to step 2 (review).
    const next = await screen.findByRole('button', { name: /Next/ });
    await waitFor(() => expect(next).not.toBeDisabled());
    fireEvent.click(next);
    expect(await screen.findByText('mock-review')).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();

    // Advance to step 3 (try) — entering it must persist the KB first.
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(await screen.findByText('mock-try')).toBeInTheDocument();
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith('/pages/page-1', { knowledgeBase: 'We sell shoes' }),
    );
    expect(apiPut).toHaveBeenCalledTimes(1);

    // Before a reply: finish CTA is the neutral copy.
    expect(screen.getByRole('button', { name: "Let's Go!" })).toBeInTheDocument();

    // After a reply is shown: finish CTA becomes the enthusiastic copy.
    fireEvent.click(screen.getByText('mock-try'));
    const finish = await screen.findByRole('button', { name: 'Great, enable it on my page' });

    // Finish — persists once more, then completes.
    fireEvent.click(finish);
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(apiPut).toHaveBeenCalledTimes(2);
  });
});
