import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TryReplyStep } from './TryReplyStep';
import en from '@/i18n/en/onboarding.json';
import type { TFunction } from './onboardingTypes';

const { testReply } = vi.hoisted(() => ({ testReply: vi.fn() }));

vi.mock('@/lib/api', () => ({
  pagesApi: { testReply },
}));

vi.mock('@/lib/sentryHelpers', () => ({
  captureError: vi.fn(),
}));

// Resolve onboarding keys to the real English strings (CLAUDE.md rule 6 — tests
// import translation JSON, never hardcode translated text).
const t: TFunction = (key, params) => {
  const sub = key.replace(/^onboarding\./, '');
  let s = (en as Record<string, string>)[sub] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return s;
};

function renderStep(props: Partial<React.ComponentProps<typeof TryReplyStep>> = {}) {
  const onReplyShown = props.onReplyShown ?? vi.fn();
  render(
    <TryReplyStep
      pageId="page-1"
      hasKnowledgeBase
      isLandscape={false}
      t={t}
      onReplyShown={onReplyShown}
      {...props}
    />,
  );
  return { onReplyShown };
}

describe('TryReplyStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pre-fills the editable sample question and shows the idle placeholder', () => {
    renderStep();
    const input = screen.getByLabelText(en.tryQuestionLabel) as HTMLInputElement;
    expect(input.value).toBe(en.trySampleQuestion);
    expect(screen.getByText(en.tryPlaceholderHint)).toBeInTheDocument();
  });

  it('generates a reply via testReply and renders it in a bubble with the badge', async () => {
    testReply.mockResolvedValue({
      data: { success: true, data: { reply: 'Delivery costs 20 SAR.', replyMethod: 'ai', latencyMs: 800 } },
    });
    const { onReplyShown } = renderStep();

    fireEvent.click(screen.getByRole('button', { name: en.tryButton }));

    expect(await screen.findByText('Delivery costs 20 SAR.')).toBeInTheDocument();
    expect(screen.getByText(en.tryReplyBadge)).toBeInTheDocument();
    expect(testReply).toHaveBeenCalledWith('page-1', { question: en.trySampleQuestion, channel: 'dm' });
    expect(onReplyShown).toHaveBeenCalledTimes(1);
  });

  it('sends the edited question, trimmed', async () => {
    testReply.mockResolvedValue({ data: { data: { reply: 'Sure!' } } });
    renderStep();

    const input = screen.getByLabelText(en.tryQuestionLabel);
    fireEvent.change(input, { target: { value: '  Do you ship to Riyadh?  ' } });
    fireEvent.click(screen.getByRole('button', { name: en.tryButton }));

    await screen.findByText('Sure!');
    expect(testReply).toHaveBeenCalledWith('page-1', { question: 'Do you ship to Riyadh?', channel: 'dm' });
  });

  it('shows a friendly retry message when the request fails', async () => {
    testReply.mockRejectedValue(new Error('network down'));
    const { onReplyShown } = renderStep();

    fireEvent.click(screen.getByRole('button', { name: en.tryButton }));

    expect(await screen.findByText(en.tryError)).toBeInTheDocument();
    expect(onReplyShown).not.toHaveBeenCalled();
  });

  it('shows a rate-limit message (not a generic retry) on HTTP 429', async () => {
    testReply.mockRejectedValue({ response: { status: 429 } });
    const { onReplyShown } = renderStep();

    fireEvent.click(screen.getByRole('button', { name: en.tryButton }));

    expect(await screen.findByText(en.tryRateLimit)).toBeInTheDocument();
    expect(onReplyShown).not.toHaveBeenCalled();
  });

  it('shows the quota message on 403 AI_QUOTA_EXCEEDED', async () => {
    testReply.mockRejectedValue({ response: { status: 403, data: { code: 'AI_QUOTA_EXCEEDED' } } });
    renderStep();

    fireEvent.click(screen.getByRole('button', { name: en.tryButton }));

    // jsdom is non-iOS, so the non-iOS (upgrade) variant is shown.
    expect(await screen.findByText(en.tryQuotaExceeded)).toBeInTheDocument();
  });

  it('treats an empty (skipped) reply as a retryable error, not a blank bubble', async () => {
    testReply.mockResolvedValue({ data: { data: { reply: '' } } });
    const { onReplyShown } = renderStep();

    fireEvent.click(screen.getByRole('button', { name: en.tryButton }));

    expect(await screen.findByText(en.tryError)).toBeInTheDocument();
    expect(onReplyShown).not.toHaveBeenCalled();
  });

  it('shows the empty-Business-Info hint only when there is no knowledge base', () => {
    const { unmount } = render(
      <TryReplyStep pageId="page-1" hasKnowledgeBase={false} isLandscape={false} t={t} onReplyShown={vi.fn()} />,
    );
    expect(screen.getByText(en.tryEmptyKbHint)).toBeInTheDocument();
    unmount();

    renderStep({ hasKnowledgeBase: true });
    expect(screen.queryByText(en.tryEmptyKbHint)).not.toBeInTheDocument();
  });
});
