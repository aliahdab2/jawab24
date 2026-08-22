# SEO / AI-Visibility Actions — August 7, 2026

*Follow-up to `SEO_ACTIONS_2026-07-10.md` (July 10) and `SEO_Audit_Jawab24.md` (May 30).*

Triggered by two visibility reports (`jawab24-visibility-report.html`, `jawab24-12week-plan.html`)
proposing a 12-week programme. Most of their findings were already shipped — this document
records what was verified, what was actually fixed, and what remains owner-manual, so the
same stale audit is not run a fourth time.

---

## 1. Report claims vs. verified live state

Every row below was checked against the code **and** production (`curl https://jawab24.com/`),
not against a previous audit document.

| Report claim (Aug 7) | Verified state | Verdict |
|---|---|---|
| "AggregateRating not implemented (0 detected)" | Live in production, added July 10 | **Already shipped** — see §2 |
| "Add SoftwareApplication + Organization + BreadcrumbList" | All three present (`_document.tsx`, `components/seo/BreadcrumbJsonLd.tsx`) | Already shipped |
| "Verify real hreflang tags exist" | `_app.tsx:623-625` emits ar/en/x-default; asserted by `e2e/seo.spec.ts` | Already shipped (closed July 10) |
| "Fix Arabic TOC anchor bug (`#-`)" | `utils/headingSlug.ts` (Unicode `\p{L}\p{N}`), imported by `blog/[slug].tsx` | Already shipped July 12 |
| "Rewrite the two low-CTR titles" | Year-bearing `seoTitle`/`seoDescription` on **17/17** EN posts | Already shipped |
| "Backlinks are the #1 gap" | Correct — unchanged since May | **Valid, open** |
| "Bing Webmaster Tools not set up" | Correct | **Valid, open** |
| "Not in any 'best tools' listicle" | Correct (3 checked) | **Valid, open** |

**Why a freshly-generated report was stale.** Its stated methodology was 9 live search
queries + GSC data + reading 3 competitor listicles. It never read the codebase, so its
implementation-state claims were inherited from the May 30 audit. Recency of the session is
not verification of the claim.

**On "0 detected".** That figure may well be a real Rich-Results/GSC reading, and it is
consistent with §2: Google can see `aggregateRating` markup and decline to honour it. The
observation was probably right; the prescribed remedy ("add it") was inverted.

---

## 2. Fixed: unsupported `aggregateRating` (structured-data liability)

`_document.tsx` asserted `ratingCount: "50"`, documented as kept in sync with
`pricing.json` → `socialProofReviews`, which reads **"50+ businesses" / "أكثر من 50 نشاط تجاري"**.
That is a **customer count**. No corpus of 50 collected user reviews exists anywhere in the
product. Google requires aggregate ratings to be sourced from real user reviews, so the
markup was unsupported and liable to be dropped or penalised.

**Action taken:** removed the `aggregateRating` block; left an inline comment stating the
re-add condition (a genuine review corpus — Play Store / G2 / Capterra — that is also
displayed on the page). `AggregateOffer` ($15–$79) was left intact; it is correct per
`fallbackPlans.ts`.

**Deliberately NOT changed:** the on-page "4.8/5 · 50+ businesses" text on `/pricing`
(`pricing.json:93-94`). Whether that displayed claim is substantiated is a business
decision, not a code fix. **Open question for the owner.**

---

## 3. Fixed: the AI-facing surface was describing a March product

`llms.txt` and `llms-full.txt` exist solely to tell AI assistants what Jawab24 is. Measured
state before this change:

| | WhatsApp | Post Replies | Voice | Photos | Zid | Last modified |
|---|---|---|---|---|---|---|
| `llms.txt` | 0 | 0 | 0 | 0 | 1 | Jul 12 |
| `llms-full.txt` | 0 | 0 | 0 | 0 | 0 | **Mar 23** |

Zero mentions of WhatsApp — GA'd July 26, a flagship channel. Zero of Post Replies. Only 12
of 17 published blog posts were listed. The two files also contradicted each other on eval
size (125 vs 98 scenarios) and both were wrong.

**Action taken:** both files rewritten against the code (`integrations.ts`, `competitors.ts`,
the blog content dir, `fallbackPlans.ts`, `ai-worker/src/config.ts`). Added WhatsApp as a
first-class channel, a Channels section, Post Replies, voice/photo understanding, Zid, all 17
posts, all 5 comparison pages, real plan prices, and the correct model (`gpt-4.1-mini`, was
`GPT-4o-mini`). §6 terminology applied throughout (Business Info, Smart Reply, Post Reply).

**Accuracy claim removed, not corrected.** The old "99.6% across 125 real-world scenarios"
could not be substantiated: the suite header says 440 cases, a structural count gives ~293,
14 cases are marked `expectedFail`, and there is no recorded pass rate at the current size.
An assistant quotes such a number verbatim, so the files now describe the quality
**controls** (confidence scoring, two-tier price verification, Business Info grounding,
expectedFail-tracked gaps) — all verifiable — instead of an unbacked metric.
**Open for the owner:** run `npm run eval` and, if desired, reinstate a dated, sourced figure.

---

## 4. Added: `npm run llms:validate` — the anti-staleness gate

Prose instructions had five months to keep those files current and did not
(AI_INSTRUCTIONS §14 — prevention over detection). New validator at
`frontend/scripts/validate-llms.js`, modelled on the existing `validate-sitemap.js`
(same explicit-map pattern, same pure-function + CLI shape, no new dependencies).

Checks: integration coverage · competitor coverage · blog-post coverage · link integrity
(no dead `/blog|/compare|/integrations` links for an assistant to follow) · a
`REQUIRED_TOPICS` map (channels/features that must be described — shipping a channel forces
a decision here) · an **unverifiable-metric guard** that fails on `N% accuracy` /
`N real-world scenarios`, so the exact claim removed in §3 cannot be reintroduced · and a
**self-consistency check** requiring each tracked fact to read identically everywhere it
appears, within a file and across both.

**The self-consistency check was added after review, and it was needed.** The first cut of
this validator banned unverifiable metrics but never checked *agreement* — and shipped a
fresh instance of the original bug: `llms-full.txt` said "(iOS in progress)" on line 16 and
"(iOS coming soon)" on line 154. The check caught it immediately on being written. Writing
it also surfaced a false positive worth recording: "6 Arabic dialect families" and
"6 dialect families" state the same fact, so patterns may use a capture group to isolate the
fact from its phrasing. A gate that cries wolf gets switched off.

Both iOS claims were then removed rather than reconciled — iOS has not shipped, and a
forward-looking availability claim in a file assistants quote verbatim is the same defect
class as the accuracy metric removed in §3.

**The validator has its own tests** — `frontend/scripts/__tests__/validate-llms.test.mjs`,
16 cases run by `npm run llms:validate:test` (`node --test`, following the existing
`scripts/__tests__/check-duplication.test.mjs` precedent). Every check is pinned in *both*
directions: passing on good input and failing on the specific defect it exists to catch. A
check that only ever passes is indistinguishable from one that does nothing. `pre-deploy`
runs these tests before trusting the gate.

Writing the tests also exposed a real weakness: `REQUIRED_TOPICS` was matching against the
raw file, so a topic could be reported as "covered" purely because a blog *slug* contained
the word (`/blog/whatsapp-auto-reply-jawab24`). It now matches against prose with URLs
stripped — a link is not a description.

Wired into `frontend/package.json` as `llms:validate` and into
`scripts/pre-deploy-check.sh` (step 0.57) so it gates deploys like the sitemap check.

Shared helper `slugsFromDataFile` was extracted to `frontend/scripts/lib/dataSlugs.js` and is
now required by both validators rather than duplicated (§10.8).

**The gate paid for itself immediately** — on first run it failed, catching that
`llms-full.txt` linked the Zid integration page but not Shopify's or Salla's.

---

## 5. Fixed: robots.txt AI-crawler groups did not inherit the auth-gated exclusions

A named `User-agent` group **fully replaces** `User-agent: *` — directives are not merged.
Each of the seven AI-crawler blocks carried only `Allow: /`, so GPTBot, ClaudeBot,
PerplexityBot et al. were free to spend crawl budget on `/dashboard`, `/settings`,
`/messages` — routes that can only render a login wall. Not a disclosure risk (auth is
enforced server-side), but a wasteful and misleading signal.

**Action taken:** every AI-crawler group now repeats the same `Disallow` set as `*`.
`Google-Extended`, `meta-externalagent`, and `CCBot` added explicitly. Noted honestly in the
file: unnamed crawlers already inherit `Allow: /` from `*`, so naming them changes nothing
functionally — it makes the file auditable.

---

## 6. Added: IndexNow

Bing is the retrieval index behind ChatGPT search and Copilot; a page Bing has not crawled is
structurally invisible to those assistants regardless of markup quality. IndexNow is the
standard, no-account way to push URLs at that index on deploy.

- Public key file: `frontend/public/7af41c595343ef134170a2de37da0079.txt`
  (public by protocol design — it *is* the ownership proof; not a secret)
- `scripts/indexnow-ping.sh` — reads the live sitemap, filters to URLs whose `<lastmod>`
  falls inside a window (default 30 days, `INDEXNOW_WINDOW_DAYS`; `--all` forces a full
  submission for the very first ping), keeps only on-host URLs, verifies the key file
  resolves before submitting, POSTs the URL list, and maps each IndexNow status code to a
  specific message. **Always exits 0** — a failed ping must never fail a deploy.
- Called from `scripts/deploy-on-server.sh` after `post_deploy_check` succeeds.
- `post_deploy_check` also asserts the key file returns 200 and says so loudly if not.
  Without that, a key stripped from the frontend image would disable Bing submission
  permanently while the ping's own guard warned quietly into a log nobody reads.

Change-scoped by design: IndexNow is specified for URLs that *changed*, and resubmitting the
whole sitemap on every deploy — including deploys touching no public content — is what the
429 response exists to punish. Verified: a 1-day window reports nothing to submit, a 15-day
window picks up the late-July pages.

Verified locally: 72 URLs extracted, payload parses as valid JSON, all URLs on-host, and the
key-file guard correctly skipped submission while the key is undeployed. One portability bug
was caught and fixed in testing — `s|</\?loc>||g` uses a GNU-sed extension that silently
no-ops on BSD/macOS sed, leaving XML tags in the URLs (IndexNow 422).

---

## 7. Fixed: Zid missing from the entity page and site schema

`/integrations/zid` ships and Zid is in `integrations.ts`, but the `about` namespace had zero
Zid mentions in **both** locales, and `_document.tsx`'s `SoftwareApplication` omitted it.
Added `platforms.zid` (EN + AR, فصحى), included it in the rendered platform list and the
intro paragraph, and added Zid, voice/photo understanding, and Business Info to the schema
`featureList`, `description`, and `keywords`.

---

## 8. Still open — owner-manual (requires your logins)

### 8.1 Bing Webmaster Tools (~10 min) — highest-leverage item here
Open since May. Bing feeds ChatGPT search and Copilot.
- Verify `jawab24.com` (one-click import from Google Search Console).
- Submit `https://jawab24.com/sitemap.xml`.
- After the next deploy, confirm the IndexNow submissions appear under **URL Submission**.

### 8.2 Google Search Console — remove French legacy URLs (~15 min)
The 410 rules are live (`nginx/nginx.conf:161-211`) but Google still indexes the old French
pages, which dilutes the domain's topical identity. Prefix list is in
`SEO_ACTIONS_2026-07-10.md` §1 — **the `www.` variants matter**.

### 8.3 GSC pulse check (~10 min)
Pull last-28-days CTR/position for `/en/blog/salla-vs-shopify-arabic-sellers` and
`/en/blog/best-auto-reply-tools-2026`. The `seoTitle` rewrites landed July 10, mid-way
through the reports' 90-day window, so the quoted 0.19% / 0.08% blends before and after.
Needed before spending anything more on CTR. Also re-check the
"Discovered – currently not indexed" list (was 8) and paste the URLs — internal links can
then be added from high-authority pages.

### 8.4 Rich Results re-test (~5 min, after deploy)
Run https://search.google.com/test/rich-results on `/` and `/pricing`. Confirm
`SoftwareApplication` parses with **no AggregateRating warnings**.

---

## 9. Measurement — replace estimates with observables

The reports scored AI visibility as percentages (Claude 0%, ChatGPT 5%, Perplexity 15%,
Gemini 20%) that were never measured, then set success criteria against them. Two things
that are actually observable should be used instead:

1. **AI-crawler reach, from production nginx access logs.** Weekly hit counts for `GPTBot`,
   `ClaudeBot`, `PerplexityBot`, `OAI-SearchBot`, `ChatGPT-User`, `CCBot` — and which paths
   they fetch. This directly answers "do AI tools fetch us", with no estimation. Capture a
   baseline before this change deploys so the llms.txt refresh has a before/after.

   > **2026-08-22: this baseline was never captured, and it cannot be.** nginx logs to
   > docker's `json-file` driver with `max-size: 10m, max-file: 3` — roughly two days of
   > traffic — and the whole buffer is discarded on every `--force-recreate` (the last one
   > was 2026-08-20). There is no weekly window to count. See
   > `SEO_ACTIONS_2026-08-22.md` §1 for the ~40 hours that did survive, and §C there for
   > the retention fix this needs.
2. **Index coverage**, from GSC and (after §8.1) Bing Webmaster Tools: indexed page count,
   the discovered-not-indexed list, and position/CTR on tracked queries.

---

## 10. Why technical SEO alone will not produce AI mentions

Recorded here because it drives prioritisation and was the question the reports never
answered. Technical SEO makes the site **retrievable**; it does not make it **recommended**.

Asked "what's the best auto-reply tool", an assistant either answers from training weights
(Jawab24 is small and recent — nothing learned), or searches and summarises the top results
(it reads *the listicles*, never fetching jawab24.com — so schema, hreflang and llms.txt have
no bearing), or fetches jawab24.com directly (only when already named — the case that already
performs well).

For the "best tool" query class the vendor's own domain is also the least credible source
available, and the set of sources asserting Jawab24 exists is currently just jawab24.com.

So: §3–§7 raise **accuracy and retrievability**. §8.1 is the one real **frequency** lever.
Only third-party corroboration moves the "best tool" class, and it is slow. The winnable
near-term target is the thin long-tail — `Salla auto reply`, `رد تلقائي زد`,
`واتساب رد تلقائي متجر` — where the integration pages are plausibly the best answer that
exists. Not "best auto reply tool", which loses to ManyChat for years.

**Corroboration should target the Arabic ecosystem** — Salla and Zid app stores, the Meta
Business Partner directory (already a partner; claim the listing), Arabic SaaS directories,
and the existing Google Play listing — not G2 / Capterra / Product Hunt, which serve Western
B2B buyers. Note: the Salla store listing is blocked on Salla Partners ID verification
(rejected a third time on Aug 7); Zid is already submitted.
