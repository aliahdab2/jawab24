# SEO / GEO Actions — August 22, 2026

*Follow-up to `SEO_ACTIONS_2026-08-07.md`. That document closed the on-page technical pass
(schema, hreflang, the llms.txt gate, robots, IndexNow) — it is not re-audited here.*

This study looked only at what the August 7 pass could not measure or did not cover: what
AI assistants and crawlers **actually fetch** from jawab24.com, what the **live Arabic
search results** look like for the long-tail queries that document named as the winnable
target, and the **shape of the content** from a GEO (generative-engine) standpoint. Every
claim below was verified against production (`curl`, the nginx log over SSH, live web
searches) and the code — not against a previous audit.

**Shipped in this PR:** §A (freshness dates + generated sitemap). Everything else is
recorded with its evidence and left open, in priority order, in §B–§D.

---

## 1. What was measured (live, 2026-08-22)

### 1.1 ChatGPT already cites us — but only the English pages

The nginx container was recreated on 2026-08-20, so roughly 40 hours of access log survived.
In that window:

| User-agent | Hits | What it fetched |
|---|---|---|
| `ChatGPT-User` (fetch on behalf of a user mid-chat) | **59** | `/en/blog/salla-vs-shopify-arabic-sellers` ×20, `/` ×18, `/en/blog/best-auto-reply-tools-2026` ×11, `/en/blog/instagram-facebook-dm-selling-statistics-2026` ×5, `/blog/instagram-auto-reply-guide` ×2 |
| `OAI-SearchBot` | 24 | `robots.txt` ×10, then `/what-is-jawab24`, `/en/trust`, `/en/compare/manychat`, six EN posts |
| `PerplexityBot` | 13 | `robots.txt` ×4, six EN posts, two `/api/og` images |
| `GPTBot` (training) | 1 | — |
| `ClaudeBot` | 0 | — |
| `bingbot` / `Googlebot` | 306 / 166 | normal crawl |

Two things follow. First, the English blog is already being used as a source inside ChatGPT
answers — the August 7 prediction that "assistants never fetch jawab24.com" was wrong for the
English long-tail. Second, the **only Arabic page** an assistant fetched on a user's behalf
was `/blog/instagram-auto-reply-guide` (twice). The buyers are Arabic-speaking; the citations
are English.

### 1.2 The Arabic long-tail is still empty of Jawab24

Live searches, top results:

| Query | Who wins | Jawab24 |
|---|---|---|
| «رد تلقائي زد» | `help.zid.sa` (Zid's own WhatsApp auto-reply help page), generic WhatsApp guides | absent |
| «رد تلقائي سلة» | `thikaa.com` (a Salla WhatsApp chatbot), `katheeb.net`, generic | absent |
| «رد تلقائي واتساب للمتاجر» | **`raddad.io`** (the Zid competitor) with a 4,500-word, dated, FAQ-bearing Arabic guide; `mottasl.com`, `businesschat.io`, `social-bot.io` | absent |
| "Salla auto reply Facebook Instagram" (EN) | `salla.com` chat, then **`jawab24.com/en` #2**, `/en/blog/best-auto-reply-tools-2026` #5, the Play listing | present |
| `"jawab24" OR "جواب24"` excluding our domain | the Google Play listing, then Persian noise (`javab24.com`) | Play only |

English is won; Arabic is not; third-party corroboration is still zero (unchanged since
August 7). The competitor that ranks for the WhatsApp-for-stores query does it with exactly
the content shape GEO rewards: a dated comprehensive guide with a definition up front and a
13-question FAQ.

### 1.3 There is no public WhatsApp page

WhatsApp went GA on 2026-07-26, is a `REQUIRED_TOPIC` in the llms gate, and is in the landing
`<title>` — yet `src/data/integrations.ts` lists only Shopify, Salla and Zid, and the only
WhatsApp URL on the site is the launch post `/blog/whatsapp-auto-reply-jawab24`, whose H1
(«واتساب متاح الآن في جواب24») is a news headline, not something anyone searches for.
`/instagram` (#790) is the pattern that does exist for a channel page.

### 1.4 Freshness signals were dead across the whole public site — fixed in §A

- `frontend/public/sitemap.xml` was hand-typed. A `<lastmod>` only changed when a URL was
  *added* (last three commits: trust page, Instagram page, security post). The five comparison
  pages re-verified on 2026-08-14 (#751) still said `2026-03-08` / `2026-03-17`;
  `best-auto-reply-tools-2026`, rewritten the same day, still said `2026-03-18`.
- `scripts/indexnow-ping.sh` submits only URLs whose `<lastmod>` falls inside a 30-day
  window — so **a changed page was never pushed to Bing**, which is the index behind ChatGPT
  search and Copilot. The IndexNow plumbing from August 7 was correct and had nothing to send.
- `blog/[slug].tsx` emitted `dateModified: post.date` — every post told Google it had never
  been modified. `BlogPost` had no modified field. Comparison and integration pages emitted no
  date at all, and no public page showed a reader «آخر تحديث» except the legal pages and
  `/trust`.
- `validate-sitemap.js` checked `lastmod` for format and not-in-the-future only.

### 1.5 AI-crawler reach cannot be measured (the §9.1 baseline from August 7)

nginx logs to docker's `json-file` driver, `max-size: 10m × max-file: 3` — about two days —
and the buffer is discarded on every `--force-recreate`. There is no week to count.

### 1.6 Bing still crawls French legacy slugs that escape the 410 rules

`/villes-…`, `/taux-…`, `/quest-ce-…`, `/pays-…`, `/garder-…`, `/nutrition-…`,
`/laustralie-…` answer 308 → 404 instead of 410: rule #2 in `nginx/nginx.conf` is a
prefix allow-list and these prefixes are not on it. `/sitemap_index.xml` (Yoast legacy)
returns 404 and bingbot asked for it twice in the window.

### 1.7 robots.txt drift

`/trust` and `/instagram` are in the sitemap but not in the enumerated `Allow` list
(harmless — `Allow: /` covers them). `Disallow` omits auth-walled routes that
`validate-sitemap.js`'s `EXCLUDED_ROUTES` already knows — `business`, `catalog`, `leads`,
`team`, `ecommerce-analytics`, `admin/*`, `checkout`, `complete-profile`, `*/onboarding`,
`zid/embedded` — and the block is duplicated verbatim across 11 user-agent groups.

### 1.8 Content shape (GEO)

- Integration pages open with «Jawab24 لـ زد» and an imperative paragraph («اربط متجر زد…»);
  nothing above the fold says *what Jawab24 is*. The only self-contained definition sentence
  on the site is on `/what-is-jawab24`.
- Their meta descriptions say Facebook/Instagram only — no WhatsApp, which is the channel Zid
  and Salla merchants actually search for (§1.2).
- The landing AR meta description says «يتكامل مع شوبيفاي وسلة» (no Zid) and
  «أذكى من بوتات الرد التلقائي»; two AR blog H1s say «ببوت رد تلقائي».
- `/instagram` is the best-targeted AR page («الرد التلقائي على رسائل إنستغرام وتعليقاته»),
  but uses the spelling «إنستغرام» only — «انستقرام» / «انستجرام» are the common query forms.

### 1.9 The Google Play listing

The one third-party page Google has for the brand is titled **"Jawab: AI Auto-Reply
Assistant"** — not Jawab24, so it binds to a different entity name — mentions WhatsApp, Salla
and Shopify but **not Zid**, and its public release notes read "Thanks for testing Jawab —
please report any issues you run into".

### Verified fine — do not re-audit

llms gate green (18 posts, 9 required topics, 5 tracked facts); IndexNow key served (200);
all AI user-agent groups present in robots.txt; `FAQPage` on six surfaces; JSON-LD identical
across AR/EN; the uptime window pinned by `test/pages/trust.test.tsx`.

---

## A. Shipped: content dates + generated sitemap

**Data.** `src/data/contentDates.ts` defines `date` (first published) and `updated` (last
*substantive* revision — facts re-verified, a section added, a claim corrected; never bumped
for link fixes or terminology sweeps). `BlogPost`, `Competitor` and `Integration` extend it.
Seeded from the commit history, judged per commit subject:

| Page | `date` | `updated` | Why |
|---|---|---|---|
| all five `/compare/*` | Mar/May | **2026-08-14** | #751 re-verified every competitor |
| `best-auto-reply-tools-2026` | 03-18 | **2026-08-14** | same re-verification |
| `whatsapp-auto-reply-jawab24` | 07-09 | 2026-08-08 | teaser → GA announcement, Zid added |
| `jawab24-setup-tutorial` | 03-18 | 2026-07-31 | illustrated with screenshots |
| `turn-comments-into-sales` | 05-20 | 2026-07-29 | WhatsApp added |
| `auto-reply-facebook-setup-guide` | 03-18 | 2026-07-08 | comment modes clarified |
| `instagram-auto-reply-guide` | 03-18 | 2026-04-03 | voice/Instagram content added |
| `/integrations/*` | Mar | — | every commit since was a terminology or link sweep |

**Pages.** `blog/[slug].tsx` now emits `dateModified` / `article:modified_time` from
`updated ?? date` and shows «آخر تحديث …» beside the publish date when a post was revised.
Comparison and integration pages emit `datePublished` / `dateModified` in their `WebPage`
JSON-LD and show the line under the hero. One `common.lastUpdatedOn` key, فصحى. The date
formatter is the existing `formatPlainDate` (UTC-midnight-safe, Gregorian forced) with a new
`alwaysYear` option; the two hand-rolled `toLocaleDateString` copies in the blog were replaced
by it. `getIntlLocale` moved to `utils/locale.ts` (re-exported from `i18n/hooks`) so public
pages can format a date without pulling the app store into their bundle.

**Sitemap.** `scripts/generate-sitemap.js` is now the single source of `public/sitemap.xml`:
static pages from a `STATIC_PAGES` table (hand-dated, bump when content changes), every
blog / compare / integration URL from its data module's `updated ?? date`, and the blog index
dated by its newest post. `validate-sitemap.js` gained check 7 — a data-driven `<lastmod>`
that disagrees with the data module fails — and `npm run sitemap:validate` runs
`generate-sitemap.js --check` first, so a stale committed file fails both `npm test` and the
pre-deploy gate (step 0.55). The same `dataSlugs.js` helper both validators already shared
now parses the dates too.

Net effect on the first deploy: 17 AR URLs (and their EN twins) change `<lastmod>`, the five
comparison pages and the money post move inside IndexNow's window, and the blog index goes
from `2026-03-21` to `2026-08-14`. Three integration pages move *backwards* (05-30 → March):
the old date was invented, the new one is when they were published.

**Tests.** `test/scripts/generate-sitemap.test.ts` (committed file == generated file; field
extraction; `updated` precedence; blog-index max; fails on an undated or backwards entry),
`test/scripts/validate-sitemap.test.ts` (check 7 fires on a backdated compare page and on
the EN twin, and stays silent on static pages), `test/pages/contentDates.test.tsx` (the
three page types, with and without `updated`), `formatPlainDate.test.ts` (`alwaysYear`).

---

## B. Open — Arabic long-tail content (needs owner sign-off on copy)

1. **A public `/whatsapp` page**, cloned from `/instagram` (#790): page + `whatsapp.json`
   ar/en + `FAQPage` + sitemap static entry + robots + an llms.txt link. AR title/H1 literally
   «الرد التلقائي على واتساب للمتاجر — جواب24»; a definition sentence first; an FAQ that
   answers what `help.zid.sa` currently wins («هل يرد على واتساب متجري في زد/سلة؟»).
2. Integration pages: a definition sentence before the hero subtitle; add واتساب to the
   AR/EN meta descriptions (true since 07-26); consider an H1 of the form
   «الرد التلقائي لمتاجر زد — جواب24».
3. Landing AR meta description: add زد, drop «بوتات». The two «ببوت رد تلقائي» blog H1s →
   «برد تلقائي ذكي».
4. `/instagram`: mention the «انستقرام» spelling once in body copy.

## C. Open — infrastructure (small, code)

1. **Log retention**, so §1.5 becomes measurable: nginx service logging `max-size: 50m`,
   `max-file: 14` in `docker-compose.yml`, plus a weekly `scripts/ai-crawler-report.sh`
   (user-agent → hits, paths, status) appended to `/var/log/jawab24-crawlers.log` from the
   existing backup cron. Without it the effect of §A and §B can never be shown.
2. `nginx/nginx.conf`: a catch-all for legacy WordPress slugs — hyphenated single-segment
   path with a trailing slash, excluding current single-segment routes — → 410;
   `/sitemap_index.xml` → 410.
3. `robots.txt`: add the missing `Disallow`s once, and a check in `validate-sitemap.js` that
   every auth-gated `EXCLUDED_ROUTES` entry is disallowed in every user-agent group.

## D. Open — owner-manual (no code)

1. **Play Console**: rename the listing to "Jawab24 …", add Zid to the description, replace
   the "testing" release notes on the production track.
2. **Bing Webmaster Tools** and the **GSC French-URL removals** — still open from the
   August 7 list (confirmed 2026-08-22). With §A deployed, IndexNow will now actually have
   changed URLs to submit; Bing WMT is where you see whether it accepted them.
3. Third-party corroboration in the Arabic ecosystem — the Zid app store (in review), the
   Salla listing (blocked on video/pricing), the Meta partner directory — remains the only
   lever for the «أفضل رد تلقائي» query class. §A and §B make the pages worth citing; they do
   not make anyone cite them.
