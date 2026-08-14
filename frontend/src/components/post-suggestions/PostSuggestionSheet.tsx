import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { X, Copy, Check, Download, RefreshCw, Sparkles, Pencil } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { POST_SUGGESTION_BRIEF_MAX, type PostSuggestionDto, type PostSuggestionInFlight } from '@jawab24/shared';
import { DetailSheet, Button } from '@/components/ui';
import { postSuggestionsApi, type PostSuggestionResponse } from '@/lib/api';
import { useCopyToClipboard } from '@/hooks';
import { downloadImage } from '@/utils/imageDownload';
import { captureError } from '@/lib/sentryHelpers';
import { POST_SUGGESTION_POLL_MS, POST_SUGGESTION_POLL_TIMEOUT_MS } from './polling';

/** First non-empty line, for the one-glance preview under the take tabs. */
function firstLine(text: string): string {
  return text.split('\n').map(l => l.trim()).find(Boolean) ?? '';
}

/**
 * What each take LEADS WITH — the merchant's actual question when choosing.
 *
 * The generator is instructed to write take 1 opening on the concrete offer,
 * take 2 on the customer's question, take 3 on the outcome, so the index IS
 * the lens. Numbered tabs («صياغة ١/٢/٣») made a merchant open and read all
 * three to learn something we already knew.
 *
 * Beyond the instructed three the label falls back to the number — a set that
 * ever grows past them has no promised lens, and inventing one would be a
 * claim about content we did not shape.
 */
function variantLens(index: number, t: (key: string, values?: Record<string, string | number | Date>) => string): string {
  return index <= 2 ? t(`variantLens${index}`) : t('variantTab', { number: index + 1 });
}

/**
 * «إنشاء منشور» viewer — the page's current post: text to copy, image to
 * save/share, capped create-another, and the earlier posts underneath. No
 * publishing: the merchant reviews and posts manually (the review line is
 * deliberate — industry norm is AI-drafted, human-approved).
 *
 * ⚠️ The post is no longer "today's". A daily cron used to write one every
 * morning; since 2026-08-13 exactly one post is seeded when a page first meets
 * the feature and every one after it is created on demand, so what this shows
 * is simply the most recent post — which may have been made last week.
 *
 * ⭐ `suggestion` and `inFlight` are separate for a reason: the post the
 * merchant HAS must stay on screen while a new one is written, and must not be
 * replaced by an attempt that FAILED. Both were once the same field, so a
 * failure blanked the sheet — permanently, once the read stopped being scoped
 * to a day.
 *
 * Opened with `initial` when the dashboard already fetched the current post;
 * opened with null it generates immediately (the card's CTA path). Every user
 * signal (open/copy/download) is stamped fire-and-forget — those stamps ARE the
 * pilot's success metric.
 */
export function PostSuggestionSheet({
  pageId,
  initial,
  canGenerate,
  onClose,
  onChanged,
}: {
  pageId: string;
  initial: PostSuggestionResponse | null;
  /** Workspace admins only — the generate route is requireRole('admin'). */
  canGenerate: boolean;
  onClose: () => void;
  /** Bubble the latest server state up so the card stays in sync. */
  onChanged: (latest: PostSuggestionResponse) => void;
}) {
  const t = useTranslations('postSuggestions');
  const tc = useTranslations('common');
  const { copied, copy } = useCopyToClipboard();

  const [suggestion, setSuggestion] = useState<PostSuggestionDto | null>(initial?.suggestion ?? null);
  // What is HAPPENING, kept apart from what the merchant HAS. Both used to be
  // `suggestion`, so a failed attempt — newer than the post it did not replace
  // — took the post's place on screen and, once the read stopped being
  // day-scoped, never gave it back. The post now stays put while a generation
  // runs and while one fails; this only drives the spinner and the error.
  const [inFlight, setInFlight] = useState<PostSuggestionInFlight | null>(initial?.inFlight ?? null);
  // null = UNKNOWN (cap store degraded server-side) — never treated as 0:
  // regenerate stays enabled and the generate route fails closed on its own.
  const [remaining, setRemaining] = useState<number | null>(initial?.remainingToday ?? null);
  // Why the current suggestion is text-only now travels ON the suggestion —
  // generation finishes in a worker, so the reason has to live on the row to
  // reach anyone. Reading it straight off `suggestion` also means the notice
  // can no longer disagree with the post it describes.
  // What the merchant is asking THIS generation for: what the post should say,
  // and what the picture should show. Two boxes rather than one because they
  // steer different halves and are routinely wanted apart — «صورة فيها صبية
  // محجبة» says nothing about the caption's argument.
  //
  // Deliberately NOT cleared after a generation. The merchant's second attempt
  // is nearly always a TWEAK of the first request, and blanking the box makes
  // them retype it; the disclosure below stays open whenever either box has
  // content, so what will be sent is never hidden from them.
  const [brief, setBrief] = useState('');
  const [imageRequest, setImageRequest] = useState('');
  // Whether the request panel is expanded. Post-first (owner ruling): the post
  // is already written when the sheet opens, so read→copy→leave is the common
  // visit and asking is the exception — it gets one quiet row, not the top of
  // the sheet. Forced open when either box has content so a request can never
  // be sent from a panel the merchant cannot see.
  const [requestOpen, setRequestOpen] = useState(false);
  // ⚠️ NO `history` state. The earlier-posts strip was removed on 2026-08-14
  // (owner: «I do not see any benefit for it»). The ROWS are untouched — they
  // are still written, still `superseded` rather than deleted, and the read
  // route still serves them — so restoring the strip is a UI change alone.
  // See backend/docs/OBJECT_STORAGE.md §9: those rows keep their images, and
  // that exemption now rests on retention, not on this UI referencing them.
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Merchant choice: append the verified contact footer (address/phone/WhatsApp)?
  // Default ON; applies to the NEXT generation (the server composes the footer).
  const [includeContact, setIncludeContact] = useState(true);
  // Which take is on screen. Seeded from the server so reopening the sheet
  // shows the one the merchant last chose, not take 1 again.
  const [variantIndex, setVariantIndex] = useState(initial?.suggestion?.selectedVariant ?? 0);
  // Merchant's local edits, PER TAKE — switching away and back must not throw
  // away what they typed. Keyed by index, reset per suggestion.
  const [editsByVariant, setEditsByVariant] = useState<Record<number, string>>({});
  const stampedOpen = useRef(false);
  // Auto-generate must fire ONCE per sheet open: StrictMode double-mounts
  // effects in dev, and each paid call consumes a daily-cap slot — caught
  // live (two POSTs in the same millisecond) during the local pilot run.
  const autoGenerated = useRef(false);

  const stamp = useCallback((id: string, event: 'opened' | 'copied' | 'downloaded') => {
    postSuggestionsApi.markEvent(pageId, id, event).catch((err) => {
      // Signal only — never user-visible. A 5xx is real contract breakage on
      // the pilot's metric route and must reach Sentry; network blips and 404s
      // (dark feature / deleted row) stay swallowed to avoid mobile noise.
      const status = (err as { response?: { status?: number } }).response?.status;
      if (typeof status === 'number' && status >= 500) {
        captureError(err, 'Post suggestion event stamp failed', { extra: { pageId, event } });
      }
    });
  }, [pageId]);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Remembered for the recovery below: the post that was on screen BEFORE
    // this generation, so a recovered row can be told apart from it.
    const priorId = suggestion?.id ?? null;
    try {
      const res = await postSuggestionsApi.generate(pageId, includeContact, brief, imageRequest);
      // The response carries the post the merchant already had (unchanged
      // until the worker finishes) plus the row this click claimed.
      setSuggestion(res.data.suggestion);
      setInFlight(res.data.inFlight ?? null);
      setRemaining(res.data.remainingToday);
      // No history here by design — generate answers with a pending row, so the
      // strip keeps what it has until the poll below returns the settled list.
      onChanged(res.data);
    } catch (err) {
      const axiosErr = err as { response?: { status?: number; data?: { code?: string } } };
      const code = axiosErr.response?.data?.code;
      if (code === 'daily_cap') setError(t('errorDailyCap'));
      else if (code === 'quota_check_unavailable') setError(t('errorQuotaCheck'));
      else if (code === 'generation_failed') setError(t('errorGeneration'));
      // Route-level limiter (2/min) — expected throttling under normal
      // clicking, distinct from the daily cap; never a Sentry event (the
      // server already fingerprints it on its side).
      else if (code === 'RATE_LIMIT_EXCEEDED') setError(t('errorRateLimit'));
      else if (!axiosErr.response) {
        // NO HTTP RESPONSE — the connection died, which says nothing about
        // whether the server finished. It usually DID: generation runs ~35s
        // against nginx's 30s proxy_read_timeout on this route, so the socket
        // closes while the work completes and commits. Reported live
        // 2026-08-12: the merchant saw «حدث خطأ ما» while their post existed,
        // with a capped attempt already spent on it.
        //
        // So ask before despairing. A row IN FLIGHT, or a post whose id differs
        // from what was on screen, is THIS generation's result — adopt it and
        // the poll takes over. Nothing new means nothing landed, and the
        // generic error is then the honest answer.
        try {
          const latest = await postSuggestionsApi.getCurrent(pageId);
          const running = latest.data.inFlight ?? null;
          const recovered = latest.data.suggestion;
          if (running || (recovered && recovered.id !== priorId)) {
            setSuggestion(recovered);
            setInFlight(running);
            setRemaining(latest.data.remainingToday);
            // A row that already ENDED in failure is a real failure to report —
            // but as the generation error, not the "we have no idea" one.
            if (running?.status === 'failed') setError(t('errorGeneration'));
            onChanged(latest.data);
            return;
          }
        } catch {
          // Recovery is best-effort; fall through to the error below.
        }
        setError(t('errorGeneric'));
        captureError(err, 'Post suggestion generation failed', { extra: { pageId, recovered: false } });
      } else {
        setError(t('errorGeneric'));
        captureError(err, 'Post suggestion generation failed', { extra: { pageId } });
      }
    } finally {
      setLoading(false);
    }
  }, [pageId, onChanged, t, includeContact, suggestion, brief, imageRequest]);

  // The take on screen, and the text the merchant sees for it (their edit if
  // they made one, the model's otherwise). One derivation — every consumer
  // (textarea, copy, the switcher) reads THESE, so they cannot disagree.
  //
  // The empty-`variants` fallback is not defensive padding: during a blue/green
  // deploy this bundle can be served a response from the OLD backend, which has
  // no `variants` field at all. Projecting the columns it DOES send keeps the
  // sheet fully usable in that window instead of showing an empty textarea.
  const variants = suggestion
    ? (suggestion.variants?.length
      ? suggestion.variants
      : [{ text: suggestion.text, headline: null, imageUrl: suggestion.imageUrl }])
    : [];
  const activeIndex = variantIndex < variants.length ? variantIndex : 0;
  const activeVariant = variants[activeIndex];
  const activeText = editsByVariant[activeIndex] ?? activeVariant?.text ?? '';
  const activeImageUrl = activeVariant?.imageUrl ?? null;

  // Opened with a suggestion → stamp `opened` once. Opened empty (CTA path) →
  // generate immediately, if this member is allowed to.
  //
  // Keyed on the suggestion's ID, NOT the object. Saving a take swaps in a
  // fresh object with the same id, and resetting on that would delete whatever
  // the merchant had typed the instant their choice finished saving — losing
  // typed work is the exact failure this whole feature exists to end. A
  // REGENERATE mints a new id, which is the case that genuinely must reset.
  const suggestionId = suggestion?.id ?? null;
  useEffect(() => {
    setEditsByVariant({});
    setVariantIndex(suggestion?.selectedVariant ?? 0);
    // `suggestion` is only ever a finished post now (a running or failed
    // attempt is `inFlight`), so there is no pending row to guard against
    // stamping — which would have broken the pilot's own metric, that counts
    // posts actually seen.
    if (suggestion && !stampedOpen.current) {
      stampedOpen.current = true;
      stamp(suggestion.id, 'opened');
    } else if (!suggestion && !inFlight && !loading && !error && canGenerate && !autoGenerated.current) {
      // Nothing to show AND nothing already running. The `!inFlight` guard is
      // what stops a sheet opened over a generation someone else started (or
      // one the merchant left running) from spending a second capped slot.
      autoGenerated.current = true;
      void generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount + new-suggestion only
  }, [suggestionId]);

  /**
   * Wait out a generation that is running in a worker.
   *
   * The request returns the instant the row is claimed, so this is where the
   * ~35s actually passes. Polling — rather than holding the request open — is
   * the whole point: nginx cuts this route at 30s, which is how a finished post
   * came to be reported to a merchant as «حدث خطأ ما» on 2026-08-12.
   *
   * The worker always drives the row to `ready` or `failed`, so this loop is
   * bounded by the server's own contract; the timeout below only stops us
   * asking forever if that contract is broken.
   */
  const [pollTimedOut, setPollTimedOut] = useState(false);
  // The row this poll is waiting on — null when nothing is running.
  const waitingOn = inFlight?.status === 'pending' ? inFlight.id : null;
  useEffect(() => {
    if (!waitingOn) return;
    setPollTimedOut(false);
    let cancelled = false;
    const startedAt = Date.now();

    const id = setInterval(() => {
      if (Date.now() - startedAt > POST_SUGGESTION_POLL_TIMEOUT_MS) {
        clearInterval(id);
        if (!cancelled) setPollTimedOut(true);
        return;
      }
      void postSuggestionsApi.getCurrent(pageId)
        .then((res) => {
          // A regenerate started meanwhile re-runs this effect with a new id;
          // this run's cleanup has already flipped `cancelled`, so a reply that
          // lands afterwards must not write over it.
          if (cancelled) return;
          const next = res.data.inFlight ?? null;
          // Still the same attempt, still running → keep waiting.
          if (next?.id === waitingOn && next.status === 'pending') return;
          // Settled — either it became the post (inFlight null) or it failed.
          // A DIFFERENT row in flight (a second admin on the same page) is
          // adopted too: the effect re-runs and waits on that one instead.
          clearInterval(id);
          setSuggestion(res.data.suggestion);
          setInFlight(next);
          setRemaining(res.data.remainingToday);
          setError(next?.status === 'failed' ? t('errorGeneration') : null);
          onChanged(res.data);
        })
        // A blip mid-poll is not a failure — the next tick asks again, and the
        // row is safe on the server either way.
        .catch(() => undefined);
    }, POST_SUGGESTION_POLL_MS);

    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one poll per in-flight row
  }, [waitingOn, pageId]);

  // Busy = this click is in flight OR the worker still owns the row. One
  // derivation, so the spinner cannot disagree with what the server is doing.
  const working = loading || inFlight?.status === 'pending';

  // Unknown remaining (null) keeps regenerate ENABLED — only a confirmed 0
  // disables it; the generate route fails closed server-side regardless.
  const canRegenerate = canGenerate && remaining !== 0 && !working;

  /**
   * Switch takes. The choice is persisted so every OTHER reader agrees with
   * what the merchant is looking at — the dashboard card, and app bundles that
   * predate variants and can only read the mirrored columns.
   *
   * Optimistic: the switch is local state and paints immediately; the PUT
   * follows. A failed PUT is not surfaced — the merchant can still read, edit,
   * copy and download the take they picked, so an error toast would report a
   * problem they do not have. It reaches Sentry instead.
   */
  const selectVariant = (index: number) => {
    setVariantIndex(index);
    if (!suggestion || index === suggestion.selectedVariant) return;
    postSuggestionsApi.selectVariant(pageId, suggestion.id, index)
      .then((res) => setSuggestion(res.data.suggestion))
      .catch((err) => captureError(err, 'Post suggestion variant selection failed', { extra: { pageId, index } }));
  };

  const handleCopy = async () => {
    if (!suggestion) return;
    // The `copied` stamp IS the pilot's success metric — stamp only when the
    // clipboard write actually landed, never on a blocked/absent API.
    const ok = await copy(activeText);
    if (ok) stamp(suggestion.id, 'copied');
    else toast.error(t('copyFailed'));
  };

  const handleDownload = async () => {
    if (!activeImageUrl || !suggestion) return;
    try {
      // Fetched through our OWN origin, by take index — never from the stored
      // bucket URL. That host answers `<img>` but refuses `fetch` (no CORS), so
      // downloading straight from it failed on every press until this.
      const res = await postSuggestionsApi.downloadImage(pageId, suggestion.id, activeIndex);
      const { savedToFiles } = await downloadImage(res.data, `jawab24-post-${suggestion.suggestedFor}.jpg`);
      stamp(suggestion.id, 'downloaded');
      toast.success(savedToFiles ? t('imageSavedToFiles') : t('imageDownloadStarted'));
    } catch (err) {
      captureError(err, 'Post suggestion image download failed', { extra: { pageId } });
      toast.error(t('errorGeneric'));
    }
  };

  return (
    <DetailSheet
      fitContent
      onSwipeDismiss={onClose}
      panelClassName="sm:max-w-lg"
      dialogProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'post-suggestion-title' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:p-5 border-b border-theme-border flex-shrink-0">
        <h2 id="post-suggestion-title" className="text-base sm:text-lg font-semibold text-foreground flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-brand-500" aria-hidden="true" />
          {t('sheetTitle')}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={tc('close')}
          // hover:bg-surface-100 was invisible in dark mode — that token is
          // synced to --card, so the hover state painted the card's own colour.
          className="min-h-[44px] min-w-[44px] -me-2 flex items-center justify-center rounded-lg hover:bg-surface-200 dark:hover:bg-surface-300 text-icon-muted"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4">
        {working && (
          <div className="py-10 text-center space-y-2" aria-busy="true" aria-live="polite">
            <RefreshCw className="w-6 h-6 mx-auto animate-spin motion-reduce:animate-none text-brand-500" aria-hidden="true" />
            {/* The request being written is echoed back, so a ~30s wait never
                feels like a dead click AND the merchant can see we heard them.
                Read off the IN-FLIGHT ROW, not local state: a merchant who
                closed the sheet and reopened it still gets their own words.
                `dir="auto"` because it is their text, in their script. */}
            <p className="text-sm font-semibold text-foreground" dir="auto">
              {inFlight?.brief
                ? t('generatingBrief', { brief: inFlight.brief })
                : t('generating')}
            </p>
            <p className="text-xs text-muted-foreground">
              {/* Still running, not lost: the worker owns the row and always
                  resolves it, so the merchant is told it is slow — never shown
                  a failure that did not happen. */}
              {pollTimedOut ? t('takingLonger') : t('generatingHint')}
            </p>
          </div>
        )}

        {!working && error && (
          <div className="alert-error rounded-xl p-4 text-sm" role="alert">{error}</div>
        )}

        {/* No post yet — the page's first generation failed, or its one-time
            SEED did. Until this existed the sheet rendered the failed row as if
            it were a post: an empty body with Copy/Download over nothing, and
            no way to start another. The seed predicate is "has any row", so
            that state never resolved on its own.

            Gated on there being a REASON for the emptiness (an attempt that
            ended, an error, or no permission to generate) rather than on
            `!suggestion` alone: the CTA path opens the sheet empty and
            auto-generates in an effect, i.e. one frame later — an ungated CTA
            would flash there, and a click landing in that frame would spend a
            second capped slot on top of the one the effect is about to. */}
        {!working && !suggestion && (inFlight || error || !canGenerate) && (
          <div className="py-8 text-center space-y-3">
            <Sparkles className="w-6 h-6 mx-auto text-brand-500" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">{t('cardDesc')}</p>
            {canGenerate && (
              remaining === 0
                ? <p className="text-xs text-subtle">{t('noRemaining')}</p>
                : (
                  <Button size="sm" className="min-h-[44px]" onClick={() => void generate()}>
                    <Sparkles className="w-4 h-4 me-1.5" aria-hidden="true" />
                    {t('cardCta')}
                  </Button>
                )
            )}
          </div>
        )}

        {!working && suggestion && (
          <>
            {/* Take switcher — the generation's takes, side by side. Hidden for
                a single-take suggestion (every row generated before variants
                shipped), so nothing changes for those. */}
            {variants.length > 1 && (
              // Deliberately the same filled-pill shape as the angle chips and
              // the card's page switcher rather than a tinted-track segmented
              // control: `surface-100` is synced to `--card` in dark mode, so a
              // track drawn with it disappears and takes the active pill's
              // contrast with it. Brand fill reads in both themes.
              <div role="tablist" aria-label={t('variantsLabel')} className="flex gap-1.5">
                  {variants.map((variant, index) => (
                    <button
                      key={index}
                      type="button"
                      role="tab"
                      aria-selected={index === activeIndex}
                      // The visible label is the LENS; the accessible name adds
                      // the take's own opening words, so a screen-reader user
                      // gets the same "how do these differ" answer a sighted
                      // one reads off the preview line below.
                      aria-label={`${variantLens(index, t)} — ${firstLine(variant.text)}`}
                      onClick={() => selectVariant(index)}
                      className={clsx(
                        'flex-1 min-h-[44px] rounded-xl px-2 text-xs font-semibold border transition-colors',
                        index === activeIndex
                          ? 'bg-brand-500 text-white border-brand-500'
                          : 'bg-card text-muted-foreground border-theme-border hover:border-brand-300',
                      )}
                    >
                      {variantLens(index, t)}
                    </button>
                  ))}
              </div>
            )}

            {activeImageUrl ? (

              // generated media; not a build-time asset and the host is outside
              // next.config remotePatterns, so next/image cannot serve it.
              <img
                key={activeImageUrl}
                src={activeImageUrl}
                alt={t('postImageAlt')}
                // The cards are square 1024×1024. At `w-full` that is a
                // full-viewport-width square, which pushed Copy/Download below
                // the fold on a long post — and in LANDSCAPE made the image
                // alone taller than the whole sheet (panel ≈378px, image
                // ≈472px), so the merchant landed on a picture with every
                // action off-screen. Bound it by HEIGHT and let width follow.
                // The intrinsic size attributes reserve the box, so neither the
                // first load nor switching takes shifts the layout under a
                // thumb already reaching for a button.
                width={1024}
                height={1024}
                className="mx-auto h-auto w-auto max-h-[38vh] landscape:max-h-[30vh] rounded-xl border border-theme-border"
              />
            ) : (
              // Shown from the DATA (no imageUrl = text-only), and the REASON
              // comes off the row rather than the response that generated it —
              // so a cron row, a re-read and a fresh degrade all explain
              // themselves the same way.
              <p className="text-xs text-muted-foreground">
                {suggestion.imageDegraded === 'storage_off'
                  ? t('textOnlyStorageOff')
                  // A REFUSAL is the merchant's to act on — the provider declined
                  // the scene THEY described, and only they can rewrite it.
                  // `image_failed` is ours and retrying may fix it, so the two
                  // must not share one «no image today» that teaches nothing.
                  : suggestion.imageDegraded === 'image_refused'
                    ? t('textOnlyRefused')
                    : t('textOnlyNotice')}
              </p>
            )}

            {/* GROUND-AND-FLAG (D-082). The merchant asked for something their
                Business Info does not carry, so the post was written from what
                the data DOES support and the gap is named rather than filled.
                Refusing to invent is only half an answer: silently writing about
                something else reads as the box ignoring them — which is exactly
                how an appliance importer got a post about an invented English
                course. Naming it turns a bad generation into an instruction.
                `dir="auto"`: the string quotes the merchant's own subject. */}
            {suggestion.unmetRequest && (
              <div className="alert-warning rounded-xl p-3 text-xs space-y-1.5" dir="auto">
                <p>{t('unmetRequestNotice', { what: suggestion.unmetRequest })}</p>
                <Link href="/pages?openKb=true" className="inline-block font-medium underline underline-offset-2">
                  {t('unmetRequestCta')}
                </Link>
              </div>
            )}

            {/* THE POST. It is the product, so it is read as a post — not as a
                form field wearing a label.

                An outside reviewer once read this sheet and reported editing as
                MISSING, and the fix then was a «عدّل نص المنشور» caption above
                it. That treated a VISUAL problem with a sentence: the field
                looked like output, so we wrote a line explaining it was not.
                The caption is gone and the affordance is now visual and
                permanent — a pencil sitting in the corner of the field, and a
                hover/focus border. The accessible name carries what the caption
                said, so a screen-reader user is told it is editable exactly as
                before. */}
            <div className="relative">
              <Pencil
                className="pointer-events-none absolute top-2.5 end-2.5 w-3.5 h-3.5 text-icon-muted"
                aria-hidden="true"
              />
              <textarea
                dir="auto"
                aria-label={t('editTextLabel')}
                value={activeText}
                onChange={(e) => setEditsByVariant((prev) => ({ ...prev, [activeIndex]: e.target.value }))}
                rows={Math.min(10, Math.max(4, activeText.split('\n').length + 1))}
                className="w-full rounded-xl border border-transparent bg-transparent p-3 pe-8 text-sm text-foreground text-start leading-relaxed resize-y transition-colors hover:border-theme-border focus:border-theme-border focus:bg-background focus:outline-none focus:ring-2 focus:ring-brand-300"
              />
            </div>

            {canRegenerate && (
              /* ASK — post-first (owner ruling 2026-08-13). The post is already
                 written when the sheet opens, so read→copy→leave is the common
                 visit; asking is the exception and gets ONE quiet row that
                 expands. This replaced the five angle chips, which the owner
                 removed as «مالها لازمة»: a free-text request is a strictly more
                 expressive duplicate of a preset angle, and the request already
                 outranks the angle server-side.

                 <details> rather than a hand-rolled toggle: native disclosure
                 gets keyboard, screen-reader and open-state behaviour right for
                 free. `open` is CONTROLLED so a box with content can never be
                 collapsed out of sight while it is still what would be sent. */
              /* A HAIRLINE, not a card. This panel used to be a bordered,
                 filled box sitting inside the sheet's own box, with the
                 history disclosure making a third — box inside box inside
                 box was half of what made this sheet feel crowded. A single
                 top rule separates "the post" from "ask for another" just as
                 well and adds no enclosure. */
              <details
                open={requestOpen || Boolean(brief || imageRequest)}
                className="border-t border-theme-border pt-1"
              >
                {/* The native toggle is SUPPRESSED and the state owned here.
                    A <details> whose `open` is a prop is only half-controlled:
                    the browser flips the DOM attribute itself on click, and
                    React then skips the reconcile because its own value never
                    changed — so a panel forced open by having content collapses
                    anyway and stays collapsed. preventDefault on every click
                    makes this component the single writer. */}
                <summary
                  onClick={(e) => {
                    e.preventDefault();
                    // A live request must never be hidden: while either box has
                    // content the panel only opens, it does not close.
                    if (brief || imageRequest) { setRequestOpen(true); return; }
                    setRequestOpen((open) => !open);
                  }}
                  className="flex items-center gap-2 min-h-[44px] text-xs font-medium text-muted-foreground cursor-pointer select-none"
                >
                  <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  {t('askLabel')}
                </summary>

                <div className="pb-1 space-y-3">
                  {/* What the post should SAY. */}
                  <label className="block">
                    <span className="block mb-1.5 text-xs font-medium text-muted-foreground">{t('briefLabel')}</span>
                    <textarea
                      dir="auto"
                      value={brief}
                      onChange={(e) => setBrief(e.target.value)}
                      maxLength={POST_SUGGESTION_BRIEF_MAX}
                      rows={2}
                      placeholder={t('briefPlaceholder')}
                      className="w-full rounded-xl border border-theme-border bg-background p-3 text-sm text-foreground text-start leading-relaxed resize-y placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-300"
                    />
                  </label>

                  {/* What the PICTURE should show — its own box (owner's call).
                      One field for what the post says, one for what the picture
                      shows: they are routinely wanted apart, and a single box
                      made the scene compete with the subject. */}
                  <label className="block">
                    <span className="block mb-1.5 text-xs font-medium text-muted-foreground">{t('imageRequestLabel')}</span>
                    <textarea
                      dir="auto"
                      value={imageRequest}
                      onChange={(e) => setImageRequest(e.target.value)}
                      maxLength={POST_SUGGESTION_BRIEF_MAX}
                      rows={2}
                      placeholder={t('imageRequestPlaceholder')}
                      className="w-full rounded-xl border border-theme-border bg-background p-3 text-sm text-foreground text-start leading-relaxed resize-y placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-300"
                    />
                  </label>

                  {/* «اترك الحقلين فارغين ونختار…» removed: it explained the
                      default behaviour of two fields already marked
                      «(اختياري)», to a merchant who has just chosen to open a
                      panel they did not have to open. */}
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeContact}
                      onChange={(e) => setIncludeContact(e.target.checked)}
                      className="rounded border-theme-border accent-brand-500"
                    />
                    {t('includeContactToggle')}
                  </label>
                </div>
              </details>
            )}

            {/* The remaining-attempts COUNT moved onto the create button (see
                the footer): it is a property of that action, and as a free
                sentence in the body it read as a standing warning about a
                limit rather than a label on a control.

                Only the EXHAUSTED state stays here, and only because at zero
                there is no button left to carry it — the footer hides the
                control entirely, so without this line the sheet would simply
                lose the ability to create with no explanation.
                null = unknown: assert neither a count nor "exhausted". */}
            {remaining === 0 && (
              <p className="text-xs text-subtle">{t('noRemaining')}</p>
            )}

          </>
        )}

      </div>

      {/* Fixed footer (Rule 3: scrollable body, fixed header/footer). Copy is
          the action this whole feature exists to produce — 16 posts generated
          in the pilot and not one ever copied — so it must never be the thing
          the merchant has to scroll past an image and an editor to reach.
          pb-safe-modal clears the home indicator; it collapses on its own when
          the keyboard is open, so the bar rides above it while editing. */}
      {!working && suggestion && (
        <div className="flex-shrink-0 border-t border-theme-border bg-card px-4 py-3 sm:px-5 pb-safe-modal flex flex-wrap gap-2">
          {/* PRIMARY. Three equal-weight grey buttons said all three actions
              matter the same; they do not. Copying is why the merchant opened
              the sheet, and it is the metric the pilot exists to move. */}
          <Button size="sm" className="min-h-[44px] flex-1 sm:flex-none" onClick={() => void handleCopy()}>
            {copied ? <Check className="w-4 h-4 me-1.5" aria-hidden="true" /> : <Copy className="w-4 h-4 me-1.5" aria-hidden="true" />}
            {copied ? t('copied') : t('copyText')}
          </Button>
          {activeImageUrl && (
            <Button variant="secondary" size="sm" className="min-h-[44px] flex-1 sm:flex-none" onClick={handleDownload}>
              <Download className="w-4 h-4 me-1.5" aria-hidden="true" />
              {t('downloadImage')}
            </Button>
          )}
          {canRegenerate && (
            /* The remaining count rides ON the control it governs. As its own
               sentence in the body it read as a warning about a limit; here it
               is a label on the button that spends it. `null` = unknown, so the
               button simply carries no count rather than inventing one. */
            <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={() => void generate()}>
              <RefreshCw className="w-4 h-4 me-1.5" aria-hidden="true" />
              {remaining !== null ? t('regenerateWithCount', { count: remaining }) : t('regenerate')}
            </Button>
          )}
        </div>
      )}
    </DetailSheet>
  );
}
