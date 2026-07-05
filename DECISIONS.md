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

<!-- D-013 is reserved by open PR #389 (Post-Reply any-comment mode); it lands on that merge, hence the gap between D-012 and D-014 here on main. -->

## D-014 · Positioning is "AI sales rep" (مندوب مبيعات), NOT "AI agent"
**Decided:** 2026-07-03 · **Status:** Active
Jawab24 is marketed as an **AI sales rep / مندوب مبيعات** (an identity), not an "AI agent." In its 2026 meaning "agent" implies an autonomous, multi-step, action-taking system; Jawab24 answers and recommends, then hands off to the merchant — it does not transact. "AI agent" may appear ONLY as a secondary **English** SEO keyword/tag — never as the headline, and never in the Arabic copy (وكيل = distributor/legal proxy, which is wrong and confusing). Reserve "agent" as the *lead* frame for when the product genuinely acts autonomously (Phase 3 cart recovery + order actions ship). Extends the 2026-05-30 sales-rep positioning and the honesty guardrail in `SALLA_LISTING_BRIEF.md` (transact *verbs* stay out of copy; sales-rep *identity* stays in).
**Why:** "Agent" re-inflates the exact transact-overclaim the listing honesty pass removed, has no resonant Arabic rendering for an Arabic-first Salla audience, and reopening settled positioning has no upside today. The trigger to revisit is concrete: when autonomy actually ships.

## D-015 · Gender-aware Arabic addressing = model inference from name + self-reference, neutral fallback, DM-scoped; FB `pages_user_gender` deferred
**Decided:** 2026-07-04 · **Status:** Active
The bot now matches the customer's grammatical gender in Arabic **DMs**. The customer's first name (already fetched as `senderName`) is surfaced to the model, and an `ARABIC GENDER` directive tells it to infer gender from the name + the customer's own self-reference (مهتم vs مهتمة), falling back to **gender-neutral / light-MSA phrasing when unclear** — never a masculine default. **No code-side Arabic name→gender dictionary**: the model does the inference. **Comments stay neutral** (public, gender unknowable). **Blast radius is bounded to Arabic DMs by construction:** the name line + directive live ONLY in the per-call block under `language === 'ar' && isDM` — NOT in the cacheable `STATIC_SYSTEM_PREFIX` — so every other language, every comment, and every business receives a prompt byte-identical to v50 (guarded by "senderName is inert" equality unit tests). This was a deliberate correction: an earlier draft put the few-shot examples in the shared prefix (all traffic) — too broad for a system serving many verticals/languages. The FB `pages_user_gender` Graph field is **deferred** (an optional Phase-2 accuracy booster for FB DMs only). Cache correctness: the exact-reply cache is bucketed by first name for DMs and the semantic cache is bypassed for DMs, so a reply gendered for one customer can never be served to another (gated by channel, not language, since language isn't reliably known at cache-read time — this marginally over-applies to non-Arabic DMs with zero content/correctness impact). Prompt bumped v50→v51 (flush caches on deploy).
**Why:** Name+inference works on **all** DM channels (FB, WhatsApp, Instagram) with data we already fetch and needs no Meta review; the FB `gender` field is FB-DM-only, frequently empty, requires a `pages_user_gender` App Review, and means storing sensitive data — narrow and high-friction for a marginal gain over inference on the same path. The model beats any hand-maintained Arabic name dictionary and a hardcoded dictionary violates the business-agnostic rule. Neutral-when-unclear is standard Arabic CX and composes with infer-and-match. **Eval note:** playground-eval category 59 (gender addressing) was added, with `senderName` plumbed through the playground endpoint. Grading is deliberately asymmetric because substring matching of Arabic gender is one-directional (feminine forms are the masculine base + a suffix/kasra, so feminine is detectable but masculine hides inside it): masculine/unisex cases assert `replyNotContains` the feminine markers (bulletproof — catches any wrongly-feminine reply, incl. the unisex-name "don't guess" rule), and feminine cases assert `replyContainsAny` the feminine 2nd-person kaf ـكِ + verb endings (a positive signal). Live-verified 2026-07-04 on a temp stack: masculine/unisex cases pass reliably; feminine addressing is produced correctly (أنتِ/أنصحكِ/يهمّكِ) but **probabilistically** — run-to-run sampling sometimes leaves a name-only reply unmarked, and substring grading undercounts, so the category is a coarse regression guard, NOT a consistency measurement. The strengthened directive (v51) demonstrably lifted feminine output vs the directive-only draft. Real consistency measurement still needs an LLM-as-judge harness (deferred) — do not tune the prompt further against the substring grader alone (overfitting to a noisy signal).

## D-016 · The reply pipeline stays shared across all channels; channel differences live in adapters; separate by JOB, not by channel
**Decided:** 2026-07-04 · **Status:** Active
WhatsApp does NOT get a forked reply pipeline or a dedicated queue. `messageProcessor.processMessage()` (KB retrieval, generation, guards, cost, leads) is channel-agnostic and shared; per-channel I/O (send, fetch, media, the 24h window, future templates/receipts) lives in the per-platform adapter (`whatsappAdapter.ts` etc.). The single `replyQueue` intentionally carries all six job types (FB/IG comments + FB/IG/WA DMs) — it has since day one, and singling WhatsApp out would be arbitrary. **Rule:** when a channel needs different behavior, add a method/capability to its adapter — never a `platform === 'x'` branch in the core (only 3 `instagram` leaks exist today; do not grow them). **Isolation trigger (future, queue-WIDE not WhatsApp-specific):** sustained queue wait-time → first raise `REPLY_WORKER_CONCURRENCY`, then split into per-channel queue+worker uniformly. **The only thing that justifies a separate pipeline is a different JOB, not more adjustments:** proactive outbound (template broadcasts / cart recovery) is a new *outbound* pipeline added alongside — inbound reply stays shared.
**Why:** Forking triplicates ~1000 lines of identical AI logic and guarantees drift (a Facebook guard silently missing on WhatsApp). The adapter already isolates FB/IG from WhatsApp churn without that cost. Investigated 2026-07-04 against live wiring (queue, worker, reply services, adapters, observability). Don't re-open "should WhatsApp be its own pipeline" — the answer is a new pipeline only for a new *job* (outbound), never a per-channel fork.

<!--
Template for new entries:

## D-NNN · <one-line ruling>
**Decided:** <YYYY-MM-DD> · **Status:** Active | Superseded by D-MMM
<What was decided, in 1-3 lines.>
**Why:** <The reasoning, so it isn't re-derived.>
-->
