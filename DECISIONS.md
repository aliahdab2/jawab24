# Decisions Log

Append-only record of settled rulings, so they don't get re-litigated across sessions.

**Rules of this file**
- Append only. Never edit a past entry's reasoning; if a decision is reversed, add a new entry and mark the old one `Superseded by D-NNN`.
- One ruling per entry. Keep the *why* to a line or two — enough that a future session doesn't re-derive it.
- This holds **settled rulings**, not open work. Open/parked tasks live elsewhere (auto-memory "Parked Work" / `.planning/`).
- Conventions already enforced by `AI_INSTRUCTIONS.md` (commit style, RTL, i18n, etc.) do **not** belong here — only decisions that keep getting re-opened.

---

## D-001 · gpt-4.1-mini is the primary reply model
**Decided:** 2026-05-23 · **Status:** Active
gpt-4.1-mini stays the default reply model (~96% eval pass). Gemini 2.5 Flash is evaluated **only** for a possible classification layer — never as the primary reply model. If robotic replies reappear, suspect a silent model override, not a prompt regression: verify with `SELECT ai_model FROM settings`.
**Why:** A silent drift to gpt-4o-mini caused robotic replies; mini is the validated default. Re-deciding the primary model wastes eval cycles.

## D-002 · Salla & Zid App Store submissions are deferred (not abandoned)
**Decided:** 2026-06 · **Status:** Active (deferred)
Listing in the Salla and Zid app stores is acknowledged as the **highest-leverage distribution action**, and is **intentionally deferred** behind launch-readiness work — not dropped, not under-valued. Stop re-deriving "we should list on Salla/Zid" as if it were a new insight.
**Why:** The leverage is already understood and agreed; what gates it is readiness (Salla ~70%, Zid rebuild pending), not a missing decision. Re-litigating the priority each session burns planning time.

## D-003 · Double-encoding storage bug is low priority
**Decided:** 2026-06 · **Status:** Active
The Drizzle + postgres.js double-encoding storage issue is **low priority**, after confirming **zero runtime impact**. Do not escalate or rewrite storage handling for it without new evidence of an actual runtime symptom.
**Why:** Confirmed cosmetic/at-rest only; no user-facing or correctness effect. Re-opening it as a "bug to fix now" misallocates effort.

## D-004 · Order-status tools kept; product-search tools were dead code
**Decided:** 2026-06 · **Status:** Active
The 5 order-status tools are fully built and are the supported e-commerce tool surface. The product-search tools were **dead code** and are not part of the product — do not resurrect them as if they were a half-finished feature.
**Why:** Avoids re-investigating "why don't the product-search tools work" — they were never wired into the live pipeline by design.

## D-005 · Meta DM cart-recovery is blocked upstream — do not re-propose
**Decided:** 2026-06 · **Status:** Active (blocked, external)
Cart-recovery via Meta DM is **not buildable** because the required message tags were deprecated by Meta. This is an external platform constraint, not a backlog item. Don't re-scope it as upcoming work until Meta's policy changes.
**Why:** Repeatedly re-surfaced in e-commerce planning; the blocker is upstream and outside our control.

## D-006 · Stale-date defense is prompt-only (v39); the full guard was rejected
**Decided:** 2026-06 · **Status:** Active
The v38 full code-guard against stale dates was **reverted** (#314) because it over-deflected legitimate replies. The chosen approach is the **v39 prompt-only** mitigation. Do not re-attempt a hard code guard for stale dates without solving the over-deflection first.
**Why:** A path was already tried and rejected with evidence; re-implementing the guard would reintroduce the over-deflection regression.

## D-007 · Business facts split two lanes — operational facts in the always-on block, long-tail in RAG
**Decided:** 2026-06-26 · **Status:** Active
Operational facts (hours, phone, address, payment/booking/return/shipping policies) — a small bounded set — live in the deterministic, always-injected BUSINESS_INFO block. Long-tail facts (offerings, prices, durations, FAQs) live in `kb_facts` Tier-2 RAG. One store per fact type. Do not re-propose full-KB injection, nor "put everything (incl. hours/address) into RAG".
**Why:** Operational facts must answer reliably even on oblique phrasing — retrieval has a recall floor (tier-2 RAG missed an obliquely-phrased address); the always-on block has none. Long-tail is unbounded, so only retrieval scales at flat cost. Full-KB injection was rejected (ongoing token cost, user-confirmed). See [[project_business_facts_convergence]].

## D-008 · Provenance precedence editor > kb_extract > fb_sync; Facebook never overrides the merchant's own info
**Decided:** 2026-06-26 · **Status:** Active
The authoritative BUSINESS_INFO block carries only merchant-authored fields (provenance `editor` or `kb_extract`, or legacy rows with no provenance map). Unconfirmed Facebook-synced fields (`fb_sync`) are demoted to the lower-authority narrative fallback — Facebook is a low-trust SEED that fills gaps but never overrides, promotable to `editor` by one-tap confirm. Genuinely-absent fields stay `[NOT_PROVIDED]`. Don't re-debate "should the FB value win".
**Why:** The reported prod bug was unconfirmed FB hours/phone shown as authoritative, overriding the merchant's KB. The provenance gate is the settled fix (deterministically unit-tested). See [[project_kb_hours_phone_overridden_by_fb]].

## D-009 · Prices live only in the RAG lane, never in the authoritative BUSINESS_INFO block
**Decided:** 2026-06-26 · **Status:** Active
Price facts flow through `kb_facts` → RAG chunks only; never add a price field to the always-on BUSINESS_INFO block.
**Why:** The deterministic price-hallucination guard (`replyValidator.ts` via `getKBText`) reads retrieved chunks ∪ KB ∪ post ∪ store-policies but NOT the BUSINESS_INFO block — a price placed in the block would bypass the guard and could surface ungrounded.

## D-010 · Facebook never STATES an operational fact — KB is the only source; tightens D-008
**Decided:** 2026-06-26 · **Status:** Active
Extends D-008 from "Facebook never *overrides* the KB" to "Facebook never *states* an operational fact (hours, phone, address, contact channels) at all." Three coupled changes: (1) the BUSINESS_INFO gate demotes not just `fb_sync` but also `editor` + `confirmedAt: null` — an unconfirmed entry a real save never produces (it's only the `normalizeLegacyProvenance` auto-stamp, which mislabels FB-synced-into-flat data as `editor`); (2) `formatBusinessProfile` (the narrative KB fallback) emits ONLY descriptive fields (business type, about, website) — operational facts are removed, so demoted/unconfirmed FB values no longer leak in as a "fallback"; (3) `applyKbExtractToMerchant` may overwrite `fb_sync` AND unconfirmed-`editor` (only a CONFIRMED editor edit is protected), and `applyFbSyncToMerchant` no longer clobbers `kb_extract`, so the merchant's KB hours land in the block and stay. Net: KB has the fact → answered from KB (deterministic); KB silent → deflect, never Facebook. The tradeoff (a merchant with correct FB hours but none in Business Info now deflects) is accepted — wrong hours send a customer to a closed business; a deflection doesn't. Realizing (3) on existing pages needs the on-save extraction (`KB_OPFACTS_EXTRACT`) enabled or a one-off backfill; (1)+(2) fix the override on deploy without it.
**Why:** Prod page 39aeab89 (الفريق الدمشقي): `merchant` byte-identical to the FB `suggestions` half (Friday `00:00-23:45` = FB "open all day"), all fields stamped `editor`/`confirmedAt:null`, so D-008's `fb_sync`-only gate missed it and the bot answered Facebook's wrong hours ~half the time (coin-flip between the authoritative block and the KB free-text). Don't re-debate whether Facebook operational facts should ever be stated. See [[project_kb_hours_phone_overridden_by_fb]].

## D-011 · AI cost visibility is one panel (`/admin/ai-cost`) backed by the OpenAI Costs API; observability stays ops-only
**Decided:** 2026-07-01 · **Status:** Active
The admin "AI Cost & Quota" panel is the single home for all cost/quota visibility. Settled design (don't re-open): (1) **authoritative billing = OpenAI org Costs API**, pulled by a daily backend cron behind an admin key (`OPENAI_ADMIN_API_KEY`) — a backend secret, never sent to the client; a project key can't read `/v1/organization/*`. (2) **Runway/burn uses the org total across ALL keys**, never prod-only `ai_usage_log` — both prod and eval/dev keys drain one OpenAI wallet, so prod-only would under-count and mis-time a low-balance warning. (3) **Dedicated tables** `ai_cost_snapshots` (idempotent daily upsert, trailing re-fetch) + single-row `ai_credit_balance` anchor — do NOT overload `settings`. (4) **Proactive alerts use their own Redis SET-NX dedup keys** (`alert:openai_credit_low`, `alert:openai_spend_spike`), SEPARATE from the reactive `alert:openai_quota_exhausted` — different signals, different cooldowns. (5) OpenAI **auto-recharge** (dashboard) is the primary outage fix; our alerts + runway are the backstop. (6) `/admin/observability` carries NO cost data — it's ops-only (health, funnel, cache, digests). Per-user/per-page cost stays on the customer-detail page; the panel is the platform-wide view.
**Why:** Built after the 2026-06-28 `insufficient_quota` outage broke all auto-replies with no early warning. Splitting cost across observability + the panel duplicated the same numbers (removed in #384). The org-total-not-prod-only rule is the load-bearing correctness constraint (a dedicated regression test guards it). PRs #381→#384. See [[project_admin_per_page_cost_accuracy]], [[project_openai_quota_outage]].

## D-012 · Salla Easy Mode ownership binding is DEFERRED until "OAuth-authorize-in-Easy-Mode" is confirmed; design is two-branch
**Decided:** 2026-07-01 · **Status:** Active (blocked on one external confirmation)
The Easy-Mode post-install *claim* — proving a logged-in Jawab24 user owns the `merchantId` whose token arrived via the `app.store.authorize` webhook — stays **DORMANT** (`SALLA_EASY_MODE_CLAIM_ENABLED` off → claim endpoints return 404) until we confirm ONE Salla behavior: **can a published Easy-Mode app initiate the standard OAuth authorize redirect (`accounts.salla.sa/oauth2/auth`) for identity verification?** This question bifurcates the design, so we do NOT build speculatively:
- **If YES** → reuse the existing shared `authCallback` (`ecommerceControllers.ts`): merchant connects via Salla OAuth, `fetchStoreInfo` returns the *proven* `merchantId`, match it to the pending Easy-Mode install and `finalizeClaim` with the webhook-pushed (authoritative, long-lived) token. Minimal, additive, Salla-only.
- **If NO** → the entire existing merchant-initiated connect flow (`connectStore`/`authRedirect`) is ALSO dead for the published app (same authorize URL), so OAuth cannot be the proof; fall back to owner-email match (Salla store email from `fetchStoreInfo` == verified Jawab24 account email) or Salla's app-entry signed context.
NEVER enable the flag with a body-`merchantId` claim path: trusting a client-supplied `merchantId` lets any logged-in user claim another merchant's store + token. `finalizeClaim`'s owner-conflict guard only blocks re-claiming an already-ACTIVE store — it is NOT an ownership proof.
**Exact question to send Salla:** *"For an app published on the Salla App Store in Easy Mode: after install the token is delivered via the `app.store.authorize` webhook. Can that same published app also initiate the standard OAuth authorize redirect (`https://accounts.salla.sa/oauth2/auth?...`) to obtain a short-lived token for identity verification (to confirm which merchant a logged-in user in our app controls), or is the authorize/redirect endpoint disabled once the app is in Easy Mode?"*
**Why:** Salla docs (docs.salla.dev/doc-421118) confirm the webhook token delivery but document NO verifiable post-install browser redirect for Easy Mode (only the OAuth User-Info endpoint reached via an authorize round-trip). The correct binding is therefore undetermined until that question is answered — and the feature is weeks off the critical path (e-commerce adoption is admin-gated by design pending the external Salla listing gates: ID verification, designer assets, review), so building against an unverified external behavior would risk full rework (Rule 12/14). The unsafe path is already closed (flag off → 404); there is no live risk to fix urgently. S2 token-receipt itself shipped in #365. See [[ecommerce-tools-adoption]], [[ecommerce-launch-readiness]].

## D-013 · Post Reply gains an any-comment trigger mode — per-post ONLY, guarded, with an invisible anti-runaway cap; no multi-rule, keyword cap stays 10
**Decided:** 2026-07-02 · **Status:** Active
Post Reply's per-post trigger has two modes (`trigger_type`): `keyword` (unchanged legacy behavior, ≤10 keywords → one reply) and `all` (fires on every comment). Settled boundaries — don't re-open without new evidence:
1. **Per-post only.** No page-level / "all posts" scope — that combination (any-comment × all posts) is the maximum-volume footgun and was built then deliberately removed this same day. A merchant enables any-comment consciously, one post at a time.
2. **No multiple rules per post.** Meta allows each commenter to trigger only ONE automation per post; ManyChat itself steers users to a single entry keyword that branches inside the DM. A rules-list UI adds precedence semantics + merchant complexity for a pattern the market leader discourages. Revisit only on a demand signal (support requests, or prod data showing merchants maxing 10 keywords).
3. **Keyword cap stays 10** (industry best practice is 5–10 variations). Raising it invites keyword-stuffing = an *unguarded* catch-all; the guarded catch-all is `all` mode.
4. **`all` mode is guarded before sending** (`evaluateAnyCommentGuard`): the shared structural skip rules (friend-tag / promo-URL / punctuation / spam patterns — reliable) plus a keyword-based complaint/refund guard (best-effort ONLY — it catches explicit wording, misses paraphrase/sarcasm). **Never promise complaint detection in UI copy**; the caution says spam + friend-tags only.
5. **"Unlimited post replies" (live pricing promise, all plans) means no monthly quota** — NOT literally uncapped: an invisible per-post/24h anti-runaway valve (default 300, `POST_REPLY_ANY_COMMENT_CAP`, 0=off) trips only on viral runaways, logging + `post_reply_capped` metric, keeping pages under Meta's ~4,800 actions/day ceiling and spam enforcement. The cap must stay out of merchant-facing copy.
**Why:** The strategic value is the cheap tier: Post Reply is the zero-AI-cost, no-quota engagement path ($15 plan), and `all` mode removes the keyword blank-page problem — it is the market-standard trigger (ManyChat/Spur/Inrō). Complaints occasionally receiving a canned template is the accepted cost of a free deterministic feature; the merchant still sees every comment in the inbox, and truly smart per-comment replies are the AI tier's job (a future AI-powered any-comment mode is a separate project). Options "more keywords" and "multi-rule" were studied and rejected as worse paths to the same coverage want.

<!--
Template for new entries:

## D-NNN · <one-line ruling>
**Decided:** <YYYY-MM-DD> · **Status:** Active | Superseded by D-MMM
<What was decided, in 1-3 lines.>
**Why:** <The reasoning, so it isn't re-derived.>
-->
