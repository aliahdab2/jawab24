# WhatsApp Marketing Launch — Staged Plan

> **Status: PARKED — merges at `docs/WHATSAPP_LAUNCH_RUNBOOK.md` Phase 5 (GA flip).**
> Created 2026-07-09. Owner: founder. Companion to [`WHATSAPP_PLAN.md`](./WHATSAPP_PLAN.md).
> Everything marketing-facing for the WhatsApp GA is staged in advance so launch day is
> ONE merge + ONE deploy. Nothing WhatsApp-related appears on public marketing surfaces
> before the GA flip (decision 2 below).

## Locked decisions (2026-07-09)

| # | Decision | Ruling |
|---|----------|--------|
| 1 | Packaging | **WhatsApp included in Business+**: `business`, `pro`, `scale-20k`, `scale-30k` → `whatsappEnabled: true`; `starter` stays FB+IG. **A $20/mo add-on ($39+$20) was considered and REJECTED**: no marginal cost basis (service-window replies are free; same ~$0.002 AI cost as FB/IG), $59 ≈ 221 SAR lands next to LetsBot's AI-bundle price and kills the "everything included, no add-ons" wedge, the reply quota already monetizes heavy usage via tier upgrades, and add-on billing is multi-day Stripe/entitlement work. A Business $39→$49 raise for new subs was offered and not taken. **Premium pricing is deferred to proactive commerce** (cart-recovery templates — measurable ROI). Don't re-open without new data. |
| 2 | Pre-GA visibility | Landing/pricing/SEO show **nothing** about WhatsApp until GA. No قريباً badge. |
| 3 | Blog | Teaser post published pre-GA (PR #426, slug `whatsapp-auto-reply-jawab24` — evergreen); flips to "now live" at GA. |
| 4 | Staging | All GA marketing rides branch `feat/whatsapp-ga-marketing` (draft PR, parked); runbook Phase 5 sequences the merge BEFORE the env flip. |
| 5 | EN copy audience | EN marketing copy targets **international merchants** — "replies in your customers' language", no region-locked framing. Arabic-first stays the AR-locale story and the brand differentiator, but EN must stand alone. (Founder direction 2026-07-09.) |

## Pricing validation (industry check 2026-07-09)

- **LetsBot**: Salla app 49/119 SAR (notifications only); full platform 24–863 SAR base + **AI bot is a +206 SAR/mo add-on** + 25 SAR Salla integration → AI-equipped ≈ 255+ SAR (~$68+). 40×5★ Salla reviews.
- **Wati** ~$49/mo + up-to-60% markup on Meta fees; **Interakt** ~$30 + ~12–15% markup; **Gallabox** ~$89.
- **Jawab24 Business $39 (~146 SAR)** with AI + 3 channels included → ~2× cheaper than the AI-inclusive competition. Prices confirmed good; no changes at GA.
- **Meta fees**: customer-initiated (service-window) replies are FREE — the whole current product. Only future business-initiated templates cost per delivered message, billed to the **merchant's own WABA**. Jawab24 adds no markup.

**Copy guardrails from this research:**
1. Headline angle: **"AI included in every plan — no add-ons"** (LetsBot charges +206 SAR for AI; Wati marks up Meta fees).
2. Avoid raw-message-quota comparisons — we quota *AI replies* (1.5k/4.5k/10k), competitors quota notification blasts (30k–200k). Apples-to-oranges; don't invite it.
3. State plainly: no markup on Meta fees; replies to customers are free.

## Workstream tracker

| WS | What | Where | State |
|----|------|-------|-------|
| A | Teaser blog post AR+EN + sitemap | `blog/whatsapp-teaser` → **PR #426** | ✅ Open, publishes on merge |
| B | GA marketing branch (see contract below) | `feat/whatsapp-ga-marketing` (draft PR) | ⬜ In progress |
| C | Runbook Phase 5 additions | `docs/whatsapp-marketing-launch` (this PR) | ✅ |
| D | This doc | same PR as C | ✅ |
| — | Post-GA Tier-3 copy sweep | follow-up PR | ⬜ Not started |

## WS-B branch contract (`feat/whatsapp-ga-marketing`)

Commit sequence (keep — reviewers rely on it):
1. `feat(plans): enable WhatsApp on Business+ and enforce it at connect` — plans.ts flip; `hasWhatsAppPlan(workspaceOwnerId)` gate in `controllers/whatsapp.ts` (`connect`, `connectNew`, `toggleAutoReply` enable path) → 403 `WHATSAPP_PLAN_REQUIRED`; backend tests; `pages.tsx` error branch + `pages.json` key. **This closes a real gap: main has NO plan-level WhatsApp enforcement — only the allowlist.**
2. `feat(pricing): show WhatsApp on Business+ plan cards` — conditional channel subtext + always-rendered WhatsApp FeatureRow (`included={plan.whatsappEnabled}`, crossed-out on Starter); `fallbackPlans.ts`; `scale.test.tsx`; pricing SEO copy; Meta-fees FAQ item.
3. `feat(landing): WhatsApp chip, bubble, hero + SEO + FAQ copy` — `.landing-platform-chip-whatsapp` (light text `#128C7E` for WCAG, `dark:text-[#25D366]`); chip + floating bubble in `LandingHero.tsx`; `landing.json` sweep incl. `faq.q1/a1` stating Business+.
4. `chore(i18n): WhatsApp copy sweep (Tier 1+2)` — `meta.json`, `about.json` + `what-is-jawab24.tsx` JSON-LD, `blog.json`, `help.json`, `contact.json`.
5. `feat(blog): flip teaser to "now live"` — content only; NO sitemap lastmod change (future date fails the validator while parked).
6. `docs: status sync` — `SYSTEM_ANALYSIS.md`, `.planning/codebase/INTEGRATIONS.md`, `WHATSAPP_PLAN.md` header, this doc → EXECUTED.

**Rebase cadence:** after any main merge touching `frontend/src/i18n/`, `pricing.tsx`, `Landing*`, or `backend/src/config/plans.ts`; max staleness 3 days. Drift magnets are i18n JSONs — conflicts are copy-level.

**Merge-day-only actions (GA, runbook Phase 5):** bump sitemap `<lastmod>` for `/`, `/pricing`, `/blog/whatsapp-auto-reply-jawab24`; `npm run sitemap:validate`; merge BEFORE the env flip (ordering is load-bearing — see runbook).

## Copy inventory by tier

- **Tier 1 (in WS-B):** `landing.json`, `pricing.json`, `meta.json` (+ chips/rows/CSS).
- **Tier 2 (in WS-B):** `about.json` + `what-is-jawab24.tsx` JSON-LD, `blog.json` index/authorBio, `help.json`, `contact.json`.
- **Tier 3 (post-GA PR, explicitly deferred):** `compare.json` per-competitor rows (Speedly entry = template; add LetsBot/Javna pages while at it), `ecommerce.json`, salla/zid/shopify `doneDesc`, `auth.json` AR tagline, `plans.json` AR descriptions, `CustomerBubble` FB icon, Starter upsell in channel picker.

## Honesty guardrails (D-014 family)

- No transact verbs ("sells", "closes sales") — recommend/answer/drive-to-purchase only.
- No broadcast/campaign/cart-recovery claims — templates (WHATSAPP_PLAN Phase 4) are NOT built.
- "Smart Reply" terminology, never "AI reply". Business Info naming per AI_INSTRUCTIONS §6.
- Meta-fee claims exactly as validated above — free service-window replies, merchant-billed templates later, no markup.

## Risks

| Risk | Mitigation |
|------|------------|
| Meta rejects the review | Teaser is honest (no date) — soft edit; WS-B stays parked at zero cost |
| Allowlist cleared without WS-B merged → Starter connects | Runbook Phase 5 sequences merge BEFORE env flip; plan gate is Commit 1 |
| Parked-branch drift | Rebase cadence + draft-PR CI |
| Chip contrast fails Lighthouse a11y ≥0.9 | `#128C7E` light-mode text; local Lighthouse pre-push |
| Future-dated sitemap lastmod fails CI while parked | lastmod changes are merge-day-only |

## Non-goals

No pre-GA landing mention; no WhatsApp on Starter (crossed-out row only); no broadcasts; no new plan slugs; no checkout changes; no price changes; no edits to the 3 older posts that mention WhatsApp.
