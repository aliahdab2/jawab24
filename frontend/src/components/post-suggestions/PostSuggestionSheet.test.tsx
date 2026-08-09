import '@testing-library/jest-dom';
import { StrictMode } from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PostSuggestionDto } from '@jawab24/shared';
import type { PostSuggestionResponse } from '@/lib/api';
import enPostSuggestions from '@/i18n/en/postSuggestions.json';
import { PostSuggestionSheet } from './PostSuggestionSheet';

const { mockGenerate, mockMarkEvent, mockToastError, mockToastSuccess, mockCaptureError } = vi.hoisted(() => ({
  mockGenerate: vi.fn(),
  mockMarkEvent: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockCaptureError: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  postSuggestionsApi: { getToday: vi.fn(), generate: mockGenerate, markEvent: mockMarkEvent },
}));
vi.mock('@/lib/sentryHelpers', () => ({ captureError: mockCaptureError }));
vi.mock('sonner', () => ({ toast: { error: mockToastError, success: mockToastSuccess } }));
vi.mock('@/utils/imageDownload', () => ({ downloadImage: vi.fn() }));

const SUGGESTION: PostSuggestionDto = {
  id: 's1',
  text: 'بوست تجريبي 🌟',
  imageUrl: 'https://media/x.jpg',
  postType: 'general',
  source: 'manual',
  suggestedFor: '2026-08-09',
  createdAt: '2026-08-09T08:00:00Z',
};

function renderSheet(initial: PostSuggestionResponse | null, overrides: { canGenerate?: boolean } = {}) {
  return render(
    <PostSuggestionSheet
      pageId="p1"
      initial={initial}
      canGenerate={overrides.canGenerate ?? true}
      onClose={vi.fn()}
      onChanged={vi.fn()}
    />,
  );
}

function setClipboard(writeText: ReturnType<typeof vi.fn> | undefined) {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMarkEvent.mockResolvedValue({});
  mockGenerate.mockResolvedValue({
    data: { suggestion: SUGGESTION, remainingToday: 2, availableTypes: ['general'] },
  });
});

afterEach(() => {
  setClipboard(undefined);
});

describe('PostSuggestionSheet — angle chips fail CLOSED', () => {
  it('missing availableTypes = UNKNOWN: only the general chip is enabled, and the data hint shows', async () => {
    // Envelope without availableTypes (e.g. an old cached response) — the
    // chips must NOT fail open to all five angles (the burn-a-slot dogfood bug).
    renderSheet({ suggestion: SUGGESTION, remainingToday: 2 });

    expect(await screen.findByRole('button', { name: enPostSuggestions.type_general })).toBeEnabled();
    for (const name of [
      enPostSuggestions.type_promo,
      enPostSuggestions.type_product_spotlight,
      enPostSuggestions.type_faq_tip,
      enPostSuggestions.type_hours_reminder,
    ]) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(screen.getByText(enPostSuggestions.angleNeedsDataHint)).toBeInTheDocument();
  });

  it('a response carrying availableTypes enables exactly those chips', async () => {
    renderSheet({ suggestion: SUGGESTION, remainingToday: 2, availableTypes: ['general', 'faq_tip'] });

    expect(await screen.findByRole('button', { name: enPostSuggestions.type_faq_tip })).toBeEnabled();
    expect(screen.getByRole('button', { name: enPostSuggestions.type_general })).toBeEnabled();
    expect(screen.getByRole('button', { name: enPostSuggestions.type_promo })).toBeDisabled();
  });
});

describe('PostSuggestionSheet — the `copied` stamp tells the truth', () => {
  const copiedCalls = () => mockMarkEvent.mock.calls.filter((c) => c[2] === 'copied');

  it('stamps `copied` ONLY when the clipboard write actually resolves', async () => {
    setClipboard(vi.fn().mockResolvedValue(undefined));
    renderSheet({ suggestion: SUGGESTION, remainingToday: 2, availableTypes: ['general'] });

    fireEvent.click(await screen.findByRole('button', { name: new RegExp(enPostSuggestions.copyText) }));
    await waitFor(() => expect(copiedCalls()).toHaveLength(1));
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('a rejected clipboard write stamps NOTHING and shows the failure hint', async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    renderSheet({ suggestion: SUGGESTION, remainingToday: 2, availableTypes: ['general'] });

    fireEvent.click(await screen.findByRole('button', { name: new RegExp(enPostSuggestions.copyText) }));
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(enPostSuggestions.copyFailed));
    expect(copiedCalls()).toHaveLength(0);
  });

  it('a missing clipboard API (older WebViews) stamps NOTHING', async () => {
    setClipboard(undefined);
    renderSheet({ suggestion: SUGGESTION, remainingToday: 2, availableTypes: ['general'] });

    fireEvent.click(await screen.findByRole('button', { name: new RegExp(enPostSuggestions.copyText) }));
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(enPostSuggestions.copyFailed));
    expect(copiedCalls()).toHaveLength(0);
  });
});

describe('PostSuggestionSheet — error handling', () => {
  it('RATE_LIMIT_EXCEEDED (route limiter) shows the wait-a-minute message and NEVER reaches Sentry', async () => {
    mockGenerate.mockRejectedValue({ response: { status: 429, data: { code: 'RATE_LIMIT_EXCEEDED' } } });
    renderSheet({ suggestion: SUGGESTION, remainingToday: 2, availableTypes: ['general'] });

    fireEvent.click(await screen.findByRole('button', { name: new RegExp(enPostSuggestions.regenerate) }));
    expect(await screen.findByRole('alert')).toHaveTextContent(enPostSuggestions.errorRateLimit);
    expect(mockCaptureError).not.toHaveBeenCalled();
  });
});

describe('PostSuggestionSheet — auto-generate fires ONCE (StrictMode regression pin)', () => {
  it('a StrictMode double-mount issues exactly one POST (each one burns a daily-cap slot)', async () => {
    render(
      <StrictMode>
        <PostSuggestionSheet pageId="p1" initial={null} canGenerate onClose={vi.fn()} onChanged={vi.fn()} />
      </StrictMode>,
    );
    await waitFor(() => expect(mockGenerate).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(SUGGESTION.text)).toBeInTheDocument());
    // The shipped bug: two POSTs in the same millisecond from the doubled
    // effect — the ref guard must keep it at ONE.
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });
});

describe('PostSuggestionSheet — text-only rows explain themselves from DATA', () => {
  it('a text-only row arriving via getToday (no imageDegraded flag) still renders the notice', async () => {
    renderSheet({ suggestion: { ...SUGGESTION, imageUrl: null }, remainingToday: 1, availableTypes: ['general'] });
    expect(await screen.findByText(enPostSuggestions.textOnlyNotice)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('storage_off keeps its distinct copy', async () => {
    renderSheet({
      suggestion: { ...SUGGESTION, imageUrl: null },
      remainingToday: 1,
      imageDegraded: 'storage_off',
      availableTypes: ['general'],
    });
    expect(await screen.findByText(enPostSuggestions.textOnlyStorageOff)).toBeInTheDocument();
  });
});
