import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Page } from '@jawab24/shared';
import enPostSuggestions from '@/i18n/en/postSuggestions.json';
import arPostSuggestions from '@/i18n/ar/postSuggestions.json';
import { PostSuggestionCard } from './PostSuggestionCard';

const { mockGetToday, mockIsVisible, mockRole } = vi.hoisted(() => ({
  mockGetToday: vi.fn(),
  mockIsVisible: vi.fn(),
  mockRole: { isAdmin: true },
}));

vi.mock('@/lib/api', () => ({
  postSuggestionsApi: { getCurrent: mockGetToday, generate: vi.fn(), markEvent: vi.fn() },
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
  mockGetToday.mockResolvedValue({ data: { suggestion: null, remainingToday: 3 } });
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
