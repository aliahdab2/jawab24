import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Page } from '@jawab24/shared';
import enPostSuggestions from '@/i18n/en/postSuggestions.json';
import arPostSuggestions from '@/i18n/ar/postSuggestions.json';
import { PostSuggestionCard } from './PostSuggestionCard';

const { mockGetToday, mockIsVisible, mockRole, mockSetVisibility, mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  mockGetToday: vi.fn(),
  mockIsVisible: vi.fn(),
  mockRole: { isAdmin: true },
  mockSetVisibility: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  postSuggestionsApi: { getCurrent: mockGetToday, generate: vi.fn(), markEvent: vi.fn(), setVisibility: mockSetVisibility },
}));
vi.mock('sonner', () => ({ toast: { success: mockToastSuccess, error: mockToastError } }));
vi.mock('@/lib/sentryHelpers', () => ({ captureError: vi.fn() }));

/**
 * The gesture itself belongs to `useSwipeToDismiss`, which has its own suite
 * (test/hooks/useSwipeToDismiss.test.tsx) covering direction lock, threshold,
 * pointer capture and the slide-out. Re-driving pointer events here would test
 * that hook a second time — brittle, and it would hide what this file is for.
 *
 * So the wrapper is stubbed down to what the CARD is responsible for: the props
 * it passes, and what it does when a dismiss actually happens.
 */
vi.mock('@/components/ui/SwipeDismissWrapper', () => ({
  SwipeDismissWrapper: ({ children, onDismiss, enabled, foregroundClassName }: {
    children: React.ReactNode; onDismiss: () => void; enabled?: boolean; foregroundClassName?: string;
  }) => (
    <div>
      <button type="button" data-testid="swipe" disabled={enabled === false} onClick={onDismiss}>swipe</button>
      <span data-testid="fg-class">{foregroundClassName ?? ''}</span>
      {children}
    </div>
  ),
}));
vi.mock('@/lib/featureFlags', () => ({ isPostSuggestionsVisible: mockIsVisible }));
vi.mock('@/hooks/useWorkspaceRole', () => ({ useWorkspaceRole: () => mockRole }));
vi.mock('@/lib/store', () => ({
  useAuthStore: (selector: (s: { activeWorkspaceId: string }) => unknown) =>
    selector({ activeWorkspaceId: 'ws1' }),
}));

const PAGES = [{ id: 'p1', name: 'My Page', isConnected: true } as Page];

function renderCard(pages: Page[] = PAGES) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PostSuggestionCard pages={pages} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRole.isAdmin = true;
  mockIsVisible.mockReturnValue(true);
  mockSetVisibility.mockResolvedValue({ data: { hiddenToday: true } });
  mockGetToday.mockResolvedValue({ data: { suggestion: null, remainingToday: 3 } });
});

describe('PostSuggestionCard — swipe hides it until tomorrow', () => {
  const SUGGESTION = {
    id: 's1', status: 'ready', text: 'منشور تجريبي', imageUrl: null,
    variants: [{ text: 'منشور تجريبي', headline: 'ه', imageUrl: null }],
    selectedVariant: 0, postType: 'general', source: 'manual',
    suggestedFor: '2026-08-14', createdAt: '2026-08-14T08:00:00Z',
  };

  const swipe = async () => fireEvent.click(await screen.findByTestId('swipe'));

  it('renders NOTHING when the server says it was hidden earlier today', async () => {
    mockGetToday.mockResolvedValue({ data: { suggestion: SUGGESTION, remainingToday: 3, hiddenToday: true } });
    const { container } = renderCard();
    // The read still happens — the SERVER owns the day boundary, not the client.
    // A phone in Damascus and a browser in Berlin must agree on when it returns.
    await waitFor(() => expect(mockGetToday).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('swiping persists the choice SERVER-side, so the phone and the desktop agree', async () => {
    mockGetToday.mockResolvedValue({ data: { suggestion: SUGGESTION, remainingToday: 3 } });
    renderCard();
    await screen.findByText(enPostSuggestions.cardTitle);

    await swipe();

    await waitFor(() => expect(mockSetVisibility).toHaveBeenCalledWith(true));
    // …and the space is reclaimed optimistically, without waiting for the trip.
    await waitFor(() => expect(screen.queryByText(enPostSuggestions.cardTitle)).not.toBeInTheDocument());
    expect(mockToastSuccess).toHaveBeenCalled();
  });

  it('a FAILED write puts the card back rather than promising a persistence we did not get', async () => {
    mockGetToday.mockResolvedValue({ data: { suggestion: SUGGESTION, remainingToday: 3 } });
    mockSetVisibility.mockRejectedValue(new Error('offline'));
    renderCard();
    await screen.findByText(enPostSuggestions.cardTitle);

    await swipe();

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(enPostSuggestions.hideFailed));
    expect(await screen.findByText(enPostSuggestions.cardTitle)).toBeInTheDocument();
  });

  it('a generation IN FLIGHT cannot be swiped away — that is paid work the merchant is watching', async () => {
    mockGetToday.mockResolvedValue({
      data: { suggestion: null, inFlight: { id: 'x', status: 'pending', brief: null }, remainingToday: 2 },
    });
    renderCard();
    await screen.findByText(enPostSuggestions.cardTitle);

    expect(await screen.findByTestId('swipe')).toBeDisabled();
  });

  /**
   * ⭐ Regression: "View your post is above Hide for Today" (reported on the
   * running build, 2026-08-14).
   *
   * The wrapper stacks the swipe background and the card as two layers. This
   * card's own fill is `bg-brand-50/60` — 60% ALPHA — so with a transparent
   * foreground the teal «إخفاء لليوم» band was legible straight through the
   * post. Every other consumer (SwipeableMessageCard, SwipeableNotificationItem)
   * passes an opaque `bg-card` foreground; this one did not.
   *
   * Asserted on the PROP rather than on pixels because jsdom computes no
   * stacking — but the prop is exactly what was missing.
   */
  it('gives the swipe wrapper an OPAQUE foreground, or the background bleeds through the card', async () => {
    mockGetToday.mockResolvedValue({ data: { suggestion: SUGGESTION, remainingToday: 3 } });
    renderCard();

    const fg = await screen.findByTestId('fg-class');
    expect(fg).toHaveTextContent('bg-card');
  });

  it('a non-admin member cannot hide the card for the whole workspace', async () => {
    mockRole.isAdmin = false;
    mockGetToday.mockResolvedValue({ data: { suggestion: SUGGESTION, remainingToday: 3 } });
    renderCard();
    await screen.findByText(enPostSuggestions.cardTitle);

    expect(await screen.findByTestId('swipe')).toBeDisabled();
  });
});

describe('PostSuggestionCard — pilot self-gating', () => {
  it('renders nothing when the workspace is not allowlisted', () => {
    mockIsVisible.mockReturnValue(false);
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
    expect(mockGetToday).not.toHaveBeenCalled();
  });

  it('renders nothing when the allowlisted page is DISCONNECTED (owner rule: connected only)', () => {
    const { container } = renderCard([{ id: 'p1', name: 'My Page', isConnected: false } as Page]);
    expect(container).toBeEmptyDOMElement();
    expect(mockGetToday).not.toHaveBeenCalled();
  });

  it('shows the page switcher only when MULTIPLE connected pages exist, and switches', async () => {
    renderCard([
      { id: 'p1', name: 'متجر العطور', isConnected: true } as Page,
      { id: 'p2', name: 'مطعم الشام', isConnected: true } as Page,
      { id: 'p3', name: 'صفحة مفصولة', isConnected: false } as Page,
    ]);
    expect(await screen.findByRole('tab', { name: 'متجر العطور' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'مطعم الشام' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'صفحة مفصولة' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'مطعم الشام' }));
    await waitFor(() => expect(mockGetToday).toHaveBeenCalledWith('p2'));
  });

  it('fails closed when the API 404s (backend gate off / stale build)', async () => {
    mockGetToday.mockRejectedValue({ response: { status: 404 } });
    const { container } = renderCard();
    await waitFor(() => expect(mockGetToday).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('shows the generate CTA to an admin when no post exists yet', async () => {
    renderCard();
    expect(await screen.findByText(enPostSuggestions.cardCta)).toBeInTheDocument();
  });

  it('hides entirely from non-admins while no post exists (nothing they can do)', async () => {
    mockRole.isAdmin = false;
    const { container } = renderCard();
    await waitFor(() => expect(mockGetToday).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('switches to the view CTA once today\'s post exists', async () => {
    mockGetToday.mockResolvedValue({
      data: {
        suggestion: {
          id: 's1', text: 'بوست', imageUrl: null, postType: 'general',
          source: 'cron', suggestedFor: '2026-08-09', createdAt: '2026-08-09T08:00:00Z',
        },
        remainingToday: 2,
      },
    });
    renderCard();
    expect(await screen.findByText(enPostSuggestions.cardOpen)).toBeInTheDocument();
  });
});

describe('PostSuggestionCard — the card previews the REAL post', () => {
  const WITH_IMAGE = {
    id: 's1',
    text: 'دورة ICDL تبدأ اليوم — سجل الآن',
    imageUrl: 'https://storage.example/generated-posts/ws1/abc.jpg',
    postType: 'promo' as const,
    source: 'cron' as const,
    suggestedFor: '2026-08-10',
    createdAt: '2026-08-10T05:00:00Z',
  };

  it('shows the thumbnail, the angle badge, and the post text — not a generic banner', async () => {
    mockGetToday.mockResolvedValue({ data: { suggestion: WITH_IMAGE, remainingToday: 2 } });
    renderCard();

    const thumb = await screen.findByAltText(enPostSuggestions.postImageAlt);
    expect(thumb).toHaveAttribute('src', WITH_IMAGE.imageUrl);
    expect(screen.getByText(WITH_IMAGE.text)).toBeInTheDocument();
    expect(screen.getByText(enPostSuggestions.type_promo)).toBeInTheDocument();
  });

  it('a TEXT-ONLY post (image degraded) renders the brand tile, never a broken frame', async () => {
    mockGetToday.mockResolvedValue({
      data: { suggestion: { ...WITH_IMAGE, imageUrl: null }, remainingToday: 2 },
    });
    renderCard();

    expect(await screen.findByText(WITH_IMAGE.text)).toBeInTheDocument();
    expect(screen.queryByAltText(enPostSuggestions.postImageAlt)).not.toBeInTheDocument();
  });

  it('a thumbnail that FAILS to load falls back to the tile (object storage hiccup)', async () => {
    mockGetToday.mockResolvedValue({ data: { suggestion: WITH_IMAGE, remainingToday: 2 } });
    renderCard();

    const thumb = await screen.findByAltText(enPostSuggestions.postImageAlt);
    fireEvent.error(thumb);
    await waitFor(() =>
      expect(screen.queryByAltText(enPostSuggestions.postImageAlt)).not.toBeInTheDocument(),
    );
    // The card itself survives — only the image is replaced.
    expect(screen.getByText(WITH_IMAGE.text)).toBeInTheDocument();
  });

  it('a DIFFERENT image url is retried after one failed — the failure is per-url, not sticky', async () => {
    // Regression: a boolean "thumb errored" flag kept hiding the image after a
    // regenerate wrote a brand-new imageUrl into the query cache.
    mockGetToday.mockImplementation((id: string) =>
      Promise.resolve({
        data: {
          suggestion: { ...WITH_IMAGE, imageUrl: `https://storage.example/${id}.jpg` },
          remainingToday: 2,
        },
      }),
    );
    renderCard([
      { id: 'p1', name: 'Page One', isConnected: true } as Page,
      { id: 'p2', name: 'Page Two', isConnected: true } as Page,
    ]);

    const first = await screen.findByAltText(enPostSuggestions.postImageAlt);
    expect(first).toHaveAttribute('src', 'https://storage.example/p1.jpg');
    fireEvent.error(first);
    await waitFor(() =>
      expect(screen.queryByAltText(enPostSuggestions.postImageAlt)).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Page Two' }));
    const second = await screen.findByAltText(enPostSuggestions.postImageAlt);
    expect(second).toHaveAttribute('src', 'https://storage.example/p2.jpg');
  });
});

describe('postSuggestions Arabic plural — all six CLDR forms compile and the dual renders', () => {
  // The suite-wide next-intl mock resolves EN messages with English plural
  // rules, so the Arabic `remaining` message — the one string in this feature
  // carrying all six CLDR forms — would otherwise never execute: a malformed
  // two{}/few{} branch would throw at render, in production, in Arabic only.
  // Format it through the REAL next-intl translator (vi.importActual bypasses
  // the mock) with the REAL ar JSON, which parses the full ICU message.
  it('count: 2 produces the dual form', async () => {
    const { createTranslator } = await vi.importActual<typeof import('next-intl')>('next-intl');
    const t = createTranslator({
      locale: 'ar',
      messages: { postSuggestions: arPostSuggestions },
      namespace: 'postSuggestions',
    });
    render(<p>{t('remaining', { count: 2 })}</p>);
    expect(screen.getByText('محاولتان متبقيتان اليوم')).toBeInTheDocument();
  });
});

/**
 * A generation the merchant started can still be running when the dashboard
 * renders — it takes ~35s in a worker. The card has to say so rather than
 * preview a row whose text is deliberately empty.
 */
describe('PostSuggestionCard — a generation still in flight', () => {
  /** The row the worker owns — reported apart from the post, never as one. */
  const RUNNING = { id: 's-pending', status: 'pending' as const };
  const READY = {
    id: 's-ready',
    status: 'ready' as const,
    text: 'بوست جاهز',
    imageUrl: null,
    variants: [{ text: 'بوست جاهز', headline: null, imageUrl: null }],
    selectedVariant: 0,
    postType: 'general' as const,
    source: 'manual' as const,
    suggestedFor: '2026-08-09',
    createdAt: '2026-08-09T08:00:00Z',
  };

  it('announces the work instead of previewing an empty post', async () => {
    mockGetToday.mockResolvedValue({ data: { suggestion: null, inFlight: RUNNING, remainingToday: 2 } });
    renderCard();
    expect(await screen.findByText(enPostSuggestions.generating)).toBeInTheDocument();
    // The angle chip describes a post that does not exist yet.
    expect(screen.queryByText(enPostSuggestions.type_general)).not.toBeInTheDocument();
  });

  it('disables the action while pending, and offers to VIEW rather than to suggest', async () => {
    mockGetToday.mockResolvedValue({ data: { suggestion: null, inFlight: RUNNING, remainingToday: 2 } });
    renderCard();
    await screen.findByText(enPostSuggestions.generating);
    // A post IS coming, so a disabled "suggest a post" would read as "you may
    // not do this" rather than "this is nearly ready".
    expect(screen.getByRole('button', { name: enPostSuggestions.cardOpen })).toBeDisabled();
    expect(screen.queryByRole('button', { name: enPostSuggestions.cardCta })).not.toBeInTheDocument();
  });

  it('shows the post once the row turns ready', async () => {
    // Fresh objects per call — a shared fixture would let React bail out on an
    // identical reference and hide the very transition under test.
    mockGetToday
      .mockResolvedValueOnce({ data: { suggestion: null, inFlight: { ...RUNNING }, remainingToday: 2 } })
      .mockResolvedValue({ data: { suggestion: { ...READY }, inFlight: null, remainingToday: 2 } });
    renderCard();
    await screen.findByText(enPostSuggestions.generating);
    // The card polls on its own while the sheet is closed.
    expect(await screen.findByText('بوست جاهز', {}, { timeout: 6_000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: enPostSuggestions.cardOpen })).toBeEnabled();
  });

  it('a non-admin member sees the pending row too — it is their workspace\'s spent slot', async () => {
    mockRole.isAdmin = false;
    mockGetToday.mockResolvedValue({ data: { suggestion: null, inFlight: RUNNING, remainingToday: 2 } });
    renderCard();
    expect(await screen.findByText(enPostSuggestions.generating)).toBeInTheDocument();
  });

  it('⭐ a FAILED attempt offers to create one — it is not previewed as a post', async () => {
    // The failure this fix is about. A failed row counted as "has a post", so
    // the card rendered an empty preview line under a "View your post" button —
    // and because the seed predicate is "page has any row", a page whose seed
    // failed sat in that state forever.
    mockGetToday.mockResolvedValue({
      data: { suggestion: null, inFlight: { id: 'seed-failed', status: 'failed' as const }, remainingToday: 2 },
    });
    renderCard();
    expect(await screen.findByRole('button', { name: enPostSuggestions.cardCta })).toBeEnabled();
    expect(screen.getByText(enPostSuggestions.cardDesc)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: enPostSuggestions.cardOpen })).not.toBeInTheDocument();
  });

  it('⭐ a FAILED attempt keeps the post the page already had on the card', async () => {
    mockGetToday.mockResolvedValue({
      data: { suggestion: READY, inFlight: { id: 'later-failed', status: 'failed' as const }, remainingToday: 2 },
    });
    renderCard();
    expect(await screen.findByText('بوست جاهز')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: enPostSuggestions.cardOpen })).toBeEnabled();
  });
});

/**
 * The card is the feature's ENTRY POINT, and the entry point is where an
 * unusable action does its damage. `remainingToday` has ridden on this card's
 * response since the feature shipped and was spent on nothing: a merchant whose
 * three attempts had all FAILED — a burned slot is never refunded, see the
 * comment in `requestSuggestion` — was shown a full-strength «أنشئ منشوراً
 * الآن» that the server was guaranteed to refuse with a 429 («بلغت الحد
 * اليومي»). Reported on the running build, 2026-08-14.
 *
 * One rule pinned here: the card never offers an action the server will decline.
 */
describe('PostSuggestionCard — never offers what the server will refuse', () => {
  const POST = {
    id: 's-cap', status: 'ready', text: 'منشور جاهز', imageUrl: null,
    variants: [{ text: 'منشور جاهز', headline: 'ه', imageUrl: null }],
    selectedVariant: 0, postType: 'general', source: 'manual',
    suggestedFor: '2026-08-14', createdAt: '2026-08-14T08:00:00Z',
  };

  it('⭐ withholds the create CTA at a spent cap, and states the reason instead', async () => {
    // Three attempts, all failed: nothing to show AND nothing left to spend.
    mockGetToday.mockResolvedValue({
      data: { suggestion: null, inFlight: { id: 'f3', status: 'failed' as const }, remainingToday: 0 },
    });
    renderCard();

    expect(await screen.findByText(enPostSuggestions.noRemaining)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: enPostSuggestions.cardCta })).not.toBeInTheDocument();
    // Not a DISABLED button either: greyed-out reads as «you may not do this»,
    // a permission problem, when the truth is «come back tomorrow».
    expect(screen.queryByRole('button', { name: enPostSuggestions.cardCtaLast })).not.toBeInTheDocument();
    // And the generic pitch must not sit above the refusal, still selling it.
    expect(screen.queryByText(enPostSuggestions.cardDesc)).not.toBeInTheDocument();
  });

  it('still offers the post when one exists at a spent cap — the cap governs creating, not reading', async () => {
    mockGetToday.mockResolvedValue({ data: { suggestion: POST, remainingToday: 0 } });
    renderCard();

    expect(await screen.findByRole('button', { name: enPostSuggestions.cardOpen })).toBeEnabled();
    expect(screen.queryByText(enPostSuggestions.noRemaining)).not.toBeInTheDocument();
  });

  it('warns on the LAST attempt, so 0 is never a cliff', async () => {
    mockGetToday.mockResolvedValue({ data: { suggestion: null, remainingToday: 1 } });
    renderCard();

    expect(await screen.findByRole('button', { name: enPostSuggestions.cardCtaLast })).toBeEnabled();
    expect(screen.queryByRole('button', { name: enPostSuggestions.cardCta })).not.toBeInTheDocument();
  });

  it('says nothing about the budget while attempts are plentiful', async () => {
    // A quota printed on a fresh CTA makes the feature read as a limit.
    mockGetToday.mockResolvedValue({ data: { suggestion: null, remainingToday: 3 } });
    renderCard();

    expect(await screen.findByRole('button', { name: enPostSuggestions.cardCta })).toBeEnabled();
    expect(screen.queryByRole('button', { name: enPostSuggestions.cardCtaLast })).not.toBeInTheDocument();
  });

  it('an UNKNOWN remaining keeps the CTA — a cap store that is down must not deny a merchant', async () => {
    // `null` ≠ 0. Withholding on "we could not check" would block attempts the
    // merchant actually holds; the route fails closed behind it either way.
    mockGetToday.mockResolvedValue({ data: { suggestion: null, remainingToday: null } });
    renderCard();

    expect(await screen.findByRole('button', { name: enPostSuggestions.cardCta })).toBeEnabled();
    expect(screen.queryByText(enPostSuggestions.noRemaining)).not.toBeInTheDocument();
  });
});
