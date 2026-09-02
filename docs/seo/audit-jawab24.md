# SEO Audit — jawab24.com

*Date: 2026-05-30 · Scope: on-page, technical, content, and search visibility. Based on live page fetches, SERP checks, and live Google Search Console data (property: jawab24.com, last 90 days). Bing Webmaster Tools not yet reviewed.*

## Verdict

On-page and technical SEO are **genuinely strong — top 10% for an early-stage SaaS site**. The limiting factor is **off-page authority (backlinks/domain age) plus a click-through-rate problem**, not your markup. GSC confirms it: you earned **12.4k impressions but only 121 clicks (1% CTR) at an average position of 7.2** over the last 90 days. Translation — Google *is* showing your pages, but they sit just below the top results and the snippets aren't pulling clicks. Fixing rankings (authority) and titles/snippets (CTR) is where the traffic is.

## Google Search Console — real data (last 90 days)

| Metric | Value | Read |
|---|---|---|
| Clicks | 121 | Low, but real |
| Impressions | 12,400 | Healthy visibility for a new site |
| Avg CTR | 1% | **The problem** — far below the ~3–5% you'd expect at position 7 |
| Avg position | 7.2 | Bottom of page 1 / top of page 2 — close, not there |
| Indexed pages | 47 | Good coverage |
| Not indexed | 14 | 8 are "Discovered – currently not indexed" (see below) |
| Core Web Vitals | No data | Too little real-user traffic for field data yet — not a defect |
| FAQ rich results | **7 valid** | FAQPage schema is working |
| Review snippets | **0** | Missing — opportunity (you display 4.8/5) |

**Two English blog posts are impression goldmines bleeding clicks:**
- `/en/blog/salla-vs-shopify-arabic-sellers` — **4,190 impressions, 8 clicks (0.19% CTR)**
- `/en/blog/best-auto-reply-tools-2026` — **2,407 impressions, 2 clicks (0.08% CTR)**

These already rank (mid-page) for high-volume queries. Getting them onto page-1-top + rewriting their titles/meta to be more clickable is your single biggest near-term traffic lever — the demand is already there.

**Top queries:** "jawab24" (28 clicks / 33 impr — 85% CTR, branded, converts great but tiny volume); "jawab" (0 / 137) and "جواب" (0 / 67) — you appear but rank too low for these generic terms; plus tangential queries like "mobile app development" (51 impr) and "معنى reply في الانستقرام" (31) where blog content pulls off-target impressions that won't convert.

**Indexing:** 8 pages are **"Discovered – currently not indexed"** — Google found them but hasn't prioritized crawling/indexing them. This is the classic low-authority-new-domain signal and ties directly to the backlinks gap below. Also worth a quick cleanup: 2× 404s and 2× redirect pages flagged.

## What's working well

**Per-page metadata is excellent.** Every page has a unique, keyword-rich, localized `<title>` and `meta description` — homepage, `/en`, `/pricing`, `/compare/*`, and blog posts all differ appropriately. Canonicals are correct and self-referencing on each page.

**Bilingual setup.** Arabic (root) + English (`/en`) with `og:locale` + `og:locale:alternate`. Full Open Graph and Twitter card coverage with 1200×630 images, plus dynamically generated OG images for blog posts (`/api/og`).

**Strong technical foundation (from your codebase rules).** SSR enforced on public pages, SEO regression tests in CI, and Lighthouse CI gating accessibility (≥90) and CLS (≤0.1). This means Google and Bing both get full server-rendered HTML — the single biggest technical SEO risk for a Next.js site is already closed.

**Programmatic / commercial-intent SEO.** Dedicated comparison pages (vs ManyChat, Tidio, Chatfuel, Botpress, Speedly) and integration pages (Shopify, Salla, Zid). These target exactly the high-purchase-intent queries ("Jawab24 vs ManyChat", "Salla auto reply"). This is sophisticated and most competitors don't do it.

**Content depth and authenticity.** Blog posts are substantial (8–10 min reads) with article metadata (`published_time`, `modified_time`, `author`, `section`), tables of contents, internal "related posts" linking, and authentic Arabic dialect writing — which matches how your audience actually searches and speaks. The Salla-vs-Shopify and "common mistakes" pieces are real, useful content, not thin SEO filler.

## Priority fixes (highest impact first)

**1. Build off-page authority — still your #1 gap, now confirmed by GSC.** 8 pages are "Discovered – currently not indexed" and you average position 7.2 — both are textbook low-link-equity symptoms. On-page is maxed out; the missing signal is backlinks and citations. Actions: get listed in the Shopify, Salla, and Zid app marketplaces (each is a high-authority backlink + referral traffic), submit to Arabic SaaS/startup directories, pursue guest posts and "best Facebook auto-reply tools" listicle inclusions, and earn Product Hunt / Meta Partner directory listings. More links → higher rankings on the queries where you already get thousands of impressions.

**2. Fix the CTR problem — fastest traffic win.** You have 12.4k impressions at 1% CTR. The pages ranking mid-page for high-volume queries (salla-vs-shopify, best-auto-reply-tools) need (a) a nudge up the rankings via internal links from your strongest pages, and (b) rewritten `<title>` and `meta description` that earn the click — front-load the benefit, add the year, add a number/result. Even lifting these two posts to 3% CTR roughly triples their traffic with zero new content.

**3. Add the missing structured data (FAQPage already works).** GSC confirms **7 valid FAQ rich results** — that markup is in place, good. What's missing:
- `AggregateRating` / `Review` — **0 detected**, yet you display "4.8/5 · 50+ businesses". Adding this is eligible for star ratings in SERPs, which directly lifts CTR (ties to #2).
- `SoftwareApplication` / `Product` with `offers` — your pricing tiers ($15/$39/$79).
- `Article` for blog posts (you already emit the `published_time`/`modified_time`/`author` meta to populate it).
- `BreadcrumbList` and `Organization`/`WebSite` (with `sameAs` to your Facebook/X) to help consolidate the brand.

**4. Fix the blog table-of-contents anchor bug.** On `/blog/turn-comments-into-sales`, every in-article TOC link collapses to `#-` — the Arabic headings aren't being slugified into valid IDs. This breaks on-page jump navigation and wastes the TOC's internal-linking value. Fix the heading→slug generation to transliterate or hash Arabic headings into unique anchors.

**4. Confirm real `hreflang` tags exist.** I can see `og:locale:alternate` but that is *not* hreflang. Verify `<link rel="alternate" hreflang="ar" .../>`, `hreflang="en"`, and `hreflang="x-default"` are emitted on every page pair (ar ↔ /en). Without these, Google may serve the wrong-language version or treat them as duplicates.

**5. Clean up indexing + check Bing.** In GSC, use "Validate fix" on the 2 404s and review the 2 redirect pages. For the 8 "Discovered – not indexed" pages, add internal links to them and request indexing — but the durable fix is authority (#1). Separately, **Bing Webmaster Tools** hasn't been reviewed yet — verify the property and submit your sitemap there (Bing also powers ChatGPT/Copilot search, increasingly relevant).

## Minor / housekeeping

- **`meta-keywords` tag** is present on most pages. Google and Bing both ignore it (and it can theoretically hand competitors your keyword list). Harmless but you can drop it.
- **Brand ambiguity.** "Jawab" is a crowded term — SERPs mix you with jawaban.com, jawabkom, jawabok, jawabteam. Consistently brand as "Jawab24" (one word) everywhere off-site to consolidate signals, and claim the Knowledge Panel via `Organization` schema + consistent NAP.
- **`og:locale` is `ar_SA`** while your content uses Levantine dialect. Fine if Saudi is the primary market; just be intentional — it's a small targeting signal.

## Still to check

- **Bing Webmaster Tools** — not yet reviewed. Verify the property, submit the sitemap, and compare its query/index data to Google's.
- **hreflang** — confirm real `<link rel="alternate" hreflang="ar"/"en"/"x-default">` tags exist in the rendered DOM (my fetcher strips `<link>` tags, so this is "verify," not confirmed-absent). `og:locale:alternate` alone is not hreflang.
- A deeper page-by-page CTR/position pull from GSC (filter by query + page) to prioritize exactly which titles to rewrite first.
