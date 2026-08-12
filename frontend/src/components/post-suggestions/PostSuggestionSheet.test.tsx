import '@testing-library/jest-dom';
import { StrictMode } from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PostSuggestionDto } from '@jawab24/shared';
import type { PostSuggestionResponse } from '@/lib/api';
import enPostSuggestions from '@/i18n/en/postSuggestions.json';
import { PostSuggestionSheet } from './PostSuggestionSheet';

const { mockGenerate, mockGetToday, mockMarkEvent, mockSelectVariant, mockToastError, mockToastSuccess, mockCaptureError } = vi.hoisted(() => ({
  mockGenerate: vi.fn(),
  mockGetToday: vi.fn(),
  mockMarkEvent: vi.fn(),
  mockSelectVariant: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockCaptureError: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  postSuggestionsApi: { getToday: mockGetToday, generate: mockGenerate, markEvent: mockMarkEvent, selectVariant: mockSelectVariant },
}));
vi.mock('@/lib/sentryHelpers', () => ({ captureError: mockCaptureError }));
vi.mock('sonner', () => ({ toast: { error: mockToastError, success: mockToastSuccess } }));
vi.mock('@/utils/imageDownload', () => ({ downloadImage: vi.fn() }));

const SUGGESTION: PostSuggestionDto = {
  id: 's1',
  text: 'بوست تجريبي 🌟',
  imageUrl: 'https://media/x.jpg',
  variants: [{ text: 'بوست تجريبي 🌟', headline: 'عنوان', imageUrl: 'https://media/x.jpg' }],
  selectedVariant: 0,
  postType: 'general',
  source: 'manual',
  suggestedFor: '2026-08-09',
  createdAt: '2026-08-09T08:00:00Z',
};

/** Three takes on one generation — the shape the server ships after variants. */
const SUGGESTION_3: PostSuggestionDto = {
  ...SUGGESTION,
  variants: [
    { text: 'الصياغة الأولى', headline: 'ه١', imageUrl: 'https://media/v1.jpg' },
    { text: 'الصياغة الثانية', headline: 'ه٢', imageUrl: 'https://media/v2.jpg' },
    { text: 'الصياغة الثالثة', headline: 'ه٣', imageUrl: 'https://media/v3.jpg' },
  ],
  text: 'الصياغة الأولى',
  imageUrl: 'https://media/v1.jpg',
};

/** No card at all — the mirrored column AND the take must agree, as the server keeps them. */
const TEXT_ONLY: PostSuggestionDto = {
  ...SUGGESTION,
  imageUrl: null,
  variants: [{ ...SUGGESTION.variants[0], imageUrl: null }],
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
  mockSelectVariant.mockResolvedValue({ data: { suggestion: SUGGESTION_3 } });
  mockGetToday.mockResolvedValue({ data: { suggestion: null, remainingToday: 2, availableTypes: ['general'] } });
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
    renderSheet({ suggestion: TEXT_ONLY, remainingToday: 1, availableTypes: ['general'] });
    expect(await screen.findByText(enPostSuggestions.textOnlyNotice)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('storage_off keeps its distinct copy', async () => {
    renderSheet({
      suggestion: TEXT_ONLY,
      remainingToday: 1,
      imageDegraded: 'storage_off',
      availableTypes: ['general'],
    });
    expect(await screen.findByText(enPostSuggestions.textOnlyStorageOff)).toBeInTheDocument();
  });
});

/**
 * Reported live on 2026-08-12: the merchant saw «حدث خطأ ما» while their post
 * had in fact been created, and a capped attempt was already spent on it.
 * Generation runs ~35s against nginx's 30s proxy_read_timeout on this route,
 * so the socket dies while the server finishes and commits. A dead connection
 * says nothing about whether the work landed — so ask, don't despair.
 */
describe('PostSuggestionSheet — a dead connection is not a failed generation', () => {
  /** An axios network error / abort: no `response` at all. */
  const networkError = () => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });

  it('recovers the post the server DID create instead of reporting an error', async () => {
    mockGenerate.mockRejectedValue(networkError());
    mockGetToday.mockResolvedValue({
      data: { suggestion: SUGGESTION_3, remainingToday: 1, availableTypes: ['general'] },
    });
    const onChanged = vi.fn();
    render(
      <PostSuggestionSheet pageId="p1" initial={null} canGenerate onClose={vi.fn()} onChanged={onChanged} />,
    );

    expect(await screen.findByDisplayValue('الصياغة الأولى')).toBeInTheDocument();
    expect(screen.queryByText(enPostSuggestions.errorGeneric)).not.toBeInTheDocument();
    // The dashboard card must learn about it too, or it keeps offering "generate".
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('still reports the error when nothing landed — same post as before means the work really was lost', async () => {
    mockGenerate.mockRejectedValue(networkError());
    mockGetToday.mockResolvedValue({
      data: { suggestion: SUGGESTION, remainingToday: 1, availableTypes: ['general'] },
    });
    renderSheet({ suggestion: SUGGESTION, remainingToday: 2, availableTypes: ['general'] });
    await screen.findByDisplayValue(SUGGESTION.text);

    fireEvent.click(screen.getByRole('button', { name: new RegExp(enPostSuggestions.regenerate) }));
    expect(await screen.findByText(enPostSuggestions.errorGeneric)).toBeInTheDocument();
  });

  it('a server error WITH a response keeps its own message — recovery is only for dead connections', async () => {
    mockGenerate.mockRejectedValue({ response: { status: 429, data: { code: 'daily_cap' } } });
    renderSheet({ suggestion: SUGGESTION, remainingToday: 2, availableTypes: ['general'] });
    await screen.findByDisplayValue(SUGGESTION.text);

    fireEvent.click(screen.getByRole('button', { name: new RegExp(enPostSuggestions.regenerate) }));
    expect(await screen.findByText(enPostSuggestions.errorDailyCap)).toBeInTheDocument();
    expect(mockGetToday).not.toHaveBeenCalled();
  });
});

/**
 * The takes are the whole point of the feature: on 2026-08-11 a real page's
 * best post of the day was destroyed by its own next regenerate, because only
 * one post could exist at a time. These pin that the merchant can move between
 * takes without losing anything.
 */
describe('PostSuggestionSheet — choosing between takes', () => {
  const withTakes = () => renderSheet({ suggestion: SUGGESTION_3, remainingToday: 2, availableTypes: ['general'] });

  it('opens on the SELECTED take, not always the first', async () => {
    renderSheet({ suggestion: { ...SUGGESTION_3, selectedVariant: 2 }, remainingToday: 2, availableTypes: ['general'] });
    expect(await screen.findByDisplayValue('الصياغة الثالثة')).toBeInTheDocument();
  });

  it('switching takes swaps BOTH the text and the card', async () => {
    withTakes();
    expect(await screen.findByDisplayValue('الصياغة الأولى')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://media/v1.jpg');

    fireEvent.click(screen.getByRole('tab', { name: 'Version 2' }));
    expect(await screen.findByDisplayValue('الصياغة الثانية')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://media/v2.jpg');
  });

  it('persists the choice so the dashboard card and older app bundles agree with what is on screen', async () => {
    mockSelectVariant.mockResolvedValue({ data: { suggestion: { ...SUGGESTION_3, selectedVariant: 1 } } });
    withTakes();
    await screen.findByDisplayValue('الصياغة الأولى');
    fireEvent.click(screen.getByRole('tab', { name: 'Version 2' }));
    await waitFor(() => expect(mockSelectVariant).toHaveBeenCalledWith('p1', 's1', 1));
  });

  it('KEEPS a merchant edit when they switch away and come back — losing typed text is the bug this feature exists to stop', async () => {
    // A FRESH object, as the server really answers. Returning the same
    // reference makes React bail out of the re-render and hides the whole
    // failure this pins: the save landing must not wipe the editor.
    mockSelectVariant.mockImplementation(async (_p: string, _s: string, index: number) =>
      ({ data: { suggestion: { ...SUGGESTION_3, variants: [...SUGGESTION_3.variants], selectedVariant: index } } }));
    withTakes();
    const box = await screen.findByDisplayValue('الصياغة الأولى');
    fireEvent.change(box, { target: { value: 'نصي المعدّل' } });

    fireEvent.click(screen.getByRole('tab', { name: 'Version 2' }));
    expect(await screen.findByDisplayValue('الصياغة الثانية')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Version 1' }));
    expect(await screen.findByDisplayValue('نصي المعدّل')).toBeInTheDocument();
  });

  it('a REGENERATE does reset the editor — a new post is a new post, and keeping stale edits over it would be worse', async () => {
    mockGenerate.mockResolvedValue({
      data: { suggestion: { ...SUGGESTION_3, id: 's2', text: 'بوست جديد', variants: [{ text: 'بوست جديد', headline: 'ج', imageUrl: null }] }, remainingToday: 1, availableTypes: ['general'] },
    });
    withTakes();
    const box = await screen.findByDisplayValue('الصياغة الأولى');
    fireEvent.change(box, { target: { value: 'نصي المعدّل' } });

    fireEvent.click(screen.getByRole('button', { name: new RegExp(enPostSuggestions.regenerate) }));
    expect(await screen.findByDisplayValue('بوست جديد')).toBeInTheDocument();
  });

  it('a failed save never blocks the merchant — the take is still on screen, the error goes to Sentry', async () => {
    mockSelectVariant.mockRejectedValue(new Error('offline'));
    withTakes();
    await screen.findByDisplayValue('الصياغة الأولى');
    fireEvent.click(screen.getByRole('tab', { name: 'Version 2' }));
    expect(await screen.findByDisplayValue('الصياغة الثانية')).toBeInTheDocument();
    await waitFor(() => expect(mockCaptureError).toHaveBeenCalled());
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('a single-take suggestion shows NO switcher — nothing changes for rows generated before variants', async () => {
    renderSheet({ suggestion: SUGGESTION, remainingToday: 1, availableTypes: ['general'] });
    await screen.findByDisplayValue(SUGGESTION.text);
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('a response with NO variants field at all (old backend, mid blue/green deploy) still renders the post', async () => {
    const legacy = { ...SUGGESTION } as Partial<PostSuggestionDto>;
    delete legacy.variants;
    delete legacy.selectedVariant;
    renderSheet({ suggestion: legacy as PostSuggestionDto, remainingToday: 1, availableTypes: ['general'] });
    expect(await screen.findByDisplayValue(SUGGESTION.text)).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });
});
