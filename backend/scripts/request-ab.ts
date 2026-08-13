/**
 * Before/after for the merchant's two request boxes — TEXT ONLY, no image call.
 *
 * Generates the same page's post with and without a request, so the effect can
 * be read side by side rather than asserted. Text-only keeps a run cheap enough
 * to repeat, which is what judging prompt steering actually needs.
 *
 *   npx tsx scripts/request-ab.ts <pageId> "<brief>" ["<imageRequest>"]
 *
 * Either request may be empty — pass "" to exercise one box alone, which is the
 * case that matters most for the second box (a scene request must NOT drag the
 * caption's subject with it).
 *
 * ⚠️ This runs in its OWN process, so it does NOT inherit the feature flags you
 * gave the backend — without them the gate rejects both arms and prints only
 * `FAILED: gated`, which looks like a broken page rather than a missing env:
 *
 *   POST_SUGGESTIONS_ENABLED=true POST_SUGGESTIONS_WORKSPACE_IDS=<workspaceId> \
 *     npx tsx scripts/request-ab.ts <pageId> "<brief>" "<imageRequest>"
 *
 * Each arm spends one of the page's 3 daily slots, and the cap has TWO floors
 * (a Redis counter AND today's row count) — so a page already at 2/3 can only
 * run one arm.
 */
import { db } from '../src/db';
import { pages, postSuggestions } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import type { PostSuggestionPostType } from '@jawab24/shared';
import { postSuggestionsService, setPostSuggestionsLogger } from '../src/services/postSuggestions';
import { Sentry } from '../src/lib/sentry';

// captureError() forwards to Sentry ONLY — with Sentry unconfigured locally a
// generation failure leaves no trace at all. Surface it here so a local run can
// actually be debugged.
(Sentry as unknown as { captureException: (e: unknown) => void }).captureException = (e: unknown) => {
    console.error('  ✖ captured:', e instanceof Error ? e.message : String(e));
};

const [pageId, brief, imageRequest] = process.argv.slice(2);
if (!pageId || brief === undefined) {
    console.error('usage: npx tsx scripts/request-ab.ts <pageId> "<brief>" ["<imageRequest>"]');
    process.exit(1);
}

// Quiet the service's own logging except the lines this script exists to show.
const noise = /Figures|could not be met|implied an angle|refused/;
setPostSuggestionsLogger({
    info: (m: string, x?: unknown) => { if (noise.test(m)) console.log('  ⟐', m, JSON.stringify(x)); },
    warn: (m: string, x?: unknown) => { if (noise.test(m)) console.log('  ⚠', m, JSON.stringify(x)); },
    error: () => {},
    debug: () => {},
});

async function runOnce(
    label: string,
    req: { brief?: string; imageRequest?: string },
    baseline: PostSuggestionPostType,
) {
    const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
    if (!page?.workspaceId) throw new Error('page not found or has no workspace');

    console.log(`\n${'='.repeat(70)}\n${label}\n${'='.repeat(70)}`);
    // 'manual' on purpose: the cron source carries a once-per-day partial unique
    // index, so a second cron run the same day is suppressed and silently returns
    // the FIRST row — which reads as "the request changed nothing". This is the
    // real merchant path anyway: request returns pending, the running backend's
    // worker fulfils it, we poll.
    //
    // The SAME baseline angle goes to both arms. Without it this harness cannot
    // compare anything: arm 1's row becomes arm 2's "previous", and the variety
    // picker excludes the previous type — so the arms differed in ANGLE every
    // run, by construction. That artifact was read as a product defect on
    // 2026-08-12 («the brief hijacked the angle») and cost a real investigation.
    // Pinned here, a divergence in the stored angle now means one thing only:
    // the request moved it, which is the behaviour under test.
    const r = await postSuggestionsService.requestSuggestion(page.workspaceId, pageId, 'manual', {
        postType: baseline,
        ...(req.brief ? { brief: req.brief } : {}),
        ...(req.imageRequest ? { imageRequest: req.imageRequest } : {}),
    });
    if (!r.ok) { console.log('  FAILED:', r.reason); return; }

    // Fulfil IN-PROCESS rather than waiting on a running backend's worker.
    // It is the same method the worker calls, so the generation under test is
    // unchanged; only the queue hop is skipped — which is not what this
    // measures, and requiring a second process was how the previous harness
    // could print «still pending» and look like a model failure.
    const claimed = r.inFlight?.id ?? r.suggestion?.id;
    if (!claimed) { console.log('  no row claimed'); return; }
    await postSuggestionsService.fulfilSuggestion(claimed, { includeContact: false });

    const row = (await db.select().from(postSuggestions).where(eq(postSuggestions.id, claimed)).limit(1))[0];
    if (row?.status === 'pending') { console.log('  still pending after fulfil — unexpected'); return; }
    if (row?.status === 'failed') { console.log('  FAILED:', row.failureReason); return; }
    const moved = row?.postType && row.postType !== baseline ? `  (baseline was ${baseline} — the request MOVED it)` : '';
    console.log(`  status=${row?.status}  angle=${row?.postType}${moved}  mode=${row?.imageMode}`);
    console.log(`  brief=${row?.brief ?? '(none)'}`);
    console.log(`  imageRequest=${row?.imageRequest ?? '(none)'}`);
    // The things this harness exists to make visible, none of which can be read
    // off the rendered post: whether the request reached the scene, whether it
    // was allowed a person, and what it could not honour.
    console.log(`  unmetRequest: ${row?.unmetRequest ?? '(none — fully honoured)'}`);
    if (row?.imageDegraded) console.log(`  imageDegraded: ${row.imageDegraded}`);
    // The SCENE the model asked for. Printed because it is measurable without
    // object storage — the picture may never render locally, but whether the
    // merchant's request reached the scene description is the actual question.
    console.log(`\n  ▣ imageBrief: ${row?.imageBrief ?? '(none)'}`);
    (row?.variants ?? []).forEach((v, i) => {
        console.log(`\n  ── take ${i + 1} — «${v.headline ?? ''}»\n${v.text.split('\n').map(l => '     ' + l).join('\n')}`);
    });
}

(async () => {
    // One baseline angle for both arms, read BEFORE either run so neither arm's
    // row can influence it.
    //
    // Only angles whose deliverability this script can verify from the page row
    // alone are eligible — `faq_tip` needs a Business Info, `general` needs
    // nothing. The richer angles (promo, product_spotlight) depend on evidence
    // only the fulfil path's fetched bundle holds, and an undeliverable request
    // is DOWNGRADED to the variety picker — which would silently reintroduce
    // exactly the previous-row dependence this pinning exists to remove.
    const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
    if (!page) throw new Error('page not found');
    const baseline: PostSuggestionPostType = page.knowledgeBase?.trim() ? 'faq_tip' : 'general';
    console.log(`page: ${page.name}\nbaseline angle for BOTH arms: ${baseline}`);

    await runOnce('WITHOUT a request (today\'s behaviour)', {}, baseline);
    await runOnce(
        `WITH  brief=«${brief || '(empty)'}»  imageRequest=«${imageRequest || '(empty)'}»`,
        { brief, imageRequest },
        baseline,
    );
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
