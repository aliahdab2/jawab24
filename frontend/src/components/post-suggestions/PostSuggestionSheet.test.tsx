import '@testing-library/jest-dom';
import { StrictMode } from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PostSuggestionDto } from '@jawab24/shared';
import type { PostSuggestionResponse } from '@/lib/api';
import enPostSuggestions from '@/i18n/en/postSuggestions.json';
import { PostSuggestionSheet } from './PostSuggestionSheet';

const { mockGenerate, mockGetToday, mockMarkEvent, mockSelectVariant, mockDownloadApi, mockDeliver, mockToastError, mockToastSuccess, mockCaptureError } = vi.hoisted(() => ({
  mockGenerate: vi.fn(),
  mockGetToday: vi.fn(),
  mockMarkEvent: vi.fn(),
  mockSelectVariant: vi.fn(),
  mockDownloadApi: vi.fn(),
  mockDeliver: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockCaptureError: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  postSuggestionsApi: { getCurrent: mockGetToday, generate: mockGenerate, markEvent: mockMarkEvent, selectVariant: mockSelectVariant, downloadImage: mockDownloadApi },
}));
vi.mock('@/lib/sentryHelpers', () => ({ captureError: mockCaptureError }));
vi.mock('sonner', () => ({ toast: { error: mockToastError, success: mockToastSuccess } }));
vi.mock('@/utils/imageDownload', () => ({ downloadImage: mockDeliver }));

const SUGGESTION: PostSuggestionDto = {
  id: 's1',
  status: 'ready',
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

/**
 * A take's tab, addressed by the LENS it leads with — never by position.
 * The tab's accessible name is "<lens> — <that take's opening line>", so this
 * matches the lens prefix and stays correct if the preview text changes.
 */
function takeTab(index: 0 | 1 | 2) {
  const lens = [
    enPostSuggestions.variantLens0,
    enPostSuggestions.variantLens1,
    enPostSuggestions.variantLens2,
  ][index];
  return screen.getByRole('tab', { name: new RegExp(lens) });
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
  mockDownloadApi.mockResolvedValue({ data: new Blob(['bytes'], { type: 'image/jpeg' }) });
  mockDeliver.mockResolvedValue({ savedToFiles: false });
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

  it('shows NO create button on the way in — the auto-generate owns that click', async () => {
    // The empty state added for a failed seed must not appear on the CTA path.
    // Auto-generate fires in an effect, i.e. one frame after the first paint,
    // so an ungated button would flash — and a click landing in that frame
    // would spend a second capped slot on top of the one about to be spent.
    render(<PostSuggestionSheet pageId="p1" initial={null} canGenerate onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.queryByRole('button', { name: new RegExp(enPostSuggestions.cardCta) })).not.toBeInTheDocument();
    await waitFor(() => expect(mockGenerate).toHaveBeenCalledTimes(1));
  });
});

/**
 * The state a failed attempt leaves behind, when the page has no post to fall
 * back on — a first generation that failed, or the one-time SEED.
 *
 * It used to be unreachable-by-design: the failed row came back as the
 * `suggestion`, so the sheet rendered its empty text as a post, with Copy and
 * Download over nothing and no way to start another. The seed predicate is
 * "this page has any row", so nothing ever retried it either.
 */
describe('PostSuggestionSheet — no post, and the last attempt failed', () => {
  const FAILED = { id: 'seed-failed', status: 'failed' as const };

  it('⭐ offers to create one instead of rendering an empty post', async () => {
    renderSheet({ suggestion: null, inFlight: FAILED, remainingToday: 2, availableTypes: ['general'] });
    expect(await screen.findByRole('button', { name: new RegExp(enPostSuggestions.cardCta) })).toBeEnabled();
    // No editor, no Copy over an empty body.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(enPostSuggestions.copyText) })).not.toBeInTheDocument();
  });

  it('the CTA starts a generation, and does NOT auto-fire on open', async () => {
    renderSheet({ suggestion: null, inFlight: FAILED, remainingToday: 2, availableTypes: ['general'] });
    const cta = await screen.findByRole('button', { name: new RegExp(enPostSuggestions.cardCta) });
    // An automatic retry over a failed row is exactly the unattended spend the
    // on-demand model removes — the merchant asks.
    expect(mockGenerate).not.toHaveBeenCalled();
    fireEvent.click(cta);
    await waitFor(() => expect(mockGenerate).toHaveBeenCalledTimes(1));
  });

  it('says the day is spent rather than offering a button that would 429', async () => {
    renderSheet({ suggestion: null, inFlight: FAILED, remainingToday: 0, availableTypes: ['general'] });
    expect(await screen.findByText(enPostSuggestions.noRemaining)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(enPostSuggestions.cardCta) })).not.toBeInTheDocument();
  });

  it('a member who may not generate sees the explanation and no button', async () => {
    renderSheet(
      { suggestion: null, inFlight: FAILED, remainingToday: 2, availableTypes: ['general'] },
      { canGenerate: false },
    );
    expect(await screen.findByText(enPostSuggestions.cardDesc)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(enPostSuggestions.cardCta) })).not.toBeInTheDocument();
  });
});

describe('PostSuggestionSheet — text-only rows explain themselves from DATA', () => {
  it('a text-only row arriving via getCurrent (no imageDegraded flag) still renders the notice', async () => {
    renderSheet({ suggestion: TEXT_ONLY, remainingToday: 1, availableTypes: ['general'] });
    expect(await screen.findByText(enPostSuggestions.textOnlyNotice)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('storage_off keeps its distinct copy — carried ON the suggestion, so a re-read keeps it', async () => {
    renderSheet({
      // The reason travels with the row rather than on the response envelope:
      // generation finishes in a worker, so a reason returned once would be
      // lost by every later read (which is how the dead-connection recovery
      // dropped this notice before).
      suggestion: { ...TEXT_ONLY, imageDegraded: 'storage_off' },
      remainingToday: 1,
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

    fireEvent.click(takeTab(1));
    expect(await screen.findByDisplayValue('الصياغة الثانية')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://media/v2.jpg');
  });

  it('persists the choice so the dashboard card and older app bundles agree with what is on screen', async () => {
    mockSelectVariant.mockResolvedValue({ data: { suggestion: { ...SUGGESTION_3, selectedVariant: 1 } } });
    withTakes();
    await screen.findByDisplayValue('الصياغة الأولى');
    fireEvent.click(takeTab(1));
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

    fireEvent.click(takeTab(1));
    expect(await screen.findByDisplayValue('الصياغة الثانية')).toBeInTheDocument();

    fireEvent.click(takeTab(0));
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
    fireEvent.click(takeTab(1));
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

/**
 * Generation moved off the request path: the POST returns a `pending` row in
 * milliseconds and a worker fills it in ~35s later. The sheet therefore has to
 * WAIT on the row rather than on the request — which is the whole fix for the
 * 2026-08-12 production failure, where nginx cut the 35s request at 30s and a
 * finished post was reported to the merchant as «حدث خطأ ما».
 */
describe('PostSuggestionSheet — waiting on a generation that runs in a worker', () => {
  /**
   * A generation the worker still owns.
   *
   * It is an `inFlight` row, NOT a `suggestion`: what the merchant HAS and what
   * is HAPPENING are separate fields since 2026-08-13, because a pending row
   * served as the post rendered an empty body — and a FAILED one took the
   * place of a real post permanently, the read no longer being day-scoped.
   */
  const RUNNING = { id: 's-pending', status: 'pending' as const };

  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); });

  it('a row IN FLIGHT shows the working state and never the editor', async () => {
    renderSheet({ suggestion: null, inFlight: RUNNING, remainingToday: 1, availableTypes: ['general'] });
    expect(await screen.findByText(enPostSuggestions.generating)).toBeInTheDocument();
    // The empty body must not reach a textarea the merchant could copy from.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('polls until the row is READY, then renders the post', async () => {
    // A FRESH object per call: a shared fixture makes React bail out on an
    // identical reference and hides exactly this kind of re-render bug.
    mockGetToday.mockImplementation(() => Promise.resolve({
      data: {
        suggestion: { ...SUGGESTION, id: 's-pending' },
        inFlight: null,
        remainingToday: 1,
        availableTypes: ['general'],
      },
    }));
    renderSheet({ suggestion: null, inFlight: RUNNING, remainingToday: 1, availableTypes: ['general'] });
    expect(await screen.findByText(enPostSuggestions.generating)).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(3_500); });
    expect(await screen.findByDisplayValue(SUGGESTION.text)).toBeInTheDocument();
    expect(screen.queryByText(enPostSuggestions.generating)).not.toBeInTheDocument();
  });

  it('a row that ends FAILED surfaces the error instead of spinning forever', async () => {
    mockGetToday.mockImplementation(() => Promise.resolve({
      data: {
        suggestion: null,
        inFlight: { id: 's-pending', status: 'failed' as const },
        remainingToday: 1,
        availableTypes: ['general'],
      },
    }));
    renderSheet({ suggestion: null, inFlight: RUNNING, remainingToday: 1, availableTypes: ['general'] });

    await act(async () => { await vi.advanceTimersByTimeAsync(3_500); });
    // The merchant's slot was spent, so the failure is shown rather than hidden.
    expect(await screen.findByText(enPostSuggestions.errorGeneration)).toBeInTheDocument();
  });

  it('⭐ a failure leaves the post the merchant ALREADY had on screen', async () => {
    // The regression this split exists for. A failed generation supersedes
    // nothing, so its row is newer than the post it did not replace — served as
    // "the newest live row" it blanked the sheet, and with the day scope gone
    // it never gave the post back.
    mockGetToday.mockImplementation(() => Promise.resolve({
      data: {
        suggestion: { ...SUGGESTION },
        inFlight: { id: 's-pending', status: 'failed' as const },
        remainingToday: 1,
        availableTypes: ['general'],
      },
    }));
    renderSheet({ suggestion: SUGGESTION, inFlight: RUNNING, remainingToday: 1, availableTypes: ['general'] });

    await act(async () => { await vi.advanceTimersByTimeAsync(3_500); });
    expect(await screen.findByText(enPostSuggestions.errorGeneration)).toBeInTheDocument();
    // …and the post is still right there to copy.
    expect(screen.getByDisplayValue(SUGGESTION.text)).toBeInTheDocument();
  });

  it('a poll blip is not a failure — the next tick still lands the post', async () => {
    mockGetToday
      .mockRejectedValueOnce(new Error('network blip'))
      .mockImplementation(() => Promise.resolve({
        data: {
          suggestion: { ...SUGGESTION, id: 's-pending' },
          inFlight: null,
          remainingToday: 1,
          availableTypes: ['general'],
        },
      }));
    renderSheet({ suggestion: null, inFlight: RUNNING, remainingToday: 1, availableTypes: ['general'] });

    await act(async () => { await vi.advanceTimersByTimeAsync(7_000); });
    expect(await screen.findByDisplayValue(SUGGESTION.text)).toBeInTheDocument();
    expect(screen.queryByText(enPostSuggestions.errorGeneration)).not.toBeInTheDocument();
  });

  it('says it is TAKING LONGER rather than reporting a failure that did not happen', async () => {
    // The worker owns the row and always resolves it, so a still-pending row
    // here means slow — never lost.
    mockGetToday.mockImplementation(() => Promise.resolve({
      data: { suggestion: null, inFlight: { ...RUNNING }, remainingToday: 1, availableTypes: ['general'] },
    }));
    renderSheet({ suggestion: null, inFlight: RUNNING, remainingToday: 1, availableTypes: ['general'] });

    await act(async () => { await vi.advanceTimersByTimeAsync(125_000); });
    expect(await screen.findByText(enPostSuggestions.takingLonger)).toBeInTheDocument();
    expect(screen.queryByText(enPostSuggestions.errorGeneration)).not.toBeInTheDocument();
  });

  it('does NOT stamp `opened` while a generation is in flight — the metric counts posts actually seen', async () => {
    renderSheet({ suggestion: null, inFlight: RUNNING, remainingToday: 1, availableTypes: ['general'] });
    await screen.findByText(enPostSuggestions.generating);
    expect(mockMarkEvent).not.toHaveBeenCalled();
  });

  it('does NOT auto-generate over a generation that is already running', async () => {
    // Opening the sheet with nothing to show used to mean "start one". With
    // `inFlight` split out, "nothing to show" is also the state of a page whose
    // generation is mid-flight — and starting a second would spend a second
    // capped slot on work already paid for.
    renderSheet({ suggestion: null, inFlight: RUNNING, remainingToday: 1, availableTypes: ['general'] });
    await screen.findByText(enPostSuggestions.generating);
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});

/**
 * «حفظ الصورة» never worked before this: the images sit on object storage that
 * sends no CORS headers, so the browser could DISPLAY them but not fetch them —
 * and downloading requires a fetch. It now goes through our own origin.
 */
describe('PostSuggestionSheet — downloading the card', () => {
  it('asks OUR API for the bytes, by take index — never the storage URL', async () => {
    renderSheet({ suggestion: SUGGESTION_3, remainingToday: 2, availableTypes: ['general'] });
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(enPostSuggestions.downloadImage) }));

    await waitFor(() => expect(mockDownloadApi).toHaveBeenCalledWith('p1', 's1', 0));
    // The delivered payload is what the API returned, not something re-fetched.
    await waitFor(() => expect(mockDeliver).toHaveBeenCalledWith(expect.any(Blob), 'jawab24-post-2026-08-09.jpg'));
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('downloads the take the merchant is LOOKING AT, not always the first', async () => {
    renderSheet({ suggestion: SUGGESTION_3, remainingToday: 2, availableTypes: ['general'] });
    fireEvent.click(takeTab(2));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(enPostSuggestions.downloadImage) }));
    await waitFor(() => expect(mockDownloadApi).toHaveBeenCalledWith('p1', 's1', 2));
  });

  it('stamps `downloaded` ONLY when the bytes actually arrived', async () => {
    mockDownloadApi.mockRejectedValue(new Error('network'));
    renderSheet({ suggestion: SUGGESTION_3, remainingToday: 2, availableTypes: ['general'] });
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(enPostSuggestions.downloadImage) }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    // The pilot's success metric must never count a download that failed.
    expect(mockMarkEvent.mock.calls.filter((c) => c[2] === 'downloaded')).toHaveLength(0);
  });
});

/**
 * The earlier posts. Creating another used to DESTROY the one it replaced —
 * text and image both — with no way back (production, 11 Aug: three attempts,
 * the first was the best one, the third erased it). They are kept since
 * 2026-08-13, and this strip is where the merchant reaches them.
 */
describe('PostSuggestionSheet — earlier posts', () => {
  const HISTORY = [
    { id: 'old2', text: 'العنوان الأول\nبقية المنشور الأحدث', imageUrl: 'https://media/o2.jpg', postType: 'promo' as const, createdAt: '2026-08-11T10:00:00Z' },
    { id: 'old1', text: 'أقدم منشور', imageUrl: null, postType: 'general' as const, createdAt: '2026-08-10T10:00:00Z' },
  ];

  it('lists them under the post, each openable to its full text', async () => {
    renderSheet({ suggestion: SUGGESTION, remainingToday: 2, availableTypes: ['general'], history: HISTORY });

    expect(await screen.findByText(enPostSuggestions.historyTitle)).toBeInTheDocument();

    // The SUMMARY carries just the opening line — the strip has to stay
    // scannable when a post runs long.
    expect(screen.getByText('العنوان الأول')).toBeInTheDocument();
    // …and the full text sits inside the disclosure, so a merchant can read and
    // copy the one they preferred.
    expect(screen.getByText(/بقية المنشور الأحدث/)).toBeInTheDocument();
    expect(screen.getAllByText('أقدم منشور').length).toBeGreaterThan(0);
  });

  it('shows the KEPT image of an earlier post — that it survived is the whole point', async () => {
    renderSheet({ suggestion: SUGGESTION, remainingToday: 2, availableTypes: ['general'], history: HISTORY });

    const thumbs = await screen.findAllByAltText(enPostSuggestions.historyImageAlt);
    expect(thumbs[0]).toHaveAttribute('src', 'https://media/o2.jpg');
    // Exactly one: the text-only earlier post must NOT invent a thumbnail.
    expect(thumbs).toHaveLength(1);
  });

  it('renders no section at all when the page has no earlier posts', () => {
    renderSheet({ suggestion: SUGGESTION, remainingToday: 2, availableTypes: ['general'], history: [] });
    expect(screen.queryByText(enPostSuggestions.historyTitle)).not.toBeInTheDocument();
  });

  it('keeps the strip when a response carries NO history field', async () => {
    // `undefined` means "this response does not carry history" — the generate
    // route never does — NOT "there are none". Conflating the two would wipe
    // the strip the moment the merchant creates another post.
    renderSheet({ suggestion: SUGGESTION, remainingToday: 2, availableTypes: ['general'], history: HISTORY });
    expect(await screen.findByText(enPostSuggestions.historyTitle)).toBeInTheDocument();

    mockGenerate.mockResolvedValue({
      data: { suggestion: { ...SUGGESTION, id: 's2' }, remainingToday: 1, availableTypes: ['general'] },
    });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(enPostSuggestions.regenerate) }));

    await waitFor(() => expect(mockGenerate).toHaveBeenCalled());
    expect(screen.getByText(enPostSuggestions.historyTitle)).toBeInTheDocument();
  });
});
