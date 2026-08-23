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
**Decided:** 2026-07-01 · **Status:** Resolved by D-031 (2026-07-18 dry-run answered NO → owner-email match built)
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

## D-017 · Jawab24 replies in the customer's language (all languages); detection = shared module + flag-gated statistical override hardened against Arabizi
**Decided:** 2026-07-04 · **Status:** Active
The product goal is ALL languages: a customer writing in language X gets a reply in X (the LLM translates the KB; templates/fallbacks follow in a later phase). Detection lives in ONE place — `packages/shared/src/language/` — with two intentionally-unmerged surfaces (backend `detector.ts` with load-bearing confidence gates; ai-worker `resolveChain.ts` history-first chain); the old per-app copies are re-export shims. Latin-language identification beyond the legacy heuristics uses **tinyld**, gated behind `LANG_ENGINE=tinyld` (default `legacy` = byte-identical to before), and fires ONLY at the exact fallthrough where legacy had zero signal, ONLY for text with a **non-ASCII letter**, ≥2 words, an allowlist of 24 well-resourced Latin-script languages, and an accuracy/margin bar. Reply-language is NOT clamped to ar/en (an earlier clamp variant was rejected once the all-languages goal was confirmed).
**Why:** Two hand-rolled detectors had drifted (10-word Swedish list ⇒ "Hur kan man anmäla sig" mis-floored to en@0.5 ⇒ DM deferToHistory anchored the reply to the Arabic thread — the 2026-07-04 production misfire). Direct probing disproved the naive "tinyld with a 0.5 threshold" design: tinyld's accuracy is not a probability (the bug sentence scores sv@0.16), and **Arabizi/Franco-Arabic — a major slice of real traffic — gets confidently mislabeled (rn@1.00, eo@1.00)**. The gate requires a non-ASCII **letter** (non-letters stripped first), making Arabizi/English/acronym behavior identical in both modes *by construction* — including emoji/punctuation-decorated Arabizi (a codepoint-only gate let "kam el se3r 😍" through to a wrong Spanish guess; caught in 9-persona review before merge, gate hardened + regression-tested). Do not re-open "just raise/lower the threshold" or "replace the Latin branch wholesale" — any rule trusting tinyld's numbers alone answers Arabizi in Kirundi. **Flip caveat:** flipping also re-languages already-named non-Latin scripts (a Russian DM's prompt directive goes from "Reply in English" to "Reply in Russian") — intended, but NOT visible to the Latin-only shadow log, so the flip's eval-parity run must include non-Latin cases. Flip procedure: `npm run eval` parity (incl. non-Latin) + `LANG_ENGINE_SHADOW=1` disagreement window, then set the flag; rollback = unset. Frontend bundle safety: the module is deep-dist-imported and never exported from the shared barrel (guard test).

## D-018 · Leads CSV export is available on every plan (no paywall)
**Decided:** 2026-07-05 · **Status:** Active
CSV export on the leads page is NOT plan-gated. It was previously Business+ only, shown to Starter (non-trial) accounts as a locked `🔒 + "Business+"` upsell chip in the page header. That chip was removed and the `canExport` frontend gate deleted — every plan now sees the real Export button (the only thing that hides it is an empty list). The `/leads/export` backend route never enforced the plan, so nothing server-side changed.
**Why:** Owner call (2026-07-05). The locked chip read as a cryptic "part of my page is broken" state rather than an enticing upsell, had little conversion value for a desktop-oriented task (open the CSV in Excel/Sheets), and was a fourth element crammed into a ~320px mobile header — the main cause of the reported cramped/overlapping leads header on phones. Don't re-gate export behind a plan without re-opening this. (Note: `UpgradeCTA` itself is unchanged and still used elsewhere for genuine paid features.)

## D-019 · The offer-closing bot-tell is fixed at the PROMPT SOURCE (remove the prompt's self-contradiction), not by post-filtering the answer
**Decided:** 2026-07-05 · **Status:** Active
The recurring robotic offer-closing ("إذا حابة تفاصيل خبريني" / "فيني أساعدك" / "let me know if…") is fixed by removing three self-contradictions in the prompt, NOT by stripping the reply after generation. Root-caused 2026-07-05 (eval Cat 61 #677, verbatim prod thread, real ~12.7k KB): the prompt *banned* the closing (FINAL rule) while simultaneously *teaching* it — (1) GENERAL RESPONSE RULES said "sometimes ask a question back" right beside the offer-closing ban; (2) the `enthusiastic` style directive said "ask back naturally when more info would help" (a positive license the model followed over the negative ban); (3) no few-shot example demonstrated a clean flat ending, so the model had no positive pattern for the common case. Fix (all in the cacheable `STATIC_SYSTEM_PREFIX` / styleMap): reword (1) to only-when-needed, delete the license in (2), and ADD two clean-ending demonstrations (mid-thread answer + info-not-in-KB answer) written in **light MSA, explicitly labelled "mirror the customer's dialect, don't copy this MSA"** (never dialect-specific — dialect examples get parroted). Measured effect on the worst case (history seeded with 3 tic-closings, prod temperature): **56.7% (17/30) → 1.7% (1/60)**; eval Cat 61 passes 3/3 with NO post-filter. Residual 1.7% = the model's irreducible RLHF floor, accepted. PROMPT_VERSION v51→v52. A deterministic post-strip (`stripTrailingOfferClosing`, "Check 7") was fully prototyped, measured (0/30), and **removed** — the prompt fix made it redundant.
**Why:** Founder ruling (2026-07-05), stated repeatedly: "proper fix not a band aid… fix the prompt, not the answer after we get it… general fix, not one merchant/dialect." Prevention-over-detection (Rule 14) and demonstrations-over-rules ([[feedback_prompt_demonstrations_over_rules]]): the prompt was fighting itself, so the ban lost to the competing demonstration/directive — fixing the source removes the cause instead of masking the symptom. Parallels D-006 (stale-date defense is prompt-only; the code guard was rejected). Don't re-add a post-filter for the 1.7% residual unless live traffic proves it's a real problem, and don't reintroduce dialect-specific few-shot examples.

## D-020 · Zid is documented as broken/rebuild-pending; docs must not claim it is production-ready
**Decided:** 2026-07-07 · **Status:** Active
The Zid integration ships nothing usable and is not production-ready, despite an existing adapter/service/controller/routes + passing tests. A 2026-07-07 audit confirmed it was built against the wrong Zid API contract and has never round-tripped a real store: (1) it sends only `X-MANAGER-TOKEN` but Zid requires **both** `Authorization: Bearer <oauth>` and `X-Manager-Token`; (2) it subscribes to non-existent event names (`order.created`/`order.updated`/`order.shipped`/`order.delivered`/`app.uninstalled`) instead of Zid's real `order.create`/`order.status.update`/`product.create|update|delete`/`abandoned_cart.*`; (3) it likely targets the wrong endpoints (`/v1/products` vs Zid's `/v1/managers/...`); (4) token-refresh content-type and the webhook-signature scheme are unverified; (5) the tests mock the wrong shapes, so they pass while nothing works. **Decision:** reconcile the docs to say "broken — rebuild pending" everywhere (INTEGRATIONS.md, SYSTEM_ANALYSIS.md) and record the precise rebuild scope in `docs/integrations/zid.md`. The rebuild itself stays parked ("rebuild last") — this ruling is docs-only. Salla and Shopify are unaffected and remain live.
**Why:** Docs contradicted each other (INTEGRATIONS.md/SYSTEM_ANALYSIS.md said "✅ Production/Full" while the launch plan said "~25%, wrong API model"), which misleads integrators, the reply pipeline, and future work. Honest status + a written rebuild scope costs little now and prevents someone shipping/relying on a dead integration. Consistent with Rule 15 (docs in sync) and Rule 14 (name the real state, don't paper over it). Do not re-mark Zid production-ready until the rebuild in `docs/integrations/zid.md` is done and a real store round-trips.

## D-021 · Any-comment Post Reply SENDS to content-free comments (dot/emoji/digits); friend-tags stay skipped
**Decided:** 2026-07-07 · **Status:** Active
In any-comment mode (`triggerType: 'all'`), a content-free comment — punctuation-only ("."), emoji-only ("😂", "🔥"), digits ("000", "٠٠٠"), or any letterless mix — now **receives the template**, unconditionally (no post-context requirement). This reverses the punctuation/emoji spam-skip kept at PR #389. Implemented as an `isContentFree` early-send in `evaluateAnyCommentGuard` (`backend/src/services/reply/postReplyRule.ts`), ordered AFTER the tag/spam skips: `user_tag`, `friend_mention`, and `external_promo_url` still skip (and win over content-free), spam-keyword comments still skip, refund/cancel/exchange and complaints still flag, handoff pause and the 300/24h per-post cap still apply. Keyword mode and the AI pipeline are untouched.
**Why:** Owner ruling (2026-07-07). "علق بنقطة" (comment-a-dot) campaigns are the canonical use case any-comment mode exists for, and the fixed template needs no comprehension — the AI path's "nothing to answer" rationale for skipping content-free comments doesn't transfer to Post Reply. No post-context gate because on Instagram the CTA often lives inside the image with an empty caption. Also removes the incoherent boundary where "000" and "❤️" sent but "." and "🔥" didn't. Owner explicitly re-affirmed in the same session: friend-tag comments must NEVER get the template — do not extend content-free sends past the tag skips (a tag-a-friend mode would be its own opt-in decision).

## D-022 · Post Reply stays a bundled feature: no dedicated plan, no post-trial free mode, name stays «رد البوست», marketed as "included in every plan at no extra cost" — not as a headline
**Decided:** 2026-07-11 · **Status:** Active
Owner rulings, all in one session: (1) **No dedicated cheaper Post-Reply-only plan** — the 3-tier public grid stays; Post Reply is the zero-AI-cost value anchor *inside* every plan (extends D-013). (2) **No post-trial free mode** — `canAutoReply` keeps ALL reply paths, including deterministic Post Replies, behind an active subscription; marketing must therefore never phrase Post Reply as standalone-free. Canonical phrasing: EN "included in every plan at no extra cost", AR «مشمولة في كل الباقات بلا تكلفة إضافية», always within D-013's "unlimited = no monthly quota" semantics (never "never stops" — the invisible 300/post/24h valve exists). (3) **The user-facing name stays «رد البوست»** — a rename to «رد المنشور» was proposed (فصحى/no-loanword rule, Meta's Arabic glossary uses «منشور») and declined; the register rule governs surrounding copy, not this established product name. (4) **Marketing weight: completeness, not headline** — Post Reply is a commodity (Meta Business Suite has free basic comment automation; ManyChat/Chatfuel have comment-to-DM); it goes last in the landing feature grid and anchors value on pricing/compare surfaces, never repositioning Jawab24 as a keyword-bot tool.
**Why:** A bot-only plan cannibalizes Starter, strips the AI differentiator (the retention driver), adds a fourth plan *shape* to a grid that currently differs only by volume, and requires a new "AI-disabled" gating concept across the reply pipeline — all for a segment with zero demand evidence. Over-promoting the feature attracts the most price-sensitive, highest-churn segment and invites "Meta does this free" objections. Shipped 2026-07-11 on this ruling: landing feature card (last position) + landing pricing pill + pricing-row subtext + compare-table `postReplies` row (competitor cells verified against public pricing/docs same day: ManyChat & Chatfuel meter by contacts/usage, Tidio & Botpress lack native comment automation, Speedly includes it) + ManyChat pricing-FAQ refresh ($14/mo, 250-contact cap, March 2026 repricing).

## D-023 · Manual (cash/transfer) subscriptions expire when their quota window closes — no automatic monthly refill; admin re-grants the window once payment lands
**Decided:** 2026-07-14 · **Status:** Active
A subscription with `payment_method = 'manual'` is blocked by `checkSubscriptionStatus` (`backend/src/services/subscriptions.ts`) once its quota window closes — `allowed: false`, code `subscription_inactive`, **no grace period**. The check compares `now` against `startOfUtcDay(current_period_end)`, i.e. the **midnight-snapped** boundary, NOT the raw grant instant — because `initializeUsagePeriod` snaps the usage window's end to UTC midnight, so the window closes up to ~24h before the exact end instant. Comparing against the same snapped boundary keeps entitlement and quota-counting on ONE clock; without it, the midnight→instant sliver is exactly where a fresh (unpaid) monthly allowance leaked (window closed → `getCurrentUsage` returns nothing → `used` reads 0 → whole new 1500). This is a **single** check in `checkSubscriptionStatus` — deliberately NOT a second guard in `canUseAiReplies`, since every caller (AI-reply gate + page-limit gates) already routes through `checkSubscriptionStatus` and inherits it consistently. Renewal is an explicit admin action: after the cash/bank transfer is received, admin re-grants via `manualUpgrade` (1/3/6/12 months), which reopens the window AND refreshes the quota. Stripe subscriptions are deliberately exempt — Stripe drives its own expiry via `past_due`/`canceled` webhooks, and a renewal webhook can legitimately land minutes after the period end, so date-blocking there would cut off a paying customer. Purchased top-up balance is still honored after expiry (the top-up check runs after the status block and returns `usingTopup`). The merchant is told why: the block flows through `enforceAutoReplyGate`, which fires the one-per-24h `auto_reply_paused_billing` notification.
**Why:** Owner ruling (2026-07-14): "I do not want to give them 1500 replies if they do not pay." An `active` manual subscription previously never expired — nothing moved it off `active` (no Stripe webhook exists for it), and `checkSubscriptionStatus` had no date check. Worse, it silently *refilled* every month, forever, for merchants who had paid nothing. Found 2026-07-14 while investigating why a customer's page (Zolfakar Mkya) had stopped replying (quota exhausted 2026-07-08); prod held 3 manual subs, one (saad.ezoo773) already 11 days past its period and still entitled. A first pass keyed the check on the raw `current_period_end` instant; on review that still leaked the ~19h midnight→instant sliver (Zolfakar's grant ends 18:52, so a fresh 1500 would have been served 00:00→18:52 on renewal day), so the boundary was snapped to match the usage window — one clock, no sliver, no fragile "does a usage row exist" coupling. No grace window because, unlike Stripe's retry cycle, the manual end date is set by an admin on purpose — there is no payment in flight to wait for.

## D-025 · New signups start with auto-reply OFF (comments + messages) and comment mode 'dual'; existing merchants untouched; the "no Business Info" enable-warning is now shown to everyone
**Decided:** 2026-07-14 · **Status:** Active
New workspaces are seeded (`NEW_SIGNUP_SETTINGS_SEED` in `services/workspaceSettings.ts`, written into the workspace JSONB at `auth.createDefaultWorkspace` + `workspace.createWorkspace`) with `commentsAutoReply: false`, `messagesAutoReply: false`, `commentReplyMode: 'dual'`. Existing merchants are byte-identical: `DEFAULTS` and the read-time fallbacks are unchanged, so any workspace whose JSONB omits these keys still resolves the historical `true / true / 'public'` (guarded by `__tests__/newSignupDefaults.test.ts`). The PR #403 "enabling auto-reply without an answer source" confirmation **and** the honest nudge-banner copy are un-canaried — shown to ALL merchants, not just admins (`pages.tsx`), because with default-off the enable moment is exactly where a thin-KB merchant needs the warning. When the merchant does turn auto-reply on, it enables **both** comments and messages together (decision B) — dual opens a DM, so message replies must also be on or the DM dead-ends. **Channel scope:** `commentReplyMode`/dual and Post Reply are FB/IG-comment concepts — WhatsApp has no public comments and its page-level `whatsappAutoReplyEnabled` already defaults OFF, so WhatsApp is safe by construction; onboarding must show the comment-specific UI (Post Reply card, public-nudge framing) only for comment-capable pages. **Remaining implementation (not a decision):** the setup-checklist `autoReplyOn` is derived from page-level flags only, but FB pages auto-enable page-level on connect while the seed sets the workspace master off — so the checklist must be taught to read the *effective* (workspace-master AND page) state, or it will show "on" while the pipeline is gated off. The prompt/reply-voice fix that makes replies safe once enabled is D-024 (shipped as a separate PR).
**Why:** A same-day trial merchant (facebook.com/drawingartsyria) self-deleted 6h after signup: with default-on public auto-reply and only an auto-imported FB bio as knowledge, the AI publicly told their customers, in the merchant's name, that it didn't know their prices. Default-off removes the "auto-reply before the merchant is ready" half of that (D-024 fixes the reply-quality half). Dual as the new-signup default keeps any thin-KB answer in a private DM instead of on the public wall (verified safe on FB + IG: the public nudge only posts after the DM lands). Seeded at signup (not via `DEFAULTS`) so it is strictly new-cohort — the owner's hard constraint was that no existing merchant's behavior changes.

## D-026 · Legacy `GET/PUT /settings` serves pipeline fields from the workspace store; setup surfaces and the activation funnel read the *effective* auto-reply state
**Decided:** 2026-07-16 · **Status:** Active
The per-user `settings` table and the workspace JSONB diverged for the D-025 cohort: the seed wrote masters OFF only into the workspace store (the store the pipeline reads), while the legacy columns default ON — so `/settings`, the dashboard and the setup checklist showed auto-reply ON while the pipeline ran OFF, and the merchant could not even fix it (the toggle already looked on; the diff-based save never sends an unchanged field). Fix is read-side: `settingsService.getSettings`/`updateSettings` overlay `PIPELINE_FIELDS` (minus `aiModel` — legacy stays authoritative for the model, because the admin override writes the legacy table directly and `aiModelResolver` reads it) from `workspaceSettingsService.getSettings`, failing open to legacy values. Identity function for converged workspaces; heals the broken cohort with no migration. The checklist's `autoReplyOn` now takes the workspace masters into account (`deriveSetupState(pages, usage, masters)`), and `autoreply_enabled` is emitted only when a master is ON **and** ≥1 connected page is channel-enabled (`recordAutoreplyEnabledIfEffective`, fired from both the page-toggle and the settings-save transitions; idempotent). **Funnel note:** counts recorded before 2026-07-16 over-state activation — the event used to fire on the page-level toggle alone. This resolves the "Remaining implementation" noted in D-025.
**Why:** Trial→paid was leaking at a fake step: a new merchant could complete every visible setup step, be told "done", and have an AI that never replies. The UI affordances (status banner, settings toggles, checklist) were all correct — they were fed the wrong value. Prod data 2026-07-16: the funnel counted page-level toggles as activation for a cohort whose master was OFF by default.
**Defaults verdict + D-028 trigger (owner-reviewed 2026-07-16):** the D-025 OFF defaults stand, per-surface reasoning: comments stay opt-in permanently (public wall, unrecoverable mistakes — the drawingartsyria class); messages stay OFF *for now* (private surface, lower risk — customers still get the one-time away-message acknowledgment), because with the truthful panel the enable moment is one honest tap and Post Reply (D-027) covers day-1 value at zero risk. The truthful funnel now measures the enable step for the first time: **after ~2 weeks of post-deploy data, if new-trial enable-conversion is low, relax `messagesAutoReply` only to ON-by-default as a D-028 decision** (one-line seed change; comments unaffected). Backlog polish: the away message sent when auto-reply is merely not-enabled reuses the "outside working hours" copy — needs its own not-enabled variant.

## D-027 · Post Reply is exempt from the workspace auto-reply master — a configured trigger always fires (restores designed always-on behavior)
**Decided:** 2026-07-16 · **Status:** Active
Post Reply has no on/off switch by design: it is on by default and inert until the merchant picks a post and writes a keyword + reply — configuration IS consent, and the sent text is the merchant's own words (zero AI risk). The pipeline nevertheless gated the Post Reply branch behind `isCommentsEnabled` (the `commentsAutoReply` master, `commentProcessor.ts` step 3b), which was harmless while the master defaulted ON for everyone — until D-025 turned it OFF for new signups, silently killing Post Reply for exactly the cohort that needs the zero-KB quick path. The branch now runs on `postReplyEligible` (a trigger is configured AND within business hours); the debounce claim covers master-off Post Reply sends. Still gated, unchanged: page-level and per-post toggles, subscription gate, friend-tag/spam skips, the any-comment guards (spam/complaint/handoff-pause/per-post cap), and business hours (scheduling is a deliberate merchant choice orthogonal to D-025's AI-risk rationale). The AI paths stay fully master-gated — D-025 is unchanged for Smart Replies.
**Why:** D-025's rationale is AI hallucination risk; a verbatim merchant template carries none. Prod data 2026-07-16: Post Reply is heavily used where adopted (4,937 sends/30d) including by no-KB merchants — it is the new merchant's fastest working feature, and the master gate contradicted its always-on design as an unintended D-025 side-effect.

## D-029 · Settings Auto-Reply section is ONE flat status board; no standalone AI switch — `aiEnabled` is derived (channels-OR); Post Reply presented as an always-on row
**Decided:** 2026-07-16 · **Status:** Active
The Auto-Reply section is a single card answering "who replies, and where": three rows — 💬 comments (Smart Replies, toggle), ✉️ messages (Smart Replies, toggle), ⚡ رد البوست (merchant-authored, NO toggle — «يعمل دائماً» badge + manage link to /comments) — followed by one display-mode question («أين يظهر الرد على التعليق؟», segmented radiogroup) that sits at card level because the mode styles BOTH systems' comment replies. The standalone «تفعيل الردود الذكية» hero toggle is removed from the UI; the `aiEnabled` column stays but is written as `commentsAutoReply || messagesAutoReply` by the toggles, and the AI Personality section gates on the channels-OR. This kills the "zombie" state (aiEnabled=false + channels on → canned comment template + silent DMs) going forward; the one prod workspace in that state is reconciled manually at deploy. D-028 remains reserved for the messages-default decision (D-026).
**Why:** Owner's verdict during the PR #448 live review: the old three-sibling-toggle layout mirrored database columns, so every relationship (what gates what; where Post Reply fits; that the mode governs Post Reply too) needed explanatory copy and popovers — structure was outsourcing its job to words. Design iterated ×4 with the owner (system-grouping → surface-grouping → mode-after-rows → flat board): each iteration removed a hierarchy layer. Rows carry «ردود ذكية» branding (never "AI replies" — terminology rule) and the toggle-less Post Reply row states always-on structurally.

## D-030 · DM exact-cache buckets by fleet-learned gender (v53), not per-name — the model labels its own gender decisions; the map only ever chooses the READ bucket, the reply's own labels gate the WRITE
**Decided:** 2026-07-17 · **Status:** Active
v51's per-name DM cache bucketing (D-015) killed cross-sender sharing (Nourva: 10–15% hit rate → ~0.5%). v53 restores it: the model reports `gender`/`gender_basis`/`used_name` as strict structured output on every reply; the backend accumulates name-based judgments (`gender_basis='name'` only, from real `dm_reply` traffic only) into Redis counters per normalized first name (`gender:name:<md5>:m|f`, 90d rolling TTL); a name with ≥5 observations at ≥90% agreement buckets its senders by gender (`g:m`/`g:f`) instead of name hash. Save-side is gated by the reply's OWN labels — gender bucket only when `used_name=false` AND no normalized name-substring in the reply AND (reported gender matches the bucket OR reply used no gendered forms); anything else downgrades that save to the per-name bucket. Unisex/unknown names, self-reference overrides, failover/eval/playground, and Redis loss all degrade to v51 per-name behavior. NOT a hand-maintained name dictionary — D-015's ruling stands; every label is the model's own inference. Kill-switch: `AI_GENDER_BUCKET_ENABLED=false`. Correctness bar: a cache hit must be behaviorally indistinguishable from a fresh generation (self-references live in the message text, which is part of the key, so bucket + exact text pins the gender decision).
**Why:** Owner asked to recover the lost sharing after the 2026-07-17 "cache=0" investigation. Honest economics: net ~$3–10/month today (recovery ≈ half-to-two-thirds of old hits, minus ~15 output tokens/call for the report fields) — the owner chose to build anyway for first-message latency (instant vs ~1.7s at the funnel's most visible moment), WhatsApp-scale readiness (benefit scales with DM volume), and the free production-scale gender-consistency telemetry D-015 deferred for lack of a judge.
Adoption is measured by prod-visible Redis counters (`metrics:cache:gender_bucket:read` / `:save_ok` / `:save_downgrade:<used_name|name_substring|gender_mismatch>`) — prod logs at info, so log lines alone can't carry this. Both name hashes are 16 hex chars (64-bit; 8 would reach ~50% fleet collision probability near 77k distinct names — a cross-gender collision is the exact bug class this design prevents). Deliberately deferred, revisit only if the downgrade rate says sharing is poor: a shared neutral bucket (`g:n`) admitting only `gender='unknown'` replies would extend sharing to unlearned/unisex names; FB's `pages_user_gender` field remains the someday accuracy booster (App Review + often empty — D-015).

## D-031 · Salla Easy-Mode ownership binding = owner-email match; the OAuth authorize redirect is DEAD for Easy-Mode apps (D-012's question answered empirically: NO)
**Decided:** 2026-07-18 · **Status:** Active (resolves D-012's open confirmation)
The 2026-07-18 live dry-run on Jawab24-Dev (app `1565152053`, flipped to Easy Mode, reinstalled on the dev store) settled D-012's blocking question: **an Easy-Mode app cannot initiate the standard OAuth authorize redirect** — Salla drops the app's registered redirect URIs (the callback field is gone from the portal), so `accounts.salla.sa/oauth2/auth` fails with `invalid_request: The 'redirect_uri' parameter does not match any of the OAuth 2.0 Client's pre-registered redirect urls` before any login/consent screen. Consequences, all shipped behind `SALLA_EASY_MODE_CLAIM_ENABLED`:
1. **Claim binding = owner-email match.** At claim time the backend fetches the store's registered email live from Salla (`/admin/v2/store/info`, using the webhook-pushed token) and finalizes only if it equals the logged-in user's email (normalized). Sound because Jawab24 has no unverified-email signup (auth = Facebook OAuth; phone-OTP accounts without an email get 403 `no_email`). The client-supplied `pendingId`/`merchantId` only SELECTS the pending row — never trusted as proof. Mismatch → 403 `email_mismatch` (never echoes the store's email — anti-phishing); Salla-API failure → 502 `store_info_unavailable` (merchant remedy: "Reauthorize App" re-pushes a fresh token — re-push confirmed live in the same dry-run).
2. **The merchant-initiated OAuth connect flow is equally dead for the published app.** `POST /salla/store/connect` is mode-aware: with the flag on AND `SALLA_APP_STORE_URL` set (known at approval), it returns the public listing URL instead of the OAuth authorize URL; dev/Custom-Mode keeps OAuth.
**Why:** D-012 deferred the binding pending exactly this confirmation, with owner-email match as the designated NO-branch. Building the OAuth-round-trip branch would have been wasted (the endpoint 404s). Don't re-open "just use the authorize redirect for identity" — it is empirically impossible in Easy Mode; the alternative signed-app-entry context remains undocumented by Salla. If a merchant's Salla email differs from their Facebook email, the claim UI tells them to sign in with the matching account (support-assisted reassignment stays a manual escape hatch).

## D-032 · Post Reply images: DM-modes only, delivered as a Meta card (reply caps at 160), stored via a thin provider-agnostic `ImageStorage` (S3) on a managed bucket; ManyChat storage model, media-library UI deferred
**Decided:** 2026-07-18 · **Status:** Active
Merchants can attach ONE image to a Post Reply. It rides ONLY the DM channel (comment reply mode `private` or `dual`); in `public` mode the affordance is a small locked hint that LINKS to Settings (NOT a one-click mode toggle — `commentReplyMode` is workspace-wide and also governs Smart AI reply delivery, so it must be changed deliberately in Settings, not silently from this modal) — never a public image. The image affordance is a small text button opening the native file dialog directly (no big dropzone; attached image shows as a compact chip). FB allows one message per comment→DM, so image + text are sent as a single generic-template card: title (≤80) + subtitle (≤80) ⇒ the reply caps at **160 chars with an image** (1000 without); over-limit **hard-blocks Save** (no truncation, two exits: trim / remove image). On non-transient card-send failure the send path falls back to a plain-text DM (reply lands, image dropped). Storage is a **thin, provider-agnostic `ImageStorage`** (`@aws-sdk/client-s3`, `put`/`remove`/`isConfigured` only) pointed at a **managed S3-compatible bucket (Backblaze B2 chosen)** — NOT self-hosted MinIO on prod and NOT blobs in Postgres (only `trigger_image_url/key/bytes` text columns). Provider swap is env-only (B2 ⇄ R2 ⇄ S3 ⇄ MinIO), zero code change; MinIO documented as the fallback. Feature is OFF until `isConfigured()` (6 `S3_*` vars). Lifecycle is **reference-based** (image lives as long as its Post Reply; delete-on-replace/remove + page-delete cleanup; safe-order so a live image is never lost); age-based expiry targets ONLY orphans. Per-workspace quota is a generous abuse cap (default 1 GB), not a normal-use wall. Runbook: `backend/docs/OBJECT_STORAGE.md`.
**Why:** Owner wanted to complete the ManyChat-style "comment X → get the catalog in DM" loop (a confirmed edge over Mando CX, which is DM-only with no comment features) without the two things they were (correctly) worried about: DB growth and losing images. Managed object storage solves both — bytes leave the ENOSPC-prone prod host and never touch `pg_dump`; reference-based lifecycle + versioning keep images from being lost. The thin interface + managed-bucket choice keeps ops burden near zero (B2 already runs for DB backups; effectively $0 at one 2 MB image per post) while preserving a one-env-var exit to self-hosting. Image-selection for a future Smart Reply feature is the real work later; the send layer + storage are deliberately reply-type-agnostic so that reuses this, and the central media-library UI is deferred until then rather than over-built now.

## D-033 · DM exact cache adds a shared gender-neutral bucket (`g:n`) — the model's own `gender='unknown'` + `used_name=false` labels are the cacheability certificate; distinct key segment, most-specific-first reads
**Decided:** 2026-07-21 · **Status:** Active
Executes D-030's deferred note: a DM reply the model certifies genderless (`gender:'unknown'`) and name-free (`used_name:false` strict + normalized name-substring check) saves under a `g:n` segment shared across ALL senders — no map warm-up, works even with `AI_GENDER_BUCKET_ENABLED=false`. The labels ARE the certification (D-030's trust model, same labels the `g:m`/`g:f` guard trusts); a proposed hand-maintained feminine-marker text check was considered and REJECTED (inconsistent with the trust model, a hand list per D-015's anti-pattern, diacritic-fragile, and the same mislabel risk is already accepted unguarded on the gender-bucket path). Reads probe most-specific first (`g:m`/`g:f`/`n:` — a warmer personalized entry wins, HTTP `Vary` semantics), then `g:n`; two probes max. Two deliberate corrections over the first draft: (1) `g:n` is a DISTINCT segment, NOT the bare nameless-DM key — legacy nameless entries carry no gender certification and must never be served to named senders; (2) specific-first probe order, not neutral-first. Kill-switch: `AI_NEUTRAL_BUCKET_ENABLED=false` (independent of the gender-bucket flag). Counters: `metrics:cache:neutral_bucket:hit` / `:save_ok` / `:save_reject:<gendered|used_name|name_substring|not_reported>` — the save_ok∶reject split sizes the genderless slice and is the go/no-go telemetry for ever considering always-neutral generation (ESI-style personalize-at-serve), which was evaluated 2026-07-21 and rejected for now (prompt change + PROMPT_VERSION flush, reverses D-015's gendered warmth, stilted neutral Arabic risk).
**Why:** The v53 gender bucket never engaged (map cold: ~82 names, 25 bucket uses vs 500–800 DMs/day 4 days post-deploy), so DM traffic stayed on v51 per-name keys and the hit rate stayed ~0–1% vs 20–33% in June; owner ruled the regression real and worth fixing. D-030 rejected neutral sharing because neutrality couldn't be certified by inspection — v53's structured self-report removed that blocker, so the origin (the model) now declares each reply shareable-or-not, the same principle as `Cache-Control: public` vs `private`, combined with minimal-Vary-cardinality key design (never key on a high-cardinality name when the response varies only by gender — or by nothing).

## D-036 · DM exact cache goes dual-variant (`g:d`): gendered replies store BOTH addressee renderings under ONE shared key; a save-time transform call produces the second rendering; reader's map-known gender picks at serve time
**Decided:** 2026-07-22 · **Status:** Active (ships dark behind `AI_DUAL_VARIANT_ENABLED`; enable only after the transform passes a dialect-preservation eval)
Gendered, name-free DM replies (certified by their own labels: `gender` m/f + strict `used_name=false` + name-substring belt, D-030's trust model) save under a new `g:d` segment with `variants:{m,f}` — the missing rendering produced by a fire-and-forget save-time model call ("convert the addressee's gender; change nothing else", pipeline `gender_variant_transform`), guarded by content-invariance checks (digit-sequence equality + length-ratio bound; a variant that bends a price is discarded, counter `metrics:cache:dual_variant:save_reject:*`). Reads probe `g:d` first when the reader's gender is map-known, serving `variants[gender]`; unknown-gender readers skip it (never guess) and fall through to the D-033 chain (specific → `g:n` → fresh). Transform failure = legacy save — never worse than status quo. Alternatives ruled out: plain revert to pre-v51 masculine-default (misaddresses the majority-female core audience, permanently, scaling with growth) and neutral-steered generation (owner ruling: neutral customer-service register is rare/unnatural in the initial Arab-market segment — the native-speaker judgment the external review said should gate the choice). Composes three standard patterns: ICU-select store-variants/select-by-reader, Arabic user-aware gender rewriting (established NLP task), and D-033's certification model.
**Why:** v51's per-name keys killed cross-sender sharing (10–21% → ~0% on Jul 4); v53's two-bucket recovery halves sharing at best and its map starves on long-tail names; `g:n` caps at the ~12% genderless slice. One shared entry with both renderings is the only design that restores the FULL June key population while keeping gender-correct dialectal replies — the product's differentiator. The cache's value is burst latency (ad-driven identical first messages) more than dollars; both scale with the growth plan. External expert review (2026-07-22) endorsed the shape and contributed the invariance guard and the dialect-preservation eval gate.

## D-037 · The price guard grounds computed totals on a VERIFIED model self-report (`price_math`), not on literal KB substrings — trust-but-verify, additive only
**Decided:** 2026-07-22 · **Status:** Active (prompt v56)
Check 1 (`flagHallucinatedPrice`) compared every number in a reply against the set of numbers appearing LITERALLY in Business Info, so an arithmetically correct cart total (items + delivery) could never pass — prod (متجر إجدابيا, real customer traffic) replaced «المجموع 49 دينار» with the «تواصل معنا على أرقامنا» deflection at the moment of purchase, while the SAME question one turn earlier passed only because PURCHASE_INTENT skips the guard. Fix: a new required JSON field `price_math: [{total, terms:[{unit, qty}]}]` where the model shows its arithmetic; `verifiedPriceMathValues` checks every `unit` against literal KB values AND that Σ(unit×qty)=total, then UNIONS the verified totals/products into the accepted set for that reply only (both tiers, computed once). Absent, malformed, unverifiable, or hallucinated-addend claims degrade to exactly the pre-v56 guard — the field can only ever ADD grounding, never remove it. Subtraction (discount math) is deliberately inexpressible; do not add a sign field without re-deriving what a negative term does to verification. **The prompt change is the `price_math` output contract ONLY — no behavioural rule.** A "TOTALS" rule (itemize-then-total, read the cart from history, never deflect a computable total) was written, measured, and REMOVED (owner ruling, 2026-07-22): with the validator fixed the model already totals correctly and populates `price_math` unaided. The rule changed exactly ONE case — a terse «الحساب كم بالتوصيل» after an already-priced cart, where without it the model asks one clarifying question instead of totalling, and only ~3/4 of the time. Neither way deflects and neither way trips `price_not_in_kb`. Whether the model totals immediately or asks once on so terse a turn is left FREE — do not re-propose a rule for it.
**Why:** The alternative — extending the regex to accept sums of numbers found in the reply — was rejected after walking it into the v54 quantity case («كيسين بـ74»: 74 is neither a KB value nor a sum of reply numbers), which would have needed products, then sums-of-products, growing a hand-maintained heuristic against D-015's anti-pattern; subset-sum over the whole KB was rejected outright because ~40 small integers densely cover every plausible price, silently disabling the guard. Structured self-report + deterministic verification is the same trust model already proven by v53's gender labels (D-030/D-033) and keeps the worst case equal to the bug we already had. Eval: Cat 68 replays the prod conversation on an anonymized fixture; full suite at temp 0 measured at parity with the v54 baseline (97.1/96.9 vs 97.1/97.0) — a verbose 3-paragraph version of the prompt rule measured a consistent ~0.5pp REGRESSION concentrated in `info_not_in_kb`/low-confidence honesty cases (#84/#197/#252) — rule bloat diluting the honesty rules; compressing it to one paragraph restored parity, and DELETING it entirely scored best (97.2/96.9 vs baseline 97.1/97.0, Cat 68 4/4 both runs). Two lessons worth keeping: treat added prompt LENGTH as a cost, not just added instruction; and when a guard is the real bug, fix the guard and re-test the model UNINSTRUCTED before writing a rule — here the model had been computing the totals correctly all along, so every line of prompt written to 'teach' it was pure dilution.

## D-038 · Source-vs-confirmed conflict resolution: merchant-confirmed data is the ONLY runtime authority; every external source (posts, post-replies, Facebook sync) is a review-gated proposal, never a silent override; recency hints, the merchant decides; and import MUST reconcile (update-vs-add), not blind-insert
**Decided:** 2026-07-24 · **Status:** Active
General rule for the Business Surface milestone (asked in the abstract, not for one merchant). Two tiers, always: **(1) Authority** = the merchant-**confirmed** catalog + Business Info — the ONLY thing the reply pipeline answers from. **(2) Sources** = posts, post-replies, and Facebook sync — they never enter the reply prompt as authority and can only ever *propose* changes to tier 1. Consequences: (a) **At reply time there is no conflict** — a new/contradicting post or post-reply can't change what the AI tells customers, because the AI never reads raw sources as knowledge (post-replies aren't in the prompt at all; FB-sync fields are provenance-demoted to the narrative fallback per Phase A / `businessInfoPrompt.isAuthoritative`). (b) **A conflict is a review-time reconciliation, decided by the merchant** — surface both values with the source's date and offer update / keep / add-as-separate. (c) **Recency informs, it does not rule** — a newer post is a strong hint the price changed, but offers are time-bound («فترة العرض»), so newer ≠ current-truth; only the merchant can promote it. (d) When the merchant accepts a source-proposed value it is stamped confirmed (editor + `confirmedAt`) so Phase A's gating treats it as authoritative thereafter. **Architectural requirement this imposes:** the catalog import/scan flow MUST match a proposal against existing items (normalized name) and offer an UPDATE — the current insert-only path duplicates any offering an external source re-proposes (a real gap, independent of merchant). The post-reply source (added 2026-07-24) ships behind this rule: it proposes into the same review sheet and is inert until reconciliation exists.
**Why:** Auto-overriding confirmed data on any external signal is exactly how a stale price, an expired promo, or a one-off campaign silently corrupts what the AI tells *every* customer — the failure is unbounded and invisible. The confirm-gate makes that impossible; its only cost is the merchant approving a change, which is the correct trade (same discipline already shipped for FB-sync provenance in Phase A, and the no-silent-migration contract of `catalogExtractor`). Blind-insert import was acceptable while the catalog was authored once; the moment recurring sources (posts, post-replies, re-scans) feed it, reconciliation stops being optional.

## D-039 · A page-conflict message never names the account holding the page — the merchant is routed to support, and the holder's identity stays in the admin console
**Decided:** 2026-07-25 · **Status:** Active
When a merchant's Facebook sync surfaces a page already connected to a different Jawab24 account, any merchant-facing copy (toast, empty state, notification) names **the page** and routes to support. It must NOT disclose the holding account's email — full or masked. Support discloses case-by-case from the admin console, where a human can judge the situation. This binds the Phase 6.6 conflict UX and any interim message shipped before it; the preferred resolution stays 6.6's design (notify the HOLDER with Disconnect / Invite CTAs), which resolves the conflict without either side learning the other's identity. Manual transfers are a support action, documented in the `/move-page` skill.
**Why:** Owner initially proposed showing the email, reasoning that two admins of the same FB page already know each other. True in the common case, and false in exactly the case that bites: Facebook admin rights outlive business relationships (ex-employee, former agency, the freelancer who built the page), which is the same scenario commit `e8291a70` was written for. An automated toast cannot tell a colleague from an ex-colleague and fires before any human looks. Three further reasons: the address is typically a personal Gmail, so we would be a controller disclosing a data subject's identifier to a third party with no consent or lawful basis; the disclosure is one-sided (the requestor proves FB admin at that moment, the holder never gets a say about being named); and it buys little — knowing the email doesn't transfer the page, so the merchant still ends at support. ManyChat, Chatfuel, Buffer and HubSpot all show "page is taken, contact the admin" without naming the account, so Rule 16 (industry standard absent a stated reason) applies. Note the current code is *worse* than this ruling, not better: the silent-skip branch says nothing at all, so the merchant can't even tell a page was withheld — that gap is what 6.6 closes.

## D-040 · App-originated payments go to Stripe-HOSTED checkout; web checkout keeps the embedded form plus a visible hosted-fallback link
**Decided:** 2026-07-25 · **Status:** Active
Native apps hand payment to a Stripe-hosted Checkout Session (`checkout.stripe.com`) opened directly from the app — the app is authenticated and creates the session itself, dropping the old log-in-again-in-the-browser bounce to our embedded checkout. Web checkout keeps the embedded PaymentElement (better conversion UX in ordinary browsers) but shows a permanent "ادفع عبر صفحة Stripe الآمنة" fallback link that opens the same hosted session. Completion is linked by `checkout.session.completed` → adoption (`subscriptionLinking.ts`) with the reconciliation sweep as backstop, so activation never depends on what the browser does after payment.
**Why:** App-store policy forces payment into the system browser — whatever the merchant's DEFAULT browser is, which we neither control nor test. The embedded PaymentElement embeds Stripe as a THIRD party (cross-origin iframe tokenising against api.stripe.com), the exact pattern privacy browsers exist to interfere with. Live incident 2026-07-25: a merchant on Brave (his default; our app put him there) filled the form, pressed pay, and the card never left his device — no PaymentMethod in Stripe, no webhook, no Sentry (Shields blocks that too). Three attempts, total silence; the same Nuran Bank Visa paid **instantly** on a Stripe-hosted invoice page, where Stripe is first-party and there is nothing to block. Hosted checkout makes the failure *impossible* rather than detected (Rule 14 — prevention over detection; client-side telemetry cannot help because the same shields block it), and redirect-to-hosted-Checkout is Stripe's own maximum-compatibility recommendation (Rule 16). Trade-off accepted: the merchant leaves jawab24.com to pay — against "silently cannot pay at all," not close, and the app user has already left the app anyway. The historical risk of hosted flow (checkout.session.completed linking breaking unnoticed — the #497 incident) is now covered twice over: metadata adoption + the 15-min sweep.

## D-041 · A lead keeps ONE phone column (newest share wins); extra people and numbers live in the extracted-data card, and a displaced number is never discarded
**Decided:** 2026-07-25 · **Status:** Active
`leads.phone` stays a single scalar and `(sender_id, page_id)` stays the lead's identity — the row models the *person talking to us*, not a number. When a conversation carries more than one contact (a parent registering two children, an order for several recipients), the extra people live in `extracted_data.fields` as paired `name_N` / `phone_N` entries emitted by the extraction prompt. The phone column follows newest-wins so the call/WhatsApp buttons dial the latest share, and `upsertLead` preserves any *different* number it displaces as an `additional_phone[_N]` field — preservation is code, not a hope that the model re-emits it. No `alternate_phones` array/table.
**Why:** Prod 2026-07-25 (الفريق الدمشقي, lead `f66db763`): a parent sent daughter A's name+number, then daughter B's. The upsert overwrote the column silently — the buttons dialled B while the card showed A's name, and B's name never appeared at all. The overwrite was the ONE destructive field in an otherwise carefully non-destructive upsert (card merges per key, `completed` never demotes, status never regresses), so this closes an inconsistency rather than adding a feature. A structured multi-contact model was rejected: `extracted_data` already renders on the card, is covered by server-side search, and flows into CSV export, so the flexible-fields path delivers the merchant value now, while a schema change would touch migration + card UI + search + CSV + digest for no additional benefit at this stage. Revisit only on a real signal (merchants asking to *filter/dial* per additional contact, or a CRM export contract needing structured contacts). Full design + the six prior lead-gate incidents: `docs/leads.md`.

## D-042 · Post-replies are NOT a "fresher" source than the KB — they are frequently the STALEST source; the planning premise that inverted this is retracted, and post-reply prices must never auto-apply
**Decided:** 2026-07-24 · **Status:** Active (empirical correction to a planning premise; reinforces D-038)
The Business Surface plan asserted «the freshest prices live in posts + post-replies, not the KB», citing الفريق الدمشقي (page `39aeab89…`) as quoting 35k while his post-replies advertised a 25k offer. **Measured against post DATES, that reading is exactly inverted.** He RAISED prices 25k → 35k in mid-July: his latest posts (07-18, 07-20 «دورة الأمين المبتدئ», 07-21, 07-23, 07-24) all state **35k**, and the AI's DM replies quote **35k** — i.e. **the AI is CURRENT and correct**, no stale-KB defect. Every 25k mention is May–June, and — the actual finding — an **old armed post-reply still asserts «أسعارنا الحالية … 25000»**, so the post-reply is the stale artifact, not the KB. Consequences: (a) **never auto-apply a post-reply-sourced price** — for this merchant a blind «استورد من ردود منشوراتك» import would have overwritten a correct 35k with an obsolete 25k, a data regression caused by our own feature, on a top-2 paying merchant; (b) post-replies are an *un-versioned, un-expiring* source — merchants update the post but rarely the armed reply, so staleness there is structural, not incidental; (c) D-038's reconcile gate (update-vs-add, merchant decides, recency only hints) is therefore load-bearing, not polish — it is the specific guard that prevents this; (d) any freshness ranking across sources MUST order by date and treat `posts.created_at` as ingestion time (`created_time` is NULL in prod) — a proxy for, not proof of, the merchant's posting date.
**Why:** The original premise was derived from a single merchant's numbers WITHOUT comparing dates, and it pointed the milestone at the wrong defect (a phantom "stale KB") while hiding a real one (stale armed post-replies) and a real risk (an import feature that degrades good data). Recorded because a plan premise is the kind of claim later work silently builds on: B0 shipped the post-reply import on 2026-07-24, so the inversion had to be settled before B0.5 ran it against a live page. Method rule this makes binding for the milestone: **a value is only "stale" relative to a date — establish provenance and ordering before calling any source wrong** (the same failure mode also produced a retracted claim in the same session, where a page was treated as evidence without joining `pages → users` to confirm ownership).

## D-043 · The workspace timezone has exactly ONE editable control — Settings → General — ungated by any toggle; every other surface shows it read-only and deep-links there, and the device zone is a one-time default that is never auto-tracked
**Decided:** 2026-07-25 · **Status:** Active
`settings.timezone` is edited in exactly one place: `TimezoneCard`, in the **General** section of Settings, always visible and behind no feature toggle. Every other surface that depends on it — today the `/business` working-hours sheet via `useMerchantTimezone` — DISPLAYS it read-only and links to that control (anchor `business-hours-timezone-label`); none may offer a second editor. The detected device zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) is used once, as the default when nothing is stored, and the stored value is never auto-corrected toward the device afterwards.
**Why:** The timezone governs every time-based behaviour in the product — the AI's "today's date" line, the Post-Reply hours gate, the reply schedule, and the working hours quoted to customers — so a wrong value silently shifts all of them. It had been gated **three ways** behind `businessHoursOnly` (wrapper `pointer-events-none`, the Select's own `disabled`, and the hint button's) and buried in Advanced, which is `usePersistedBoolean(…, false)` — collapsed by default. A merchant who left the reply-schedule toggle off therefore could not reach the setting at all, and the first deep-link attempt silently did nothing because the anchor was never rendered. (⚠️ Test any deep link into Advanced with that persisted flag CLEARED.) A second control inside the hours sheet was rejected on placement grounds: one value with two homes drifts, and the sheet's own concern is what the bot TELLS customers, not the workspace clock. Auto-tracking the device was rejected by owner ruling — a "use this device's timezone" hint fires whenever stored ≠ device, so a Damascus business configured from Sweden is permanently offered the wrong answer; the backend needs a stored zone regardless, since the AI replies at 3am with no browser open. Related, still open: the DB default is literally `PLACEHOLDER_TIMEZONE` (`schema.ts`) and nothing at signup captures a zone, so a new merchant inherits Riyadh time until they open Settings — the proper fix is sending the detected zone with the signup/connect request.

## D-044 · Do NOT rotate `FACEBOOK_APP_SECRET` for the 2026-07-26 Sentry exposure — the rotation costs more than the leak, and it is a coordinated cutover, never a routine task
**Decided:** 2026-07-26 · **Status:** Active
The Facebook app secret was reaching Sentry via outgoing-HTTP breadcrumbs (`http.query` records the raw query string; `exchangeCodeForToken` passes `client_secret` as a query param). The leak is FIXED going forward by the scrubbing in `lib/sentry.ts` (#512, deployed). The historical exposure is accepted and NOT remediated by rotation.
**Why:** Reading the exposed value requires access to the Sentry project, and the owner confirmed he is its only user — so the practical risk is close to theoretical. Rotation, by contrast, is genuinely expensive and was initially mis-recommended as "cheap" before the code was checked. Two hard costs: (1) `controllers/webhook.ts` verifies Meta's `x-hub-signature-256` with an HMAC of the app secret, so any divergence between Meta's value and ours rejects EVERY inbound webhook — Facebook comments, Messenger, Instagram and WhatsApp — for every customer until the env is updated and the container recreated; it is a coordinated cutover, not an env edit. (2) Worse and permanent: the WhatsApp two-step-verification PIN is DERIVED from the secret — `HMAC(appSecret, phoneNumberId)`, documented in `services/whatsapp.ts` as "reproducible on reconnect, never stored" — so rotating changes the PIN and any already-registered number can never be re-registered by us (Meta rejects it as a PIN mismatch). Re-open this decision if Sentry access is ever widened (contractor, shared login, integration), or if a breach is suspected.
**Follow-up (separate from this ruling):** deriving the WhatsApp PIN from a rotatable credential couples it to a value that must stay stable forever, which means the app secret can effectively never be rotated once merchants are connected. Storing an encrypted per-number PIN would remove the coupling. Worth doing before WhatsApp GA, while exactly one number is affected.


## D-045 · WhatsApp Coexistence ships BEFORE GA — and Syria can never use WhatsApp at all, regardless of it
**Decided:** 2026-07-27 · **Status:** Active · **Reverses the 2026-07-26 ruling that Coexistence was a post-GA project**
Coexistence ("API Solutions for Business App Users" — the merchant keeps their number live in the WhatsApp Business app while we also hold it on Cloud API) is built before WhatsApp GA rather than after. v1 does NOT import chat history: the three webhook fields Meta requires (`history`, `smb_app_state_sync`, `smb_message_echoes`) are all subscribed so onboarding stays valid, but only `smb_message_echoes` is acted on — `history` and `smb_app_state_sync` are accepted and discarded. Coexistence numbers default to a human-first reply mode; migrated numbers keep replying instantly.
**Why:** Virtually every Arabic SMB already runs its business number on the WhatsApp Business app, so without Coexistence GA announces a feature most merchants can only adopt by buying a second SIM — and "can I keep my number?" was always going to be the top support question on day one. The original deferral was also made under a constraint that no longer holds: the authoritative `featureType` value was unreadable until app-level Tech Provider onboarding completed (2026-07-26), and Rule 12 forbids hardcoding a third-party value from memory. Two findings shrank the work: Meta documents that echoes cover "the WhatsApp Business app or companion devices only, **not Cloud API messages**", so the self-mute risk both prior plans treated as the hardest problem cannot occur; and #510 already stores the real `wamid` in the UNIQUE `platform_message_id`, so idempotency and the defensive self-send guard are one lookup instead of adapter surgery. History was excluded from v1 because Meta pushes up to **180 days**, the window cannot be limited on their side, and one webhook "could potentially describe thousands of messages" — importing that into merchant inboxes is a separate project with its own GDPR and retention questions. ⚠️ Meta's onboarding docs warn partners have **24h to synchronize history or the business must offboard and restart**; whether receiving-and-discarding satisfies that is UNVERIFIED and must be checked on the first real coexistence connect.
**Separate, larger finding (not Coexistence-specific):** Meta states businesses in **Cuba, Iran, North Korea, Syria** and three sanctioned Ukrainian regions "are not eligible to use the WhatsApp Business Platform", and users there "are not eligible to **receive** messages sent via" it. So a Syrian merchant can never connect WhatsApp to Jawab24, and Syrian customers of ANY merchant can never receive an AI reply — this is a product-wide constraint that must be reflected in launch copy and in the existing sanctioned-country handling, not a limitation of this feature. Libya appears in no restriction list, so the paying customer base is unaffected.

<!--
Template for new entries:

## D-NNN · <one-line ruling>
**Decided:** <YYYY-MM-DD> · **Status:** Active | Superseded by D-MMM
<What was decided, in 1-3 lines.>
**Why:** <The reasoning, so it isn't re-derived.>
-->

## D-046 · Facebook sync becomes suggestions-only: nothing lands in merchant-facing data without approval, and the merchant's own KB text always outranks Facebook

Owner rulings, 2026-07-28. (1) A re-sync must never replace merchant-side structured
data — Facebook data may be stale; the existing editor/kb_extract protection stays, and
the "Option B" auto-promotion of fb_sync values into the `merchant` half is reversed:
FB sync writes ONLY the `suggestions` half, surfaced as one-tap-approve proposals in
/business and onboarding. Approval is what mints `editor` + `confirmedAt` — the same
currency the authority layer and the readiness metric already count. Cost of the
reversal is ~zero for replies because D-009 already bars unconfirmed FB facts from the
prompt. (2) Operational facts hand-written in the KB (hours, phones, address) are the
truth by authorship — `kb_extract` outranks `fb_sync` end-to-end (already the D-008
merge rules; activation = `KB_OPFACTS_EXTRACT`, set to `shadow` in prod this date, then
`on` + the one-off backfill). (3) Planned companion, not yet built: a SYNC-DRIFT alert —
when a refresh brings a Facebook value that DIFFERS from the merchant-owned value, the
sync stays silent in data but notifies the merchant («فيسبوك يقول دوامك تغيّر — تحدّث؟»)
with a one-tap adopt; silence-by-design must not hide real-world changes from the one
person who can judge them. (4) `website` loses its
"descriptive, low-harm" privilege (owner, same date: most merchants have no website, and
FB's value is often a dead link) — today `formatBusinessProfile` (businessProfile.ts:42)
is the last spot where an UNCONFIRMED fb_sync value still reaches the prompt; website
joins the operational facts behind the confirmation gate, stated only when
merchant-confirmed or present in his own KB text, and gets no readiness-card weight.
And "no website" becomes an EXPLICIT one-tap state (owner: «لازم نعطي خيار انه لا يوجد
موقع الكتروني») — same third-state pattern as storefront/online-only and the B2-V2
delivery negative: stored as a confirmed fact, rendered as a confident negative
(«لا يوجد موقع إلكتروني — التواصل هنا مباشرة»), and the readiness card treats it as
RESOLVED, not missing. An empty field reaches the model as unknown and produces a
hedge; only a stored negative produces a plain, selling "no".
Also fix in the same work: the stale comment at
`pages.ts:1042` claiming the merchant half is editor-write-only (false since Option B).

## D-047 · Only the WhatsApp landing chip leaves the saturated-fill hover; the other five keep it despite measuring below WCAG AA
**Decided:** 2026-07-29 · **Status:** Active
The landing hero's platform chips flip to a saturated brand fill with white text on hover. That hover was measured against WCAG AA's 4.5:1 for its 14px bold label and fails on most chips: WhatsApp #25D366 **1.98:1**, Shopify #96BF47 **2.13:1**, Salla #2DC0C8 **2.21:1**, Instagram **2.77:1**, Zid **3.75:1**, Facebook **4.23:1**. Shopify (**2.00:1**) and Salla (**2.05:1**) also fail in the resting state, before any hover. Only the **WhatsApp** chip is changed — it deepens its tint on hover (`hover:bg-[#25D366]/25`) and keeps a dark `#075E54` label. The other five keep the fill hover as-is. A future pass must not "harmonise" WhatsApp back to the fill, and must not re-fix the other five without asking.
**Why:** Owner reported the hover as unreadable on the newly-added WhatsApp chip, which is also where the numbers are worst (1.98:1) and where two adjacent greens — WhatsApp #25D366 and Shopify #96BF47 — became indistinguishable once both were saturated blobs with vanishing labels. A same-day change extended the fix to all six chips (darker brand labels, tint-deepening hover); owner reviewed it and declined, keeping WhatsApp only. Accepted trade-off, stated plainly: five chips stay below AA on hover and two stay below AA at rest, and WhatsApp now behaves differently from its row neighbours. Rule 9 (WCAG 2.1 AA) is knowingly not met here — this is a deliberate aesthetic call on decorative, non-interactive (`cursor-default`) chips, not an oversight. Note Lighthouse CI cannot flag any of it: it audits only the resting state, so the hover failures are invisible to the accessibility gate that runs on `/landing`.

## D-048 · The reply prompt may only assert a language it positively detected; a floor read becomes a mirror-the-customer default, and accent-free French stays an accepted detection miss
**Decided:** 2026-07-29 · **Status:** Active
An Arabic-KB training institute on WhatsApp answered «Quels cours proposez-vous ?» in
English, while the English and Turkish messages in the same thread were both handled
correctly. Root cause was NOT detection: the detector returns **en@0.5** for accent-free
French — its "Latin script, recognized nothing" floor — and the per-call prompt asserted
that non-detection to the model as fact ("Reply language: English … **The customer wrote
in English.** Do NOT switch to another language"). The model identified the French
correctly and obeyed us anyway. Four rulings: (1) the hard directive is emitted ONLY for
a positive reading of the customer's current message; for a floor read / history anchor /
post / KB / merchant default the prompt keeps that language as the **default** but
instructs the model to mirror the customer's own language, because the model is a far
better short-text identifier than our heuristic. (2) Certainty is **derived inside the
shared resolve chain from `comment`**, never carried as a companion field. A
`languageCertain` boolean was built first and was silently dropped by four hops that each
rebuild the payload field-by-field (both axios bodies in backend `ai.ts`, both in
`ecommerceToolLoop.ts`, and the ai-worker's own `/generate` route) — unit tests injected
it and stayed green while production never saw it. Any future signal of this kind must ride
a field that provably survives every hop, or be derived at the point of use. (3) A
detector branch that names a language from **characters alone, with no word evidence**
carries `evidence: 'characters-only'` on `LanguageDetectionResult` and is therefore a
default, not an assertion. `ç` is shared by French, Portuguese, Catalan and Turkish, and
the char-only Turkish fallback runs before the French check, so «Combien ça coûte ?» scored
`tr@0.75` and was answered **in Turkish**. Turkish keeps Turkish as its default and the
model corrects it. This MUST stay an explicit field rather than a confidence threshold or
sentinel score: Arabic's `confidence` is a character RATIO (`دورة ICDL` reads `ar@0.545`,
and real traffic produces `ar@0.35` / `ar@0.03`), so a blanket `confidence >=
MIN_CERTAIN_CONFIDENCE` marks **441 rows of the 30-day corpus** uncertain and softens the
hard directive on the money path, while a reserved sentinel value can be hit exactly by a
ratio (11/20 = 0.55). The threshold therefore applies to `'en'` ONLY. (4) The reply
**validator** must agree with the directive it validated
against — `language_mismatch` is suppressed (log-only `mirrored_lang_switch`) when the
language was uncertain, or every correctly-mirrored reply would be marked `needs_attention`
and barred from the reply cache. **Accent-free French remains an accepted miss at the
detector layer** and must not be "fixed" by letting a statistical LID name pure-ASCII text:
that is where Arabizi lives, and Arabizi→Spanish is a far worse and far more frequent error
than French→English.
**Why:** Matches the industry standard (Intercom Fin, researched 2026-07-29): a
below-threshold read is labelled *undetermined* and falls through — never asserted as a
positive reading. Measured, not assumed: the floor bucket is **68.77% of Latin-script
inbound traffic** (7,880 of 11,459 messages over 30 days) and is mostly phone numbers,
`"12h"`, `"160 right"`, romanized Urdu and Tagalog — very little of it is English, so
asserting English was wrong for most of the bucket. The char-only ruling (3) was measured
the same way over a fresh 30-day corpus (**9,002 unique / 16,149 occurrences**): the
detector's `language` and `confidence` output is **byte-identical to before (0 flips)** and
only the certainty verdict moves, on **18 rows / 0.111% of traffic**.
Every flip was hand-checked: wins on `Française`, «Oui ça va mien et la famill ??»,
Portuguese `CONFIANÇA`, Tagalog, and an English shared-post that was being answered in
Turkish; the 8 genuinely-Turkish rows keep Turkish as their default. An earlier attempt
that **removed `ç`** from the branch was rejected by the same measurement — it regressed
`Ben Arapça bilmiyorum lütfen Türkçe yaz` to a *certain* `en@0.6` because the stray token
"on" matched an English stopword. Prompt version bumped to **v64**.
Related: the separate `LANG_ENGINE=tinyld` flag fixes *accented* French/Swedish/German and
is bounded (a 30-day corpus diff put the flip at **0.87%** of Latin traffic after gating
the override on zero English-stopword evidence — ungated it was 1.17% and included real
regressions: broken English at en@0.9 flipping to Slovak, Tagalog to Vietnamese, and
Tunisian Arabizi to French/Spanish through a single stray `é`/`où`). That flag must NOT be
flipped in prod until the gate is deployed, or the ungated override ships those
regressions.

## D-049 · Reply speed is the product: latency has a budget, and the budget is spent almost entirely on cache misses
**Decided:** 2026-07-29 · **Status:** Active
Jawab24's competitive lead is how fast it answers, so reply latency is now a governed
budget rather than an afterthought — see **Rule 17** in `AI_INSTRUCTIONS.md` for the
actionable rules (that file is the single copy; do not duplicate them here). The ruling
itself: optimisation effort on the reply path MUST be spent in proportion to measured
cost, and the measured hierarchy is brutally lopsided — a semantic reply-cache **hit**
returns in **milliseconds**, a **miss** is a **2–4 second** OpenAI call, one extra
sequential network hop is **1–50 ms**, and ALL local language detection / regex / string
work is **~4 µs**. Concretely: across the entire 30-day corpus (9,002 unique / 16,149
messages) the total added CPU of the D-048 certainty derivation is **64.6 ms** — about
**3% of ONE reply**, spread over a month. Therefore (1) cache-hit preservation outranks
every other latency concern, and `PROMPT_VERSION` must never be bumped "to be safe";
(2) synchronous, in-process detection is a hard architectural constraint, pinned by
`packages/shared/src/language/__tests__/languageLatency.test.ts`; (3) micro-optimising
microsecond CPU on this path is REJECTED when it costs a duplicated code path.
**Why:** Two rounds of pushback on a +4.26 µs/message regression prompted an actual
profile instead of an argument. The profile redirected the effort: `ENGLISH_COMMON` and
`SWEDISH_COMMON` were `Array.includes` scans (O(words × 58), ~870 string comparisons for a
15-word message) on a function that runs for every inbound message, comment and
template-language decision — converted to `Set.has`, worth **5%**, which also proved the
word lists were NOT the bottleneck (the Arabic global `match()` + Unicode `replace()` and
the ~10 script regexes are). That is the whole lesson: intuition picked the wrong target
twice, and only measurement found the real one. The performance guardrails deliberately
assert **structure** (not async, not network-backed, at most one detection pass per
resolve, linear not quadratic) rather than microsecond thresholds — an absolute µs budget
is machine-dependent, fails on a loaded CI box, and trains the team to ignore the suite.
**OPEN GAP (blocks claiming any latency win):** `messageProcessor.ts` laps all 16 pipeline
stages, but through `logger.debug` while production runs at `info` — `config.logLevel`
defaults to `'info'` and the server `.env` sets no `LOG_LEVEL`. Every reply-latency
timing is therefore **dark in prod**, so there is no p50/p95 for the metric the product
competes on. Fix that before optimising the pipeline further; local benchmarks cannot
tell you whether the lead is holding.

## D-050 · Long-tail knowledge reaches the model by FULL-KB injection on non-ecommerce pages (plus always-injected structured blocks) — supersedes the retrieval half of D-007; kb_facts Tier-2 RAG is retired unmerged
**Decided:** 2026-07-30 (recording a reversal that shipped incrementally; code-verified against main) · **Status:** Active
`resolveKnowledge` (backend `generator.ts`) gives non-ecommerce pages the **full KB text, always** — no retrieval, embedding, or chunk call runs on that path; RAG survives only for e-commerce pages whose product data lives in chunks. `KB_RAG_THRESHOLD_CHARS` is an emergency rollback lever, unset by default. Why the June ruling reversed: chunking a single-document KB can only DROP answer-bearing text (a short lexical query like «وين موقعكم» retrieves the wrong chunks and the address never reaches the model) — the false-denial cost outweighed the token cost, which the 16k `KB_MAX_CHARS` cap and KB prompt-caching bound. Consequences, all still in force:
- The `feat/kb-structured-facts` branch (kb_facts, Tier-2 retrieval lane) was **never merged and is retired**; its validated lessons (extractor consolidation, deterministic price-grounding) carry forward into the catalog/fact-collections extractors, not into a retrieval lane.
- Structured facts ship as **always-injected blocks**: the catalog block, the BUSINESS_INFO operational-fields block (D-007's Lane 1, unchanged), and fact collections with L2 deterministic row gating (D-047) — which makes prompt size independent of list size.
- D-009's core survives: no prices in the authoritative BUSINESS_INFO block; the price guard grounds against the KB text the model actually saw.
- The 16,000-char free-text cap is **not to be raised** (it is a per-reply cost forever, and engaged merchants already sit at 15.9k) — capacity pressure is relieved by moving enumerable data into fact rows, never by a bigger prompt.
- Older notes citing this ruling as «D-012» (a numbering slip in `.planning/` docs and session memory — repo D-012 is the Salla Easy-Mode decision) are corrected to D-050 as they are touched.

## D-051 · Facts the model must not judge are decided in code and enforced by what it is SHOWN — not by prompt rules

Owner ruling, 2026-07-28, after three measured attempts on the same defect (a reply
naming real outlets and placing them in a city that appears in no list — SYSTEM_ANALYSIS
gap 13, the BAMBO LIBYA العجيلات incident): «عم نضل نضيف قواعد على البرومبت وعم يكبر…
لازم نلاقي طريقة ما نحتاج خلص، متل داتابيز محفوظ فيها القيم الدقيقة وبس».

The evidence behind it, all from `scripts/place-fabrication-probe.ts` (48 absent-place
samples through the real reply path, judged by the shipped grounding verifier;
"controls" = a LISTED area and a real price, which must stay answerable):

| arm | absent-place | first ask | near-name | doubling down | controls |
|---|---|---|---|---|---|
| no mechanism | 9/32 (28%) | — | — | — | — |
| L1 derived coverage statement | 8/48 (16.7%) | 1/6 | 5/6 | 2/6 | 0/24 |
| + prompt rule "match exactly" | 8/48 | 1/6 | 6/6 | 2/6 | 0/24 |
| + computed match stated as a fact | 12/48 | 3/6 | 5/6 | 4/6 | 0/24 |
| **L2 row gating (shipped default)** | 12/48 | **0/6** | 6/6 † | 6/6 ‡ | **0/24** |

**The ruling.** Where a fact is decidable by code — "is what the customer named one of
this merchant's registered values?" is a string comparison — it is decided in code, and
the decision is enforced by CONTROLLING WHAT THE MODEL SEES, not by telling the model
about it. Both telling variants failed: the rule was neutral, and stating the computed
result made things worse (the model answered "yes, but I don't have the list"). Gating
the rows eliminated the first-ask class outright, because a model never given
«صيدلية السنونو» cannot place it anywhere.

† Under gating this class stops being a fabrication: no unmatched outlet name is named at
all. What remains is an unsupported availability inference about the business's OWN
address («سوق الثلاثاء هو عنواننا ومنتجاتنا متوفرة هناك») — a DATA GAP only the merchant
can close, and it is already on the question list for Feras («هل مقرّك نقطة بيع مباشرة؟»).
Converting a fabrication into a question the Business Surface can ask is the intended
direction, not a leftover.
‡ This probe injects an already-fabricated assistant turn into the history; gating leaves
the model no other names, so it defends the history. In production that prior turn is
what gating prevents (0/6 above), so the number measures recovery from a lie this mode
stops telling. Tracked by the shadow verifier; eval #737 stays `expectedFail` for it.
History sanitization is deliberately NOT built (it would touch every DM's history
rendering) until prod shadow verdicts show real echo cases.

**Binding constraints on any such deterministic output** (owner, same date: «بركي في
فعلاً صيدلية عنوانها سوق الجمعة — لازم تتأكد من قاعدة المعرفة قبل»):
1. A no-match may NEVER become "that place is not available". «سوق الثلاثاء» genuinely
   exists in the merchant's data — as the business's own address. The knowledge base stays
   in the prompt and answers for itself.
2. The derived coverage statement always renders, computed over EVERY live row, even when
   zero rows are printed — so the model still knows every area the list covers and a
   normalizer miss («الرمال» vs «حي الرمال») degrades to naming areas, never to a denial.
3. Under-answering beats misdirecting: the acceptable failure is "I can name my areas but
   not the shops", never "go to a pharmacy that isn't there".

**Ship-the-measured-improvement corollary** (owner, same date): a residual that no data
change can fix does not block a measured win. It ships with the number stated, the eval
case left red, and the shadow verifier watching — never with another prompt rule bolted on.

**Binding cache rule that falls out of this (review finding C1).** A reply whose list
rows were filtered to the customer's message must NOT enter or be served from the
SEMANTIC cache. That cache matches by embedding similarity, and «وين نلقاكم في تلة
الريح؟» vs «… في عين الدالية؟» sit far inside the 0.91 LOCATION threshold — a hit would
return one area's REAL outlets under another area's name, i.e. manufacture the exact
defect gating removes. `context.factCollectionsGated` therefore skips the semantic cache
on both read and write (read too, so entries written before this guard cannot be served).
The exact-text cache is untouched: identical text matches identical rows. Anyone
"optimizing" cache hit-rate on pages with collections must not undo this.

Rollback lever: `FACT_LIST_MODE=list` restores the pre-gating behaviour in one env var.

<!-- Appendix to D-047, added the same day: measured interaction with an in-flight
     prompt change from a parallel session. Recorded here because whoever ships
     either change needs to see it before choosing a PROMPT_VERSION. -->

### D-047 addendum · the G1a block and the "no-answer wording" prompt change conflict on the listed-area answer

Controlled same-day A/B at temp 0 (this work stashed in one arm, nothing else changed)
showed **no regression from G1a**: baseline 97.3% (401 PASS / 17 PARTIAL / 3 FAIL) vs
G1a 97.3% (401 / 17 / 3), with an IDENTICAL fail set (#511, #544, #720) — all three
predate this work and two of them (#511, #544) appear only with the parallel session's
`systemPrompt.ts` change loaded, which is the arm's constant.

Then a 2×2 probe on eval #729 — the listed-area control, «أنا ساكن في عين الدالية، وين
نلقى منتجاتكم؟», which MUST name that area's pharmacies:

| ai-worker prompt | rows | result |
|---|---|---|
| main | in `<business_lists>`, gated | names the area's pharmacies 3/3 ✅ |
| main | in `<business_lists>`, ungated | 4/4 ✅ |
| main | in KB prose (pre-G1a fixture) | ✅ (eval baseline arm) |
| **+ no-answer-wording change** | in `<business_lists>` | **4/4 answers with the shop ADDRESS instead ❌** |
| **+ no-answer-wording change** | ungated | **4/4 ❌** (so it is the block-vs-prose difference, not the gate) |

Neither change is defective on its own; the pair is. Do not ship them under one
PROMPT_VERSION and do not eval them separately and assume the sum — the eval suite scored
97.3% in both arms while this case was broken in one of them, because a single sampled run
of one case cannot see a 4-of-4 behavioural flip. Required before either merges: run the
full suite AND the place battery with BOTH changes loaded, and settle the version numbers
(v62 was taken for G1a, v63 for the wording change).

> **Numbering note (2026-07-30):** this ruling was authored as D-047 on the `feat/g1a-business-lists-wiring` branch while `main` independently appended a different D-047 (landing chip hover). Renumbered to D-051 on merge — the ruling itself is unchanged. Older references to "D-047 row gating" in `.planning/` and PR text mean this entry.

## D-052 · The catalog is for transactable inventory; fact_collections is for published reference lists — priced or not. Courses/schedules go to fact rows, superseding the G3 "catalog items with dates" path

Owner ruling, 2026-07-31 («تمام فينا نكمل معناتا بالخطة», approving the 07-31 rethink in
`.planning/BUSINESS_SURFACE_PLAN.md` §«2026-07-31 RETHINK»).

**The boundary, restated.** The original two-store wording ("catalog = sale items,
fact_collections = every enumerable list that is not sold", schema.ts comment above
`factCollections`) stopped matching reality when the sizes slice (#551) put BAMBO's
PRICED size/price table into fact rows — a measured win. The discriminator is not
"is money involved":

- **`catalog_items` = per-item transactable INVENTORY** — things a customer orders,
  with an availability lifecycle, images/cards, e-commerce store sync, and the B0
  reconcile/import machinery. Its renderer semantics fit shop shelves: per-item
  emphasis, truncation tolerated (drop descriptions, "+N more").
- **`fact_collections` = published REFERENCE TABLES the model must quote exactly and
  exhaustively** — outlet directories, size/price tables, course schedules, delivery
  zones. Completeness semantics are the point: the derived coverage/absence statement
  (D-051), no "NOT exhaustive" tail, expired rows excluded in code.

**One entity, one home** (D-039 extended to lists): a course's price, schedule, and
modality live together in ONE fact row — never price in the catalog and schedule in a
row. A migration must never leave the same fact in both stores.

**What this supersedes.** The plan's G3 note ("courses + schedules as catalog items
with dates/attributes — the #691 path") and B0.5's catalog-import script for الفريق
الدمشقي. Evidence that path was wrong for lists, all pre-existing: the catalog renderer
was REJECTED as a list home when the engine was designed (stamps "price on request — in
stock" on non-sale rows; overflow appends "this list is NOT exhaustive" — the opposite
of list semantics); its degradation drops DESCRIPTIONS first, which is exactly where
schedules would live; and 51 courses sit at the block's truncation boundary. The
engine's date machinery (`startsAt`/`endsAt`, query-time expiry exclusion,
`factCollections.ts:159`) shipped in #528 — schedules need data, not new code.

**What this does NOT change.** The B0 reconcile/import machinery and the catalog remain
fully valid for product merchants (posts-scan, post-reply mining, store sync); B0.5's
question ("0 → confirmed on a phone in <5 min") is answered on the fact-row review
surface instead, and the catalog flow gets its pilot with a PRODUCT merchant later.

## D-053 · Zid is rebuilt against the docs-verified contract (dual-token auth, /v1/managers endpoints, Basic-auth webhooks); D-020's live round-trip gate still stands

Engineering ruling, 2026-08-01 (owner directed "rebuild now, validate when the Partner
account exists"; contract verified against docs.zid.sa the same day — branch
`feat/zid-rebuild`).

**What changed.** The D-020 defects are fixed at the root, not patched:

- **Dual-token auth.** Zid's token response carries TWO credentials: `access_token`
  (sent as `X-Manager-Token`) and `Authorization` (sent as `Authorization: Bearer`).
  The second one is now persisted in dedicated encrypted columns
  (`authorization_token`/`_iv` on `ecommerce_stores` AND `pending_ecommerce_installs`,
  migration `0146`) — rejected alternatives: plaintext in `platformData` jsonb (breaks
  the crypto invariant) and a JSON blob inside the accessToken ciphertext (breaks every
  shared decrypt path). Shared plumbing (`OAuthTokenResponse`, `createStore`,
  `updateStoreTokens`, pending installs, claim ctx, token refresher,
  `ecommerceApiGet extraHeaders`) widened with OPTIONAL fields only — Salla/Shopify
  behavior unchanged.
- **Basic-auth webhooks replace the invented HMAC.** Zid authenticates deliveries with
  the `username`/`password` pair set at subscription time (`Authorization: Basic …`);
  there is no `x-zid-signature`. Verification is timing-safe
  (`utils/basicAuthVerify.ts`); `ZID_WEBHOOK_SECRET` is reused as the password with a
  fixed code-constant username, so the env surface barely changes. New `ZID_APP_ID`
  env (the subscription body's `original_id`) is prod-required alongside the secret.
- **Real endpoints + events.** `/v1/managers/account/profile`,
  `/v1/managers/store/orders`, `/v1/products/` (dual headers + `Role: Manager`);
  events `product.create/update/publish/delete`, `order.create`,
  `order.status.update` (status code `indelivery` → shipped, `delivered` → delivered).
  Uninstall = the Partner-Dashboard-configured `app.market.application.uninstall`.
  Dead `ZID_SCOPES`/`SALLA_SCOPES` env vars removed. Product cap now derives from
  `PRODUCT_SAFETY_CAP` (the silent 300-product truncation is gone).

**What this does NOT change.** D-020's gate is untouched: Zid stays dark
(`ZID_CLIENT_ID` unset in prod, `coming_soon` badge on the integrations page) until a
REAL dev-store round-trip passes. Payload-shape parsers are explicitly `[provisional]`
(tests carry the marker in describe titles) because no live capture exists yet — the
webhook delivery envelope, products/profile envelopes, orders search params, and
refresh rotation of the `Authorization` token are all confirmed during live validation
(checklist in `docs/integrations/zid.md`), which is blocked on the founder's Zid
Partner signup (partnership agreement + dev store).

## D-054 · Shopify billing = App Pricing mirrored by verify-and-reconcile — one sync choke point, no webhook dependency, no Stripe beside it

Engineering ruling, 2026-08-01 (implements the owner's 2026-08-01 decision that the
public Shopify listing uses Shopify App Pricing — Shopify forbids off-platform billing
for listed apps; branch `feat/shopify-billing`). Condensed from design rulings D-A…D-J
in `~/.claude/plans/make-a-worktree-and-calm-avalanche.md` §Track 2.

**The shape.** Shopify owns the money and delivers NO webhook for App Pricing
enrollments (post-2026-04-28 apps). Our side therefore MIRRORS, never listens:
`syncShopifyBilling(shopDomain)` (services/shopifyBilling.ts) is the single idempotent
choke point that asks the Admin API (`currentAppInstallation.activeSubscriptions`) what
is true and reconciles the local row. Three triggers, all funneling into it: the
configured billing **return endpoint** (`GET /shopify/billing/return` — `shop`/
`plan_handle` query params are UNTRUSTED triggers, nothing activates from them), the
**post-claim hook** (installs claimed at login), and the **6-hourly reconciler** (the
authority of last resort; also flags orphaned live mirrors whose store row vanished).

**Rulings.**
- Discriminator: `subscriptions.payment_method='shopify'` + AppSubscription GID in
  `external_subscription_id` + new `shopify_shop_domain` column (migration 0147).
  Uniqueness = ONE NON-CANCELED shopify mirror per shop (partial index; canceled rows
  excluded so an uninstalled shop stays adoptable by another workspace — a full-scope
  unique index would deadlock that forever). CHECK: a shopify row must carry its domain.
- Plan identity: App Pricing plan HANDLES are our plan slugs verbatim; the Admin API's
  display name maps through `config/shopifyBilling.ts`. Unknown handle/name → NO
  activation, loud Sentry (never guess a paying merchant onto a plan).
- Entitlement subject: the WORKSPACE OWNER (the `hasWhatsAppPlanAccess` pattern), not
  the member who connected the store.
- Expiry is reconcile-driven; the manual-midnight rule (D-023) does NOT apply
  ('shopify' ≠ 'manual'); the 3-day past_due grace absorbs a late sweep; a shopify
  lazy-expiry Sentry canary sits beside the Stripe one.
- Uninstall webhook cancels the local mirror (closes the D-023-class hole where a paid
  local sub outlived the app), keyed by shop domain so it works regardless of store-row
  state; `gdpr/shop/redact` repeats the cancel as a second provably-post-uninstall
  signal (idempotent — covers a missed uninstall delivery). Trials mirror Shopify's
  clock (trialDays) and bypass the Stripe trial ledger.
- No Stripe beside Shopify — on EVERY Stripe surface, server-side: checkout session,
  subscription intent, change-plan, top-up intent, cancel-subscription, and billing
  portal all reject shopify-billed accounts with 400 `SHOPIFY_BILLED` (a hidden CTA is
  never the enforcement). The top-up CTA is hidden and the pricing page routes plan
  management to the admin deep link
  (`admin.shopify.com/store/{store}/charges/{app_handle}/pricing_plans`,
  `SHOPIFY_APP_HANDLE` env). A CANCELED mirror is exempt everywhere — the backend guard
  and the frontend signals alike (suppressed at the `getUsageSummary` choke point) — so
  a merchant who uninstalled the app can come back through Stripe.
- Adoption refusals (all Sentry + stand down, a human decides): over a LIVE
  stripe/manual/paypal row (double-billing risk), and over a live shopify mirror for a
  DIFFERENT shop — two active stores on one workspace would otherwise ping-pong the
  mirror and reset the quota window every sync. The Stripe rail carries the symmetric
  guard: `adoptStripeSubscription` never overwrites a live shopify mirror.
- Store-connect plan-gating is deliberately DEFERRED: gating connect on a plan would
  break the reviewer-walked install funnel; revisit after listing approval.

**Verify-first caveat (V3).** Whether `activeSubscriptions` reflects App Pricing
enrollments is unverified until the dev-store dogfood; the fork is isolated inside
`fetchShopifyActiveSubscription` — if it proves wrong, its internals swap to the
Partner API with zero caller changes.

---

## D-055 · A guard may withhold an answer; it must never invent a different one

Engineering ruling, 2026-08-02 (PR #604, branch `fix/check6-exhausted-strip-hold`).

**The rule.** When a reply-path guard rejects the model's output, its only sanctioned
outcomes are *send less* or *send nothing*. Substituting text the guard authored is
forbidden. A guard knows what is wrong with a reply; it does not know what the customer
asked, so anything it writes is a non-answer that also blocks the retry from being
different.

**The evidence.** Check 6 (`stripSelfIdentification`) used to swap a random
`SELF_ID_FALLBACKS` identity line in whenever stripping left <10 useful characters.
Every line in that pool answers "who am I talking to?", so on the Jawab24 support page
(prod, 2026-08-01) «موقعكم الالكتروني» was asked four times and deflected four times
with «معك أحد أعضاء الفريق…». Two more prospects hit it the same day. The pool is
deleted: an exhausted strip returns an EMPTY reply plus
`self_identification_exhausted`, and both pipelines flag the row
(`held_self_identification`) so the merchant answers personally.

**Three consequences, each learned the hard way in review of the first attempt:**

1. **An empty reply is not self-describing — never branch on `!reply` alone.** On the
   worker→backend boundary `reply: ''` means three different things: intentional
   silence (OFFENSIVE / SPAM_OR_IRRELEVANT), a deliverable HOLD (this flag), or a
   generation failure. `openai.ts`'s empty-reply guard is the SINGLE arbiter and must
   consult `isHeldEmptyReply(flags)`. The first attempt shipped without it: the guard
   threw `AiEmptyReplyError` before the flag crossed the wire, so both pipelines' hold
   branches were unreachable on the default-model path — i.e. all of production — and
   the fix was inert while its tests, and the eval, were green. **A new flag is only
   real once a test crosses the boundary it must survive.**
2. **Withholding is not "replied".** A withheld row is flagged (`flagMessage` /
   `flagComment`), never `markAsReplied('')`: a false `replied`/`repliedAt` reports a
   response time for a customer who never got one. This also declines to store a draft
   — the pre-strip text IS the automation reveal, and the held-reply UI pre-fills the
   merchant's composer from `aiOriginalReply`, which would leave the forbidden line one
   tap from the customer.
3. **Withholding OUR reply must not discard THEIR data.** Lead capture lives on the
   send path, so every early return has to carry it explicitly or the customer's phone
   number is lost outright.

**Scope.** The rule binds every reply-path guard, not just Check 6. The price guard
(eval #544 — a correct SYP redenomination replaced by «تواصل معنا» at the moment of
sale) is the same defect and is expected to be fixed the same way.

---

## D-056 · The business surface opens to the founder-team workspace ahead of GA

**Decided:** 2026-08-03 · **Status:** Active

`isCatalogVisible` (frontend/src/lib/featureFlags.ts) = platform admin **OR** member of
the founder workspace `a0005407-92bf-473e-9368-013f14c57a7d` (owner ruling: «لفريق
وركسبيسي بس»). The /business page, its nav entry and the KB→catalog import CTA become
visible to the founder's own team for production dogfooding; every other merchant stays
gated exactly as before. Backend authz is unchanged — catalog/fact writes remain auth +
workspace-admin gated server-side; the flag only reveals UI. **GA remains a one-line
deletion of the workspace allowlist.** Widened from the platform-admin canary
(2026-07-11 ruling «keep it dark, but admin so I can test») as the next step of the same
rollout path; pinned by `featureFlags.catalogGate.test.ts` (admin passes, founder-team
member passes, everyone else — including null user / missing workspaces — stays gated).
Shipped in #582 alongside the G1b editor polish marathon. Numbered D-056 to fill the
gap #612 left when it recorded D-057 directly after D-055.

---

## D-057 · A dated fact row's START date owns its visibility; the end date is descriptive

Owner ruling, 2026-07-31 — «تاريخ النهاية لا يجب أن نعتمد عليه». Implemented in
PR "feat(facts): start-date visibility rule" (branch `feat/fact-start-date-engine`).

**The rule.** A `fact_rows` row that carries a `starts_at` leaves the prompt the day
AFTER that date. Its `ends_at` is not consulted. A row with no `starts_at` keeps the
old behaviour: it lives forever unless an `ends_at` has passed. `ends_at` remains
printed for the customer — it stopped governing visibility, it did not stop being
shown.

**Why.** An announced cohort that has already begun is stale the moment it starts,
whatever its end date claims. The merchant announces «تبدأ الدورة ١ سبتمبر»; on
2 September that row is no longer an offer, it is a record. Keying visibility on the
end date kept it in the prompt for the whole run of the course, which is precisely the
v38 stale-date class the dated columns exist to kill.

**Scope — this DIVERGES from `catalog_items`,** which keeps the end-date rule. The
divergence is deliberate: a catalog item is a thing you can still buy until it expires;
a dated fact row is an announcement that goes stale at its start.

**One definition, three consumers.** The rule is `isRowLive` in
`@jawab24/shared/factSchedule` — imported by the backend renderer and by the merchant
editor. The third consumer is the SQL `WHERE` clause in
`buildFactCollectionsContext`, which cannot import it, so the two are pinned by the
contract test *"isRowLive — SQL and TS agree over the full date matrix"* in
`backend/test/integration/factCollections.test.ts`. That test was verified to FAIL when
the SQL is reverted to the old rule. **Do not add a fourth hand-written copy.**

**Deploy safety.** Behaviour is unchanged for every row that exists today: the
one-date-field editor wrote `starts_at === ends_at`, and for that shape — and for
undated rows — the old and new rules agree exactly. This is pinned by executable tests
(`packages/shared/src/__tests__/factSchedule.test.ts`) rather than asserted in a PR
body, and by a renderer-level byte-identical case. The divergent shape
(`starts_at !== ends_at`) is only reachable once an editor can author it, which is a
LATER PR — deliberately not this one, so this change is provably inert on deploy and
safely revertible.

---

## D-058 · A confirmed fact retires the line that contradicts it — at the moment of confirming, not at the next catalog import

**Decided:** 2026-08-03 · **Status:** Active · Closes the C-FINAL item (owner ruling
2026-07-26: «but i want this issue to be solved at the end»)

**The defect (eval #720).** A merchant confirms «حي النسيم» in `/business` while their
Business Info still reads «📍 الموقع: … حي العزيزية». Asked «وين موقعكم؟», the assistant
answered the STALE address at **high confidence** — the worst shape a wrong answer takes:
specific, actionable, and unflagged.

**Prompts cannot arbitrate this, and the reason is mechanical — not a matter of wording.**
The BUSINESS_INFO block's conflict sentence is outranked by five rules in
`STATIC_SYSTEM_PREFIX` that name `<business_knowledge>` the only factual source, including
the MANDATORY FINAL SELF-CHECK which orders the model to REMOVE any claim absent from it.
So the model deletes النسيم and keeps العزيزية — correctly, by its instructions. Two
attempts (explicit conflict wording, then bilingual field labels) died on this. A third is
possible only as surgery on the shared prefix plus a `PROMPT_VERSION` bump, which retires
the entire semantic reply cache (Rule 17.1). **Do not re-propose a block-wording fix.**

**The ruling: the contradicting line must never reach the model.** The cleanup machinery
(`matchStructuredFieldLinesInKb` → `POST /pages/:id/kb/cleanup` → `KbCleanupSheet`) shipped
in Phase C but hung off ONE trigger — after a catalog import. A merchant who never imports
was never offered it, so the stale line survived forever. The trigger now also fires where
the conflict is actually created: **after a fact save succeeds in `/business`**. Confirming
a fact is precisely when to ask about the line that disagrees with it. D-038 discipline is
unchanged — field lines arrive UNCHECKED, the merchant confirms, nothing is auto-deleted.

**Two things this exposed, both load-bearing:**

1. **The matcher was blind to the label merchants actually use.** «موقع» had been excluded
   outright because «الموقع الإلكتروني» means *website*, so `📍 الموقع:` matched nothing —
   the feature would have shipped as a NO-OP on the very line it exists for. The label is
   admitted and disambiguated per line by website evidence (`الكتروني`/`www`/`http`/`com`);
   unambiguous labels («عنواننا») are never subject to that veto. **An exclusion that makes
   a feature silently propose nothing is worse than the false positive it prevents** — the
   sheet only ever proposes, and every proposal is confirmed by a human.
2. **Both triggers now share one predicate** (`hasFieldLinesToClean`). Two call sites
   spelling out the same question is how one of them ends up never firing — which is the
   whole of this bug.

**The eval stops testing the unfixable.** #720 as written pinned the prompt path, so it was
red forever, and a permanently-red test trains people to ignore red. The moto fixture now
models the merchant who ACCEPTED the cleanup: no address in the KB, so #720 asks the honest
remaining question — is the confirmed field answered from at all? The *conflict* is pinned
one layer down, in `catalogKbMatch.test.ts`, which asserts the matcher PROPOSES that exact
line. The catalog conflicts (#717–#719) are untouched — they test a path that DOES work.

**Still open (C-F2):** ~7 live pages measured 07-23 already hold a disagreement. They do not
self-heal — this fires on the next fact edit. A read-only report, then a per-merchant
decision. **Never auto-delete a merchant's Business Info line from a script.**

## D-059 · One page scan: posts + configured Post Replies merged, replies ageless, degradation honest

**Decided:** 2026-08-04 · **Status:** Active · Owner-proposed («البوست ممكن يكون معه رد
بوست هدول التنين غالبًا بيكون منتج كامل مع سعر — منعملهم سكان مع بعض») after ruling the
catalog section «غير مفيدة حاليًا»; refined in review.

**The insight is the merchant's own publishing pattern.** A post names the product and
deliberately withholds the price («علق بنقطة»); the configured Post Reply is where that
price actually lives. Scanned separately (the pre-D-059 shape: `scan-posts` +
`scan-post-replies`, two near-identical «منشوراتك» buttons), each source proposed HALF an
item — priceless names from posts, and a second pass over replies that re-proposed the
same products for reconcile. Merged, a post + its reply is ONE complete proposal: name
from the post, price from the reply.

**The rulings:**

1. **One scan, one button** («استخراج منتجاتك من صفحتك»). The `scan-post-replies`
   service method, UI button, and `replyScan.*` i18n are REMOVED. Both PATHS stay:
   `catalog/scan-posts` is the scan's endpoint, and `catalog/scan-post-replies` remains a
   deprecated ALIAS of the same unified scan — app builds shipped between B0 (#492) and
   this merge (2.0.23 included) bundle the reply-scan button, and removing the route
   would 404 it on every installed copy. Old clients read the shared response fields and
   render normally. Drop the alias once no supported app build ships the button.
2. **Cut images, not posts.** The owner's first instinct (window 25 → 10 posts) was
   redeclined: the Graph call costs the same regardless, the real spend is Vision, and a
   smaller window worsens the unreachable-history gap. Instead a replied post *with its
   own text* spends ZERO image budget — the budget goes to the posts that still need OCR
   to be identified. A text-less replied post keeps its images (the name may only exist
   in the photo).
3. **Replies are ageless.** They live in our DB (free — no Graph, no Vision), so they are
   read on EVERY scan regardless of the 25-post window and the bookmark. This recovers
   the highest-signal slice of old history: exactly the posts the merchant bothered to
   configure a reply for. Re-proposals are absorbed by the review sheet's reconcile
   (D-038); reply price *changes* surface as update conflicts — that is a feature, offers
   rotate. **And replies win the input budget** (review finding): standalone reply blocks
   go FIRST in the 16k extractor input, ahead of post blocks — appended last, a heavy OCR
   window silently pushed every one of them past the cap on exactly the flagship page
   shape. Dropped input now raises `truncated`, and `repliesScanned` counts only replies
   that actually reached the extractor.
4. **Degradation must be honest.** `getPagePosts` is fail-soft, and the old scan read a
   Graph error's empty page as «كل شيء محدّث» — telling the merchant to go post something
   while their token was the broken thing. The scan now distinguishes: blocked page with
   replies → replies-only scan (`postsUnavailable: 'disconnected' | 'noFacebook'`),
   transient Graph failure → `'graph_error'`, and «up to date» is only claimable after an
   ACTUAL successful posts read with nothing new AND no replies. Only a page with neither
   source still 409s. The bookmark never advances on an unread window.
5. **Show the numbers.** The review states what was read («قرأنا: N منشور · M ردّ بوست») —
   the bounded window stops being a mystery the merchant misreads as «it read my whole
   page».

**Still open, deliberately:** older posts beyond the newest-25 window remain unreachable
by scan (paste import is the fallback); videos/reels are not read; every scan re-runs the
reply extraction (bounded by the 10/day cap — revisit only if cost data says so).

---

## D-060 · A scheduled post's trigger is armed on trust, verified by Graph, and its failure is told to the MERCHANT — not just to Sentry

**Date:** 2026-08-04 · **Context:** PR #631 (arm a Post Reply before the post goes live)

Facebook owns the post id and does not guarantee a scheduled post publishes under the id
we armed. That cannot be prevented from our side, so the feature ships with detection —
but a review of the first cut showed detection alone is not enough, and the shape of the
detection matters more than its existence.

1. **The scheduled edge is an OPT-IN, not a widened default.** `GET
   /pages/:id/published-posts` gains `includeScheduled=1` rather than simply returning
   pending posts to everyone. The mobile app ships its own frontend bundle
   (`android/app/src/main/assets/public`), Play users sit on older versions indefinitely,
   and an old bundle renders a pending post as a published one with no date — letting a
   merchant arm it with no notice that it isn't live. Widening a list response is not
   backwards compatible when the client is a shipped binary.
2. **An overdue marker is not evidence of drift.** The likelier cause is a publish webhook
   we never received (page momentarily disconnected, Meta exhausting its retries). The
   first cut alarmed on the marker alone, which meant one missed webhook would fire the
   alarm on every subsequent publish on that page, forever, with nothing able to clear it.
   Overdue markers are now re-checked against Graph (bounded, `SCHEDULED_MARKER_RECHECK_MAX`):
   published → heal the marker and stay silent; unknown → stay silent; still pending past
   its own time → *that* is drift.
3. **Pending-ness is which EDGE the post came from, not whether a timestamp is present.**
   `isScheduled` is carried explicitly. Graph can return a pending post with no
   `scheduled_publish_time`, and inferring "published" from the absent field renders it as
   live with no date and no warning — the exact misreading the feature exists to prevent.
4. **The alarm goes to the person who can act.** Sentry reaches us; only the merchant can
   re-arm the post, and an orphaned trigger is indistinguishable from a working one in
   their UI. Drift now also sends the `post_reply_orphaned` notification. Sentry
   fingerprints are per-page — one global fingerprint collapses every merchant into a
   single issue, so muting one merchant's drift hides all of them.
5. **A knowingly incomplete list must say so.** A failed Graph read degrades to an empty
   edge, which reads as "you have no scheduled posts"; a full edge reads as "that's all of
   them". Both now set `partial` on the response and the picker states it. Same principle
   as D-059.4 — degradation must be honest.

**Also settled here (Critical review finding):** `findOrCreateFromWebhook` is on the
per-comment reply path, so widening it to throw was an outage vector. A conflicting row
with `page_id IS NULL` belongs to no workspace and is now ADOPTED rather than rejected —
`posts.page_id` is nullable and was only ever required by DTO convention, so rejecting it
would have thrown on every comment for that post, forever. A row genuinely owned by
another page still throws `PostNotOwnedError`, which `commentProcessor` now handles
explicitly (counted as `content_not_owned`, captured with its own fingerprint) instead of
letting the comment vanish through the generic catch.

**Still open, deliberately:** whether Facebook fires `item=post, verb=add` when a
*scheduled* post publishes is unverified against a live page. The Graph re-check makes a
missed webhook self-healing rather than a permanent false alarm, so the feature is safe
either way — but the live run is still owed before the drift alarm's rate can be trusted
as a signal.

## D-061 · A trial ends when the trial ends: no inherited grace, and the merchant is told proactively

**Date:** 2026-08-04 · **Context:** live merchant (43ed5bdc, «مزة جبل 86 نيوووز») kept
replying 4 days after the free month; 760 AI replies + 16 template replies leaked

The trial expiry chain was: `trial_ends_at` passes → `getUserSubscription` lazily flips
`trialing → past_due` → the `past_due` branch of `checkSubscriptionStatus` grants
`current_period_end + 3 days` grace. The grace exists for an external processor's
payment-retry cycle (declined card, bank flag). A trial has no payment to retry — but the
flip landed it in the same bucket, so **every** expiring trial structurally got ~4 free
days (`trial_ends_at` → `current_period_end` ≈ 1 day, then + 3 days grace).

1. **Grace is for retries, and only retries.** `checkSubscriptionStatus` now hard-stops a
   trial-origin subscription (`payment_method IS NULL`, `trial_ends_at` set, status
   `trialing` or `past_due`) at `trial_ends_at`. Externally-billed `past_due`
   (Stripe/Shopify) keeps the 3-day grace — including a converted trial whose renewal
   later bounces (`payment_method = 'stripe'` even when `trial_ends_at` is set).
2. **The block must be told, not discovered.** `auto_reply_paused_billing` is reactive —
   it fires on the next inbound customer message, so a merchant nobody writes to is never
   told. The daily cron now runs a second sweep (`runTrialEndedNotices`): once
   `trial_ends_at` passes, the merchant gets a one-time `trial_ended` in-app notification
   + bilingual "last try" email (deep link `/pricing`), stamped in
   `subscriptions.trial_ended_notified_at` (migration 0152).
3. **No backfill, same ruling as the reminder (2026-07-31).** The sweep's lookback is
   bounded (`ENDED_LOOKBACK_DAYS = 3`), so the ~30 long-expired `trialing` rows are never
   emailed retroactively — they hard-stop silently under (1), and anything expiring from
   now on is noticed within one daily run.
4. **Top-ups stay honored where they always were.** `canUseAiReplies` still falls through
   to top-up balance after a status block; the auto-reply gate (`canAutoReply`) never
   consulted top-ups for any expired state, and this change keeps that boundary unchanged
   for trials rather than widening it.

## D-062 · Row gating narrows below the key, and a value may only constrain the rows its own key match reaches

**Date:** 2026-08-06 · **Context:** الدمشقي, shadow-verifier flag 2026-08-05 21:06 UTC —
the customer asked for the انكليزي **مبتدئ** cohort, whose slots D-057 had retired, and
got متوسط 1's row verbatim (start date + days + time, all three) with the level swapped

D-051 settled that facts the model must not judge are decided in code and enforced by what
it is SHOWN. This extends the same mechanism one granularity down, and records the two
measured negative results that bound it — both of which cost a real measurement to learn
and would otherwise be re-proposed.

1. **The key gate bounds MEMBERSHIP, not identity.** The coverage statement is keyed on
   «الدورة», so it *asserts* انكليزي is covered; what the customer asked for was missing one
   attribute below the key. Row gating therefore also narrows by non-key attribute values
   («المستوى»), derived from the merchant's own rows — no new column, nothing to declare.

2. **Prose for this was measured and REJECTED.** A derived record-integrity clause (each
   row is one record, values may not move between rows, a combination no row carries is
   not in this list) moved the defect 6/8 → 5/8 = NEUTRAL — the same verdict as the
   near-name rule (8/48 vs 8/48). Do not re-propose it, and in particular do not bump
   `PROMPT_VERSION` for it: that retires the entire semantic reply cache (Rule 17) for a
   change that does nothing.

3. **The constraint is evaluated PER ROW, never per collection.** "Does this list use
   «المستوى»?" is true for the schedules list because its English rows carry levels, so
   «بدي ICDL وأنا مبتدئ» filtered out every ICDL row — none of which carries a level at
   all — and denied five real upcoming cohorts (0/6 vs 8/8 on probe C7). A row that does
   not carry the constrained label is UNCONSTRAINED on that axis, never withheld.

4. **A value may only constrain rows its own key match REACHES** (added 2026-08-06 after
   external review, before merge). The constraint vocabulary is built page-wide on
   purpose — «محادثة» is priced but never scheduled, and that asymmetry is what makes "no
   announced cohort for this level" derivable — but applying it page-wide is a
   false-denial machine. «متقدم» and «محترف» are levels of the BARBERING and accounting
   price rows and of nothing English, yet «ايمتا تبدأ دورات الانكليزي؟ أنا متقدم» withheld
   all **nine** live انكليزي cohorts and answered that there were no announced dates. A
   matched value now survives only if some row that stores it is reached by the customer's
   key match (its name + values contain a matched key value) — decided per VALUE by where
   it is stored, never per list, so §3 stands unchanged.

5. **Letter-free values need a token boundary.** Slot times are stored as «2-4»/«1-2», and
   bare containment finds them inside any digit run: «رقمي 0932-4567» matched «2-4» and
   withheld every differently-timed cohort. Because `composeFactMatchText` feeds the
   matcher the conversation's earlier USER turns, one phone number poisoned every later
   question in that thread. The boundary applies ONLY to needles with no letters — Arabic
   glues its prefixes, so «عين الدالية» must keep matching inside «بعين الدالية».

**The standing lesson, from §4 and §3 together:** a narrowing constraint fails in the
expensive direction. Borrowing produces a wrong answer the merchant can see; a false
denial produces a *plausible* answer and loses the registration silently. Any change here
must be measured against a control that has live rows, not only against the defect.

**Not in scope, deliberately:** detection. The illegal-join validator — for every pair of
stored values appearing in one reply under different labels, assert some single row holds
both — needs no model call and is the natural next step.

---

## D-063 · The commenter may be @-mentioned in the public comment — per post, Facebook-only, and verified after every first attempt

**2026-08-07.** Post Reply gains a per-post «الإشارة إلى العميل» toggle next to «الإعجاب
بتعليق العميل», default off, shipped fleet-wide on a paying merchant's formal request.

This REVERSES the 2026-07-19 ruling that skipped tagging. That ruling rested on three
reasons; one was simply wrong and is corrected here:

- ❌ *"the FB API restricts page→user mentions"* — it does not. `POST /{comment-id}/comments`
  with `message: "text@[PSID]"` is documented, needs `pages_manage_engagement` +
  `pages_read_engagement` (both already held), and the PSID is the comment's `from.id`,
  which the webhook already gives us. No new hop, no new permission, no cache impact.
- ✅ *redundant with the reply notification* — still true, and now quantified (below).
- ✅ *automated mentions read as spam at volume* — still true; bounded by per-post opt-in
  plus the existing any-comment cap.

**The measurement that argued against it, kept on the record.** Over 120 days of production
Post Reply DMs (`reply_method='post_reply'`, ≥48h maturity, "answered" = any inbound within
7 days): cold recipients — no prior inbound, so the DM lands in Message Requests — answered
**15.7%** (n=10,940) against **24.6%** for warm ones (n=1,285). The intended dual-vs-private
comparison does not exist: 10,693 of 10,940 cold sends are `dual`, none `private`. So a
public pointer to the DM is ALREADY present on virtually every send, on top of the reply
notification Facebook itself fires — and 84.5% still never answer. A mention is a fourth
signal of the same kind, not a missing channel. It was shipped as a merchant-requested
option, not as a conversion lever, and must not be presented as one.

**Privacy is explicitly NOT a reason against it** (raised in review, withdrawn): the
commenter's name and profile link are already on their own comment in the same thread, our
reply already sits under it, and a comment mention creates no timeline story. It adds a
notification, not a disclosure.

**The engineering constraint that shaped the design.** Meta requires the page's «Others
Tagging this Page» setting for the tag to render, and exposes NO way to read it. Measured
on a live page: `/{page-id}/settings` returns 13 settings (`USERS_CAN_TAG_PHOTOS` is about
tagging people in the page's photos, not this), `are_tagging_others_allowed` is not a field,
`?metadata=1` introspection is disabled on v23.0, and page history yields nothing — 0
page-authored mentions across 902 comments on 3 live pages. Therefore:

1. The capability is **learned by attempting**, never read. `commentMentionGuard` reads the
   posted comment back (`message_tags`), rewrites it to the untagged text when the mention
   did not render, and memoizes the page as unsupported in Redis for 30 days — and as
   supported for 7, so a proven page skips the read-back instead of paying a Graph call on
   every reply.
1b. Detection is by PRESENCE of a user tag, never by `tag.id === psid`. We add one mention to
   a comment we just created, so any user tag is ours; requiring id equality would, if Graph
   echoes a differently-scoped id, strip every working mention and mark every page
   unsupported. The two errors are not symmetric. The id we sent vs the id echoed is logged
   (not acted on) so production answers that question for us.
2. Redis, not a column: this caches someone else's mutable setting, so it must expire and
   self-heal when the merchant flips the switch — a column would need manual repair.
3. The token is prefixed AFTER the nudge truncation, so `NUDGE_MAX_LENGTH` can never slice
   `@[1784…]` in half and publish the fragment.
4. Facebook only. Instagram mentions are `@username` — different syntax, different id space,
   unverified here; the column and the toggle simply do not exist for IG, exactly as with
   the like option.

**Verified live on our own page before merge (2026-08-07).** An `@[id]` Meta cannot resolve
is **stripped silently** — `@[<page-id>] probe1` and `@[999999999999999] probe2` both
returned HTTP 200 and read back as `" probe1"` / `" probe2"`, with no `message_tags`, no
error, and no literal `@[…]`. The risk this design was built around — raw markup published
in front of customers — therefore does not occur; the residual defect is a stray leading
space, which the guard's rewrite removes. The repair path was exercised against real Graph
(`POST /{comment-id}` → `{"success":true}`, text changed) and both probe comments were
deleted (DELETE needs the token as a query param; a JSON body is ignored). Reach is
confirmed too: 100% of 75,584 Facebook comments in the last 30 days carry a `from_id`, and
99.97% are PSID-shaped.

**Still unverified at merge:** no mention of a REAL commenter has been observed rendering,
because our own page has no comment from a non-admin account to test against. So "does a
tag actually appear" is answered by the first armed post on a live page — which is safe to
run, given the failure mode above.

## D-064 · iOS App Store billing: web-only, zero commission — no IAP before launch

Owner ruling, 2026-08-02.

**The rule.** The iOS app launches (and stays) as a free companion app with NO in-app
commerce: subscriptions are sold exclusively on jawab24.com via Stripe. Apple's 15/30%
commission applies only to sales transacted inside the app, so this model owes Apple
0% — permanently. This is Guideline 3.1.3(b) ("Multiplatform Services") and the
standard B2B SaaS pattern (Slack, HubSpot, ManyChat).

**Why it was ruled.** The launch stalled for 3 months (May–Aug 2026) on the belief that
Apple would take 30% of Jawab24 revenue. It would not: the reader-app gating shipped in
`498b5c34` (May 2026) — `isIOSNative()`, `useIOSPaymentRedirect`, UpgradeCTA hidden,
pricing nav gated — already removes everything Apple could tax.

**Standing discipline.** Every new upgrade/pricing/plan CTA must go through the iOS
gating (`isIOSNative` / the `iosOr(...IOS)` copy pattern). One stray "upgrade" link or
"buy on our website" phrase visible on iOS is an instant Guideline 3.1.1 rejection.

**Parked, not rejected.** Adding IAP later as an extra payment rail is allowed IF a
verified case appears — the candidate rationale is Libyan merchants who cannot pay via
Stripe (0/7 top-ups) but can pay Apple's Libya storefront in local currency. Gate:
verify Libya-storefront payment methods with a real Libyan Apple ID, enroll in the
Small Business Program (15%), sign the Paid Apps Agreement. Do not build IAP before the
app is launched and that verification is done.

## D-065 · Salla Article 5: suppress Stripe for Salla merchants, exempt existing Stripe payers

Owner ruling, 2026-08-10 (unblocked the same day Salla Partners ID verification was approved).

**The rule.** An account must bill through Salla — and every Stripe surface is refused with
400 `SALLA_BILLED` — when it has an **active Salla store** AND no established live Stripe
relationship. A merchant who signed up on jawab24.com, paid through Stripe, and only later
connected their Salla store is **exempt**: they were never a Salla-sourced sale, and pulling
their billing rail out from under them is both a revenue loss and a broken experience.

**Why it was ruled.** Salla apps-policy Article 5 mandates paid-app payment through Salla.
We launch free-tier-only, which is compliant on its own, but a Salla merchant who exhausted
the free quota still saw the product's normal upgrade CTAs — which led to Stripe. That is
inadvertent steering, and the penalty is delisting; unpublishing a live Salla app is not
self-serve (booked meeting with Salla), so the downside cannot be undone by us. This was
flagged OPEN on 2026-08-01 and was the last engineering gate before submitting app 665811310.

**Two rejected alternatives.** (a) Blanket suppression for every Salla-connected workspace —
over-compliant: it silently strips the upgrade path from direct customers we already paid to
acquire. (b) An `install_source` marker distinguishing App-Store-sourced installs — precise,
but costs a migration, and once the app publishes Easy Mode is mandatory, so effectively
every new Salla connect is App-Store-sourced anyway; the precision buys nothing going forward.

**The trap this rule steps around.** A fresh signup is created `status='trialing'` with
`payment_method` **NULL**. Exempting on status alone would exempt every user on the platform,
and the guard would silently never fire — indistinguishable from "shipped and working" right
up until Salla delists the app. The exemption therefore requires `payment_method='stripe'`,
which is only ever written after a real Stripe payment. Pinned by
`backend/test/config/sallaBilling.test.ts`.

**Scope of the subject.** Store presence is resolved against the workspace OWNER (the D-E
entitlement subject), across every workspace they own — NOT the workspace currently being
viewed. One subscription serves all of an owner's workspaces, so a per-workspace scope would
let the UI offer an upgrade the payment API then refuses (the dead-end the Shopify review
caught as H2).

**Precedence.** Shopify's D-G guard runs first and is unchanged; when both rails apply to one
account, the refusal is `SHOPIFY_BILLED`, because Shopify has an admin deep link to send the
merchant to and Salla does not.

**Known uncovered surface (found in the persona review, owner decision owed).** The guard
covers the six merchant-facing Stripe entry points. `services/admin/billing.ts:createPaymentRequest`
mints a hosted Stripe Checkout link for an arbitrary user and consults **neither** marketplace
rule — pre-existing, and equally unguarded for Shopify's D-G. It is admin-only and deliberate
rather than a self-serve leak, and the manual rail is how we bill merchants Stripe cannot serve,
so it was documented rather than silently blocked. Decide: guard it, warn in the admin UI, or
accept it as a staffed-process risk.

**Not implemented, deliberately:** Salla billing itself. When it lands (`'salla'` subscription
source driven by `app.subscription.*` webhooks), the suppression becomes a redirect to Salla's
plan management and the exemption predicate is replaced by a subscription-reading
`isSallaBilled(row)`, exactly like Shopify's.

---

## D-066 · Zid App Market installs auto-provision the merchant account, and the app runs embedded in Zid's dashboard

**Date:** 2026-08-11 · **Status:** Accepted · **Supersedes:** nothing (extends D-053)

**Context.** Zid rejected app 7367 on 2026-08-10: *"OAuth does not yet meet our required
standards. Key updates needed: • Direct merchant access (no sign-in prompt) • Full data
integration with Zid."* The proximate defect was structural, not a bug: a platform-initiated
install arrives with **no Jawab24 session**, and `createEcommerceControllers`' callback
answered that by creating a pending install and redirecting to `/login?zid_pending=true`.
The reviewer met a login wall and could not complete a single scenario. Zid's own guidance
is explicit — *"Create an account for the merchant using our APIs and don't let them create
one"* (help-partner.zid.sa/en/articles/8645309).

**Ruling.**

1. **Auto-provision on platform-initiated install.** When the OAuth callback has no session,
   the merchant account is created from the store profile Zid returned
   (`authService.provisionEcommerceMerchantUser`) — user + workspace + subscription — and the
   store is attached to it. No login, ever.
2. **An existing email REFUSES auto-provisioning** and falls back to claim-after-login. A
   store's email is set by whoever controls the store, so an email match is not proof of
   identity; auto-logging in on one would be account takeover. The check is
   case-insensitive on the column, not just the input.
3. **The app runs embedded** in the Zid Merchant Dashboard per docs.zid.sa/embedded-apps: a
   UUID we mint is registered with Zid, comes back as `?token=` on the framed Application
   URL, and is traded for a normal short-lived access token. Only the UUID's SHA-256 is
   stored; it is rotated on every (re)install and revoked — at Zid and locally — on both
   uninstall and merchant-side disconnect, always *before* the token-blanking step.
4. **Inside the frame the session is a Bearer token in `sessionStorage`, not a cookie.**
   `SameSite=strict` cookies are never sent to a third-party frame, so both cookie auth and
   the `/auth/refresh` rotation are unavailable there by construction. Re-minting from the
   UUID replaces refresh. No long-lived bearer token is ever issued.
5. **A platform reinstall reactivates the store for its ORIGINAL owner and workspace.** The
   server-to-server code exchange proves Zid sent us there for that store; ownership is never
   re-bound, and the workspace is taken from the existing row rather than `workspaces[0]`
   (which would silently move the store for a multi-workspace owner).
6. **`X-Frame-Options` is removed domain-wide in favour of CSP `frame-ancestors`.** XFO has
   no allowlist form, so `SAMEORIGIN` blocked the integration outright. `frame-ancestors
   'self' dashboard.zid.sa web.zid.sa *.zid.dev` is the standards-track replacement,
   overrides XFO where both exist, and is honoured by every browser we support.

**Why this is worth the shared-infrastructure risk (point 6).** It touches every response on
the domain — the review rules class that as Critical, and it is the one part of this change
that can hurt pages nobody was thinking about. Accepted because: the allowlist is three named
Zid hosts (not `*`), anti-clickjacking behaviour is unchanged for every other origin, this is
what Shopify and Salla embedded apps require too, and the alternative (relaxing only
`/zid/embedded`) blanks the frame on the merchant's first navigation. `npm run
check:nginx-routing` boots the real config and asserts both the routes and these headers, so
a well-meaning "restore the security header" edit fails the gate instead of silently killing
the integration.

**Scope boundary.** All four adapter hooks (`provisionMerchant`, `postInstall`,
`reinstallPolicy`, `onDisconnect`) are **opt-in**; Salla and Shopify pass none of them and
their behaviour is byte-identical. Salla will need the same treatment before ITS review — the
Easy-Mode claim flow has the same login-wall shape — and should adopt these hooks rather than
grow a parallel implementation.

**Not addressed here.** The rejection's second bullet, "full data integration", needs the Zid
billing PR (Subscription-App scenario 2, "subscribe to a plan, confirm it syncs" — specified
in `ZID_TEST_PLAN.md` §H) plus a green §A–§F. Do not resubmit on this PR alone.

### D-066 addendum (2026-08-11) — persona-review hardening

The first cut authenticated the embedded frame as the store owner with an **unscoped** session
and removed `X-Frame-Options` with `*.zid.dev` in the production allowlist. Review found the
credential (a permanent UUID) rode the URL into logs/Sentry, a blocked-storage frame fell
through to `/login` inside the iframe, and an auto-provisioned merchant could end up
workspace-less with no recovery. Resolved, all in the same change:

1. **The embedded session is workspace-SCOPED, not full-account** (`TokenScope`;
   `generateToken(user, expiry, scope)`). A scoped token pins one workspace (`resolveWorkspace`
   refuses any other, even via `X-Workspace-Id`) and is admin-stripped (`requireAdmin` in BOTH
   `middleware/auth.ts` and `middleware/admin.ts` rejects it). A leaked UUID therefore grants
   the store, never the owner's other pages/stores/billing/admin — which also bounds the
   reinstall-for-owner path: a store collaborator who reinstalls lands in a scoped session, not
   the owner's account.
2. **The credential never persists in the clear**: the entry page strips `?token=` from the URL
   on arrival, nginx logs path-only for `/zid/embedded` (`log_format main_noquery`), Sentry
   `beforeSend` redacts it, and the UUID idle-expires (`embedded_token_last_used_at`, 30 days,
   migration `0160`).
3. **Blocked third-party storage** falls back to an in-memory store instead of silently
   no-op-ing the write and dropping to a cookie session that a frame cannot send.
4. **Auto-provisioning GUARANTEES a workspace** (bypassing the pending-invite skip, which only
   made sense for accounts that can log in and accept the invite) and refuses rather than
   returns a half-built account.
5. **`*.zid.dev` dropped** from the production `frame-ancestors`; `check:nginx-routing` now
   asserts its absence.
6. The exchange is extracted to `services/embeddedSession.ts` (platform-agnostic, ready for
   Salla) and every refusal is one opaque 401 with a distinct logged reason.

**Still deferred (not blocking this PR, blocking the resubmission):** the seamless in-frame
Facebook-connect. facebook.com refuses framing, and a scope-preserving break-out needs threading
scope through the shared `/auth/browser-handoff` bridge — shared infra not touched here. The
embedded empty-state now breaks OUT to a top-level tab instead of dead-ending, which is honest
but not seamless. See `ZID_TEST_PLAN.md`.

---

## D-067 · A restricted session's break-out stays restricted — the handoff carries its scope

**Date:** 2026-08-11 · **Status:** Accepted · **Extends:** D-066

**Context.** D-066 gave embedded sessions a `TokenScope`: pinned to the store's workspace,
`isAdmin` force-cleared, enforced in `resolveWorkspace` and `requireAdmin`. Two things were
then found at the same seam.

**1. The scope was escapable (security).** `POST /auth/browser-handoff` accepts any
authenticated caller, and stored only the userId. `POST /auth/browser-handoff/exchange`
turned that code into `generateToken(user)` — unscoped, `isAdmin` restored from the user
row, plus a refresh cookie. So a restricted embedded session, or anyone holding the iframe
UUID, could trade it for a full session and reach the owner's other workspaces and the
admin console. The scoping added in D-066 was defeated by a bridge that predates it.

**2. The break-out was a dead end (product).** facebook.com sends `X-Frame-Options: DENY`,
so connecting a Facebook page cannot happen inside the frame — the tab is unavoidable.
But the embedded session is a Bearer token in the frame's `sessionStorage`, never a
cookie, so `window.open('/pages')` opened a tab with **no session**. An auto-provisioned
Zid merchant has no password, no linked Facebook account and no phone, so that login page
was unpassable. Every Zid merchant must connect a page — Jawab24 replies on Facebook,
Instagram and WhatsApp, and the Zid store is a data source — so this was not an edge case;
it was the product not working, and it was the same "sign-in prompt" defect Zid rejected
app 7367 for, moved one screen later.

**Ruling.**

1. **The handoff code carries the minting session's scope.** Scope in, same scope out.
2. **A scoped exchange re-mints a scoped token and gets NO refresh cookie.** `/auth/refresh`
   issues an unscoped token, so a refresh cookie would launder the restriction away one
   step later. Bounded by `EMBEDDED_BREAKOUT_TOKEN_EXPIRY` (1 hour) instead — long enough
   to survive Meta's wizard, still workspace-pinned and admin-stripped.
3. **The WhatsApp app-start bridge refuses scoped codes outright.** It signs the browser in
   with a full session and hands over workspace-level WABA credential material; an iframe
   credential must not be able to buy that. Embedded merchants connect WhatsApp from a
   real login.
4. **The embedded break-out mints a code and lands on `/auth/sync`**, so the tab arrives
   signed in. The popup is opened synchronously inside the click handler (a popup opened
   after an `await` has lost the user gesture and is blocked), with `opener` severed
   manually — `noopener` makes `window.open` return null, leaving nothing to point at the
   URL.

**Backward compatibility.** `consumeBrowserHandoffCode` still accepts the previous bare-
userId payload. Those codes live 60 seconds, which spans a rolling deploy; dropping them
would 401 a merchant mid-flow. They redeem unscoped, which is what they were.

**What this does NOT do.** It does not remove the extra tab — Meta's framing policy is not
ours to change. It does not address the rejection's second bullet ("full data integration"),
which still needs the Zid billing PR and a green §A–§F.

---

## D-069 · Scope survives EVERY re-mint, not just the handoff exchange

**Date:** 2026-08-11 · **Status:** Accepted · **Extends:** D-067

**Context.** D-067 made the handoff code carry its minting session's scope, and the
exchange re-mint it scoped. Review of that change found the invariant it states —
"scope in, same scope out" — did not survive the break-out's own destination.

The break-out exists so an embedded merchant can connect a Facebook page. That flow
ends at `POST /auth/facebook/link`, which re-minted `generateToken(user,
ACCESS_TOKEN_EXPIRY)` — **unscoped**. `embeddedPlatform` and `workspaceId` left the
JWT, so `requireAdmin` and `resolveWorkspace` stopped firing and `isAdmin` came back
from the user row; the response also shipped the user's FULL workspace list. So the
scope was preserved through the handoff and then dropped one screen later, by the one
action the break-out was built for. Anyone holding the iframe UUID could walk a normal
Facebook dialog with their own account and receive a full, admin-capable session — and
`linkFacebookToUser` wrote their `facebook_id` onto the victim's row, making it a
durable takeover.

Three sibling gaps at the same seam:
- `/auth/refresh` was addressed only by NOT ISSUING a refresh cookie. A cookie left
  from an earlier ordinary login on that browser was untouched, and the client's 401
  interceptor would rotate it into an unscoped token on expiry.
- `controllers/zid.ts` post-install fallback minted an **unscoped** code. With
  `reinstallPolicy: 'reactivate-for-owner'` that user can be a pre-existing account
  with other workspaces and possibly admin.
- `GET /workspaces` was unfiltered, so a pinned session enumerated the owner's other
  workspaces (unusable, but named) and the client rendered them as a switcher.

**Ruling.**

1. **Every endpoint that re-mints a token or a handoff code for the CURRENT caller runs
   its scope through `callerScope(request)`** (`middleware/auth.ts`) — one reader, so a
   new re-mint site cannot quietly invent its own rule. `/auth/facebook/link` re-mints
   scoped at `EMBEDDED_BREAKOUT_TOKEN_EXPIRY`.
2. **A scoped session acts only on its pinned workspace.** `/auth/facebook/link` syncs
   pages into `scope.workspaceId`, never `workspaces[0]` — the old behaviour dropped a
   freshly-connected page into a workspace the scoped session cannot read back, so the
   merchant connected a page and still saw none (a merchant can hold both a personal
   and a store workspace — ZID_TEST_PLAN L-14).
3. **A scoped session sees only its pinned workspace.** `/auth/facebook/link` returns
   just that one, and `GET /workspaces` filters to it. D-066 says the others are
   unreachable; enumerable is not that.
4. **The scoped exchange CLEARS any refresh cookie already in the jar**
   (`cookiesService.clearRefreshTokenCookie`). Not issuing one is not enough: the tab
   shares a cookie jar with every other jawab24.com tab. This costs that browser a
   re-login when the scoped token expires — the right trade against laundering on a
   timer.
5. **The Zid post-install browser fallback mints a SCOPED code.** An install proves the
   store, not the person. Where no workspace can be determined it hands out nothing
   rather than an unscoped session — worse product, not an escalation.

**Also.** The popup-blocked path in the break-out navigated `window.location`, which
inside the frame navigates the FRAME — rendering `/pages` back inside the iframe and
hitting facebook.com's `X-Frame-Options` one screen later, i.e. restoring the dead end.
It now navigates `window.top`. The helper moved to `lib/embeddedBreakout.ts` so that
branch could be pinned by a test at all.

**What this does NOT do.** It does not settle whether a break-out token should live 15
minutes or 60 (D-067 chose 60; `services/embeddedSession.ts` argues the opposite for the
in-frame token). Both sites read one constant, so that ruling can be made in one place.

---

## D-070 · Zid App Market billing is verify-first: the subscription API is the authority, webhooks are only triggers

**Date:** 2026-08-11 · **Status:** Accepted · **Mirrors:** D-054 · **Supersedes:** the webhook-driven design assumed by `ZID_TEST_PLAN.md` §H

**Context.** §H was written believing Zid's `app.market.subscription.*` webhooks had to
BE the billing state, because — unlike Shopify (D-054), which delivers no App Pricing
webhook at all — Zid delivers them. That framing made every subscription a hostage to
delivery: a dropped webhook means a paying merchant is never activated, and §H-9 had to
be answered by a mechanism nobody had designed yet.

Zid also documents `GET /v1/market/app/subscription` (dual-header auth + `app_id`,
gated on the `Subscription.read` scope, now enabled on app 7367). That changes the
shape of the problem: we can ASK.

**Ruling.** The Zid rail mirrors D-054 rather than the webhook design. One idempotent
choke point, `syncZidBilling(storeId)`, asks Zid what the subscription is and reconciles
the local row to that answer. Webhook deliveries never carry state into the database —
they call the choke point and nothing else. Three triggers: the subscription webhook,
the uninstall webhook (cancel), and a 6-hourly reconciler that is the authority of last
resort. §H-9 is therefore closed by construction, not by trusting delivery.

**Consequences.**
- A missed webhook is a delay of at most six hours, never a lost subscription.
- The uncaptured envelope cannot corrupt billing state: nothing is read from it except
  "something changed, go look". This matters because `EC3` (a Rejected app cannot be
  installed) blocks every live round-trip until 7367 is resubmitted — so this rail
  ships unvalidated against a real store, deliberately, with the fail-loud posture
  D-020/D-053 imposed after the first Zid implementation was built on an assumed
  contract.
- Two identifiers must resolve or NOTHING is written: the plan (`unknown_plan`) and the
  status (`unknown_status`). An unrecognised **status** is explicitly NOT treated as
  "inactive" — pausing a merchant Zid is actively billing, because Zid shipped a string
  we had not seen, is a self-inflicted outage. A stale entitlement costs us a little
  money; a wrongly-revoked one costs a customer.
- `plan_name` comes back in **Arabic**, so Shopify's "lowercase display name == slug"
  shortcut does not port. The plan **id** is matched first (stable across a rename) and
  the Arabic name is a fallback folded through the shared `normalizeArabic`, so an
  أ/ا drift on Zid's side cannot demote a payer to `unknown_plan`.

---

## D-071 · Starter is not sold on any marketplace

**Date:** 2026-08-11 · **Status:** Accepted

**Context.** The Zid and Salla listings exist because the merchant's STORE is the
integration. Starter carries `ecommerceEnabled=false`.

**Ruling.** Marketplace plan matrices offer Business and Pro only. `ZID_BILLABLE_PLAN_SLUGS`
omits `starter`, and an install that somehow reports it resolves to no slug and fails
loud rather than activating.

**Consequences.** Selling Starter through a store marketplace would sell a plan that
cannot use the one feature the listing advertises — a refund request and a bad review,
not a cheap entry tier. A merchant who wants Starter buys it on jawab24.com, where the
plan makes sense.

---

## D-072 · Marketplace SAR pricing is grossed up so the net lands at the Stripe USD price

**Date:** 2026-08-11 · **Status:** Accepted (pricing PROVISIONAL — final numbers deferred pending WHT confirmation)

**Context.** Zid takes a commission on App Market sales and VAT applies on top, so a
plan listed at the Stripe-equivalent SAR price nets materially less than the same plan
sold direct.

**Ruling.** Marketplace list prices are set so the NET receipt approximates the direct
Stripe price, rather than matching the sticker price across channels. The provisional
numbers are 189 SAR (الأعمال) and 379 SAR (الاحترافي), monthly with a 14-day trial.

**Consequences.** A marketplace merchant sees a higher sticker price than the website —
accepted, because the marketplace supplies the customer. The numbers stay provisional
until the withholding-tax rate is confirmed; they are editable in the Partner Dashboard
until the app is published.

---

## D-073 · One marketplace billing guard, not one per marketplace

**Date:** 2026-08-11 · **Status:** Accepted · **Generalizes:** D-065

**Context.** Suppressing Stripe for marketplace-billed merchants had grown a rail's
worth of code per marketplace: `isShopifyBilled` open-coded in the payment controller,
`mustBillThroughSalla` beside it, and Zid about to add a third. Each rail also had to
be threaded separately into the usage summary that drives the frontend CTAs, which is
exactly where the two answers can drift and dead-end a merchant.

**Ruling.** `services/marketplaceBilling.ts` owns the question for all three rails and
returns a verdict (`marketplace`, wire `code`, `manageUrl?`). Each rail's *reason* stays
in its own `config/*Billing.ts`; what is centralized is the ORDER the rails are asked
in — row-based rails first, then the Stripe exemption, then store-based rails — because
the order is the part a copy gets subtly wrong.

**Consequences.**
- Salla's answer is byte-for-byte unchanged, and Shopify is still evaluated first.
- The API exposes `subscription.marketplaceBilling`; the legacy `sallaBilled` boolean is
  still emitted and still Salla-only. It is NOT retired, because the mobile app ships a
  BUNDLED frontend that lags the web build — dropping the field would silently
  un-suppress Stripe for Salla merchants on an older app, an Article-5 violation with a
  delisting risk. It retires when no supported build reads it.
- A marketplace with no self-serve destination (Salla today; Zid until its App Market
  URL is observed rather than guessed) returns no `manageUrl`. Absent means "suppress,
  but show no link" — never "do not suppress".

## D-074 · Erratum to D-073: Salla's answer was NOT "byte-for-byte unchanged"

**Date:** 2026-08-12 · **Status:** Accepted · **Corrects:** D-073's first consequence

**Context.** D-073's consequences open with *"Salla's answer is byte-for-byte unchanged."*
That is false for one input. A merchant with a **live Shopify mirror AND an active Salla
store** used to receive `sallaBilled: true`; after D-073 the resolver returns a single
verdict and Shopify is asked first, so the same merchant receives `sallaBilled: undefined`.

**Ruling.** The claim is withdrawn. The **outcome** is genuinely unchanged — every consumer
checks the Shopify signal before the Salla one, so such a merchant was routed to Shopify
before and still is — but "unchanged wire response" and "unchanged outcome" are different
assertions, and only the second one held. D-073's own text is left intact per this file's
append-only rule; this entry is the correction of record.

**Why it is worth an entry.** D-073 changed a path every billing consumer reads. A false
"unchanged" claim on shared infrastructure is exactly what makes the *next* such claim go
unexamined — the reviewer's attention is the only gate that path has.

**Consequences.**
- When describing a change to `getUsageSummary` or `resolveMarketplaceBilling`, state
  unchanged **outcomes** and changed **fields** separately. They are not interchangeable.
- `sallaBilled` remains Salla-only and is still emitted for older bundled app builds
  (D-073, unchanged). This erratum concerns the claim, not the field's contract.

## D-068 · The customer's certain language wins; a merchant dialect instruction picks the dialect WITHIN that language

**Date:** 2026-08-11 · **Status:** Accepted (ruling) — **implementation built and measured,
NOT shipped**; it is held on branch `fix/persona-dialect-vs-customer-language` pending a PR.

**Context.** A merchant's customer wrote an Arabic thread, then asked in English — "I would
like to know your name" — and was answered in Arabic. Traced end-to-end on the deployed
code: the detector returned `en@0.8`, the chain resolved `en / explicit / certain=true`,
and the prompt carried the STRONGEST "You MUST reply in English" directive. The model
replied Arabic anyway, 4/4 — deterministic, not a sampling tail. A control page with the
same English question over an Arabic history answered English 5/5.

So this was never a detector or language-chain bug. The difference between the two pages
was the merchant's stored persona: «سارة، لهجة ليبية احترافية في المبيعات» — an **explicit
dialect instruction**. The model was obeying the merchant's rule over ours. `KB_LANGUAGE_BAN`
only bans choosing a reply language because the persona happens to be *written* in it; it
never subordinated a directive that names a dialect outright. That is the precise gap, and
it is a **precedence question**, not a detection one.

**Ruling.**

1. **The customer's certain message language decides the reply language.** Nothing a
   merchant writes in their persona, brand voice, or Business Info overrides it. Where
   detection is uncertain the existing soft directives are unchanged — this ruling governs
   the certain branch, which is where the conflict was observed.
2. **A merchant language or dialect instruction selects the dialect WITHIN its own
   language.** «تحدث باللهجة الليبية» means: when replying in Arabic, reply in Libyan
   Arabic. It does not mean: reply in Arabic. Tone and dialect are translated across the
   language boundary; the language itself is not carried over.
3. **This is not a licence to flatten merchant voice.** The counter-probes are part of the
   ruling: an Arabic price question must still come back in Libyan Arabic with the facts
   intact. A change that wins the language case by dulling the persona has failed.

**Alternatives rejected.** *Merchant-rule-wins* (close as by-design) contradicts the
shipped language spec and the industry standard — Intercom Fin makes an explicit customer
language attribute win absolutely. *An explicit per-page reply-language override* is Gap A,
owner-PARKED on 2026-07-29; it is a different feature and would not have fixed this thread,
where the customer's language was already known with certainty.

**Consequences.**
- The fix is a **per-call prompt block — no `PROMPT_VERSION` bump**, so the semantic reply
  cache is preserved (Rule 17.1). Any future strengthening of the certain branch must keep
  that property.
- **Demonstrations beat rules**, measured across four wording arms on the real-KB fixture
  (8 reps each, production sampling): the rule text alone left it at 7/8 wrong; adding the
  conflict clause after the BRAND VOICE NOTES block reached 2/8; disambiguating the static
  IDENTITY rule's phrase "in the customer's own dialect" (`systemPrompt.ts`) reached 1/8;
  an incident-shaped demonstration inside `KB_LANGUAGE_BAN` reached **0/16**.
- The static prompt prefix is untouchable without a `PROMPT_VERSION` bump, so the IDENTITY
  phrase is disambiguated from the per-call side rather than edited in place.
- What this does NOT settle: the degraded-French gap (XGAP case #758) is a *detection*
  failure, not a precedence one, and is unaffected. Gap A stays parked.

---

## D-077 · «بوست اليوم» becomes «إنشاء منشور»: one seeded post, then on demand, and posts accumulate

**Date:** 2026-08-13 · **Status:** Accepted (owner ruling) — **implementation built, gates green,
NOT merged**; held on local branch `feat/post-creation-on-demand`.

> **Numbering note.** D-075 and D-076 are claimed by the merchant-brief work on
> `feat/post-suggestion-brief`, which is committed but unmerged. This entry takes D-077 so the
> two branches cannot collide in an append-only file. (The earlier D-077, written for the
> reverted «منشوراتك» page, was removed before it ever landed.)

**Context.** The feature generated one post per page every morning via cron, whether or not the
merchant ever opened it, and «اقترح غيره» destroyed the post it replaced — text kept, but the
image files deleted from storage. Both properties produced real problems that were being
*managed* rather than removed: an unopened-streak waste guard that only measured *unopened* (a
merchant who looked daily and used nothing kept consuming paid images), a cron/allowlist coupling
where an empty allowlist silently killed pre-generation, an auto-fire that spent one of three
daily attempts before the merchant typed anything, and — observed in production on 2026-08-11 —
a page whose three attempts produced its best post FIRST and whose third attempt erased it.

**Ruling (owner, in their own words).**
- «ما عاد ملزمين نولد بوست كل يوم» — stop generating daily.
- «اول مرة بتظهر الميزة عند التاجر منعمل بوست و بس. بعدين التاجر لازم يفتح و يعمل توليد ليشوف
  بوست جديد، او يضغط على انشئ منشوراً اخر» — exactly ONE post is generated unprompted, the first
  time a page meets the feature; everything after it is created on demand.
- Posts **accumulate**. Creating another never destroys the one before it.

**Consequences.**
- The daily cron is replaced by a seed sweep whose predicate is "this page has no rows at all".
  Rows are never deleted, so a seeded page can never be seeded again however often it ticks —
  repeat spend is impossible by construction rather than guarded (Rule 14). The unopened-streak
  waste guard is therefore DELETED, not retuned: it existed to stop a daily job dripping spend,
  and there is no daily job. The schedule remains only as a POLL INTERVAL, because eligibility
  arrives over time (a page connects, a workspace joins the allowlist).
- Supersede stops deleting images. `superseded` changes meaning from "replaced and gutted" to
  "an earlier post, intact", and the sheet gains a history strip built from those rows. The
  deletion was also backwards economically: an image costs ~$0.0064 to generate and roughly
  $0.0004 to store for a year.
- **The read stops being day-scoped.** This is forced by the ruling, not a separate choice: with
  nothing generating on its own, a day-scoped read would show an empty sheet to every merchant
  whose last post predates midnight, and the seeded post would vanish overnight — making the
  seed pointless. The daily CAP does not move; the day stopped deciding what a merchant can SEE,
  not how much they can MAKE.
- The name stops lying (nothing arrives daily any more) and drops an English loanword: «بوست» is
  a borrowing where «منشور» exists, which our own Arabic-register rule prefers. Two i18n strings
  that promised «بوست جديد يصلك غداً» — a promise only a cron can keep — were corrected.
- The route URL stays `/post-suggestions/today` even though the wording is now wrong. Shipped
  mobile bundles call it and cannot be redeployed; a URL is a contract with clients we do not
  control, so it outlives the name.

**What this does NOT settle.** The trade is real and one-way: the daily post was also a *reason
to open the app*, and once the cron is gone we can no longer measure what it was worth — the copy
metric was broken for the entire pilot, so it was never measured while it existed. Every other
part of this ruling is reversible; that part is not. Watch opens-per-week after the switch. A
periodic no-cost nudge («جاهز نعمل منشور جديد؟») is the parked idea that would restore the habit
loop without restoring the spend; it is NOT part of this change.

### D-077a · Addendum (2026-08-13, review): the read must separate the POST from the ATTEMPT

Found reviewing the D-077 implementation, before merge. Not a change of ruling — a defect the
ruling's own goal ("creating another never destroys the one before it") was not actually
delivering.

**The defect.** The read served "the page's newest row with status in (ready, pending, failed)"
as `suggestion`. Supersede only runs on a SUCCESSFUL fulfilment, so a generation that fails
supersedes nothing and its row is newer than the intact post it did not replace. That failed row
therefore became "the current post": an empty-text body the client rendered with Copy/Download
over nothing, while the merchant's real post was invisible — and unreachable through `history`
too, which is superseded rows only.

Day-scoped, that state cleared at midnight and the cron replaced it. **Removing the day scope
made it permanent**, and the seed made it worse: the seed predicate is "this page has any row",
so a page whose one-time seed FAILED kept a failed row forever, was never seeded again, and
showed an empty card as the merchant's first contact with the feature — the opposite of the
"arrive to something finished" the seed exists for. D-077's text says such a merchant "lands on
the create button"; they did not, because the card counted a failed row as a post.

**The fix.** The envelope answers the two questions separately — `suggestion` is what the
merchant HAS (newest `ready` row, or null), `inFlight` is what is HAPPENING (newest row when it
is `pending`/`failed`, else null). The post stays on screen while a generation runs and while one
fails; a page with genuinely no post gets a create CTA instead of a rendered blank.

**Why this shape rather than re-scoping the read to a day.** A day scope would only have made the
masking self-heal overnight, which is detection-by-calendar, not prevention (Rule 14) — and it
would have reintroduced exactly the empty-sheet-after-midnight problem D-077 removed. Separating
the fields makes "a failed attempt is the post" unrepresentable.

**Also settled here.**
- Storage retention is now DOCUMENTED where it is owed: a `superseded` row is live and
  referenced, page delete is the only sweep that may remove a `generated-posts/` object, and
  there must be no age-based expiry on that prefix (`backend/docs/OBJECT_STORAGE.md` §9). D-077
  changed this behaviour without changing that doc, which claimed the deletion still happened.
- `idx_post_suggestions_page_created` (migration 0164). Going day-blind took `suggested_for` out
  of every post-suggestion read while nothing deletes rows any more, so all three reads sorted
  the page's whole row set on the highest-frequency fetch the feature has. They now issue as one
  parallel round trip.
- ABSENT ≠ EMPTY is enforced in the CACHE as well, not just in the component: writing the
  history-less generate response into the query cache wholesale erased the strip a layer below
  the component that honoured the rule (`mergePostSuggestionResponse`).

**What this does NOT change.** The ruling, the seed model, the no-retry policy, the frozen route
URL, and the daily cap all stand exactly as D-077 states them.

---

## D-078 · The Needs-Attention queue expires after 7 days — it resolves, it never deletes

**Ruling (owner, 2026-08-13).** A flagged item auto-resolves 7 days after the customer wrote it,
on every page, with no per-merchant setting. The queue is a work list, not an archive.

**Why 7, measured before building.** Over 90 days of production (1,057 resolved items, excluding
that day's manual clear): the median item is resolved in **4 hours**, 93% within **7 days**, 96%
within 14. Past a week an item is not pending, it is abandoned. Meanwhile the open queue stood at
**23,660 items with 68% older than 30 days**, spread across paying pages (Nourva 7,900, الفريق
الدمشقي 2,489) — so accumulation is fleet behaviour, not one dead account. The 7-day window gives
up **7.1%** of historical resolutions, and the owner took that trade explicitly over the 14-day
(3.7%) and 30-day (2.2%) alternatives.

**⭐ It RESOLVES, it never deletes — and it must never clear the flag.** `expireStaleAttentionItems`
writes exactly what the merchant's own resolve button writes (`resolved = true, updated_at`), and
deliberately leaves `needs_attention` and `flag_reason` in place. The queue is what the MERCHANT
works; the flags and their stored customer questions (`flag_meta`) are what WE measure reply
quality from. Emptying the first must not cost the second. The precedent that forced this split:
on Port Said the same day, a 188-item queue was cleared and **60% of it turned out to be one
fixable KB gap** — visible only because the 115 flags and 171 stored questions survived the clear.

**Age is taken from `created_at`, not `updated_at`.** A flag ages from when the customer wrote,
not from the last unrelated write that touched the row. (`updated_at` is also why the 7.1% figure
is a bound rather than an exact number — it is the only proxy for "resolved at" the schema has
today. A real `resolved_at` column would make the next measurement of this rule exact.)

**Scope.** Applies to `messages`, `comments` and `instagram_comments` alike, and to urgent flags
too — complaints and angry customers are only 5.6% of the backlog and **89% of them are already
older than 14 days**, i.e. merchants do not work them either. Excluding a flag class later is a
one-line change to the predicate.

**⚠️ What this does NOT fix.** Expiry hides the symptom, not the cause. A queue that empties
itself can make a real, growing problem invisible — which is precisely why the flags stay
queryable. Any future "the queue is small, so quality is fine" claim must be read off the flags,
never off the queue.

## D-079 · The iOS no-IAP exemption is Guideline 3.1.3(f), NOT 3.1.3(b) — D-064's citation was wrong and it cost a rejection

Correction to D-064, forced by Apple's rejection of 2026-08-13 (submission `7272f32e`,
version 2.0.33 build 10). **D-064's ruling stands — web-only billing, no IAP before
launch. Only its legal citation is corrected here.**

**What was wrong.** D-064 claimed the model "is Guideline 3.1.3(b) (Multiplatform
Services)". That clause says the opposite of what we need. Apple's text:

> **(b) Multiplatform Services:** Apps that operate across multiple platforms may allow
> users to access content, subscriptions, or features they have acquired in your app on
> other platforms or your web site … **provided those items are also available as
> in-app purchases within the app.**

3.1.3(b) *requires* IAP. It is an allowance for apps that already sell via IAP, not an
exemption from it. The App Review Notes repeated the claim verbatim, and the reviewer
quoted that same sentence back as the rejection rationale. We supplied the reasoning
that rejected us.

**The correct clause is 3.1.3(f), Free Stand-alone Apps:**

> **(f) Free Stand-alone Apps:** Free apps acting as a stand-alone companion to a paid
> web based tool (i.e. VoIP, Cloud Storage, Email Services, Web Hosting) do not need to
> use in-app purchase, provided there is no purchasing inside the app, or calls to
> action for purchase outside of the app.

Jawab24's iOS app is exactly this shape, and an audit on 2026-08-13 confirmed the build
already satisfies both conditions: `dashboard.tsx` removes the whole plan/billing card
on iOS (only the quota bar renders), `UpgradeCTA` / `BuyTopUpCTA` /
`PaymentsUnavailableNotice` all return `null`, `settings.tsx` has no billing section,
the `*IOS` copy keys are factual with no CTA/URL/phone number, and `/pricing`,
`/checkout`, `/payment/*` are both stripped from the bundle and refused at runtime by
`useIOSRouteGuard`. **The code was compliant; the paperwork was not.**

**Standing discipline (extends D-064's).** Never describe Jawab24 to App Review as
"multiplatform", "cross-platform", or "also on Android". That vocabulary is what pulls a
reviewer into 3.1.3(b). The claim to make is always 3.1.3(f): a *free stand-alone
companion to a paid web-based tool*, with no purchasing and no purchase CTA inside the
app.

**Verify lettering before citing it.** The sub-clause letters were confirmed live from
developer.apple.com on 2026-08-13, not recalled: (a) Reader, (b) Multiplatform,
(c) Enterprise, (d) Person-to-Person, (e) Goods and Services Outside of the App,
(f) Free Stand-alone, (g) Advertising Management. Apple renumbers these.

**Operational lesson, recorded because it cost us the reply channel.** Post the
Resolution Center reply **before** cancelling a rejected submission. Apple's reply box
exists only on an actionable rejection; once the submission is cancelled it shows
`Removed` and the thread becomes read-only (verified in the ASC UI: the message still
renders, but the page has zero textareas, zero contenteditable nodes and no Reply
button). Cancelling is unavoidable — a rejected submission holds
`appStoreVersionForReview` and blocks resubmission — so the order is: reply, then
cancel, then resubmit.

---

## D-080 · Erratum to D-078: the queue-expiry ruling was measured on 43% of the rows it governed, and the sweep destroyed its own evidence

**D-078 stands as a ruling; three of its supporting statements were wrong.** Recorded here rather than by editing D-078, which is append-only.

**1. The blast radius was stated 2.3x low, and the evidence covered messages only.** Every figure quoted in D-078 — median 4 h, 93% within 7 days, "gives up 7.1%", "23,660 open, 68% older than 30 days" — was measured on `messages` alone. The shipped sweep also resolved `comments` and `instagram_comments`. Actual affected rows: **31,885 comments to 24,243 messages** — the ruling was made on **43%** of what it governed, and the first run resolved ~53,000 rows rather than 23,660.

**2. Re-measured, comments do not support the window.** Excluding the sweep own bulk minute (31,305 rows at 2026-08-13 07:54), only **146 comments had ever been individually resolved in 90 days** — median 1.99 d, **57.5% within 7 days**, against 93% for messages. On comments the 7-day window therefore gives up roughly **40%**, not 7.1%. And 146 rows is not a mandate.
**Owner ruling on that re-measurement: comments keep the 7-day window.** The percentage is the wrong denominator to rule on. In absolute terms the give-up is **62 comments over 90 days — about 21 a month across all 122 pages** — set against a comment queue that had reached 31,885 rows. Merchants barely touch that queue at all: 30 comments were flagged in the last 7 days and 20 are open right now. So the sweep covers all three queues, but the two halves rest on different evidence, and the comment half rests on a **146-row sample** — the first assumption to re-measure if comment behaviour ever changes.

(Methodology matters here and D-078 named none: the answer swings on how bulk-resolve minutes are treated, because `messagesService.resolveConversation` makes "many rows in one minute" a legitimate merchant action.)

**Per-queue isolation, forced by the same review.** Each table is now swept in its own `try`/`catch` with its own error reported. The first release shared one catch across all three, so a `messages` failure silently skipped the rest on every run forever — and comments were 57% of the volume, i.e. the largest queue could have gone unswept behind an error attributed to another table.

**3. ⭐ The sweep destroyed the proxy D-078 promised to re-measure with.** `updated_at` is the schema only stand-in for "resolved at" (`services/admin/metrics.ts`), and the first release stamped it on **56,147 rows**. Sweep-resolved rows became indistinguishable from merchant-resolved ones, so the next measurement of this rule was not made *inexact* — it was made **impossible**, and with it merchant-engagement analysis ("does anyone work the queue?") and support ability to tell "you resolved this" from "we expired it".
⇒ **The sweep no longer writes `updated_at`.** Nothing reads these columns for behaviour, so the omission is free, it preserves the proxy, and it makes an expired row identifiable (resolved, but `updated_at` still at its original write). This deliberately breaks D-078 "writes exactly what the resolve button writes" — the same reasoning D-078 already used for refusing to clear the flags: mirroring the button matters less than keeping the evidence.

**Also corrected.** The sweep now calls `invalidateEndpointStatsCaches` for every workspace it touched. `services/statsCache.ts` requires this of every mutation of these counts because the Needs-Attention chip has no polling fallback; all four resolve/unresolve controller paths comply and the sweep — the largest such mutation — did not, leaving a stale chip over an emptied list.

**Still open, deliberately not fixed here.** The UPDATE is unbounded rather than batched. It mattered for the 53k first run; steady state is ~17 rows per pass, so it is a latent risk, not a live one. Related and worth its own change: `batchDelete` `batchSize` never reaches the query at all (Drizzle PG delete takes no LIMIT), so the batching in this file has always been decorative. Fixing that is a separate PR against a pre-existing defect.

**What did NOT change.** The 7-day window for messages, the resolve-don-t-delete rule, keeping `needs_attention` and `flag_reason`, and ageing from `created_at` all stand exactly as D-078 states them — the message evidence (1,057 resolutions, 93% within 7 days) is unaffected by any of the above.

## D-081 · A phone number can say what it is for; a description can never say what to DO with it

**Ruling (owner-approved 2026-08-13, PR #733).** `BusinessProfile.phones` entries carry an
optional free-text `description` — schema.org `ContactPoint`, purpose as free text with suggested
values, never an enum — plus one page-level `BusinessProfile.email` (`Organization.email`). Scope
is settled: **ship this and add nothing.** Two attempts to grow it were stopped and the data agreed
both times.

**1. No `rule` / priority / visibility field. Measured twice.** Across all 122 pages with a KB, 61
keep a phone in free text and 13 label it by purpose — that is what `description` covers — while
exactly **2** (MES, Feras) have phone-routing rules. 2-in-122 is an exception, not a feature.

**⭐⭐ And it would not work anyway — the reusable finding.** `BUSINESS_INFO` renders as **facts**;
the persona renders as **instructions**. *A field that describes cannot command.* The same sentence
scored **8/8 in the persona vs 5/8 in the `description`**, where the model PRINTED the restriction
to the customer and gave the number anyway — leaking both the number and the internal policy.
**Never encode behaviour as data.**

**2. ⛔ The standard is SAFE, not BETTER — corrected after a confound was found.** The
«7/8 → 8/8» improvement first attributed to the restructure was measured against an arm that moved
FOUR things at once. A TYPO-ONLY control — the merchant's data and persona with one character
changed («إلى»→«إلا») — reaches the same **8.0/8**, 5 runs each, both stable. The entire measured
gain was a merchant typo. So this work buys structure, a shorter persona and an editable field; it
does not buy reply quality, and must never be presented as if it did. (Reply-quality claims from
single runs are not claims: the arms that fail are also the arms that flip.)

**3. The canonical-form invariant is the safety argument.** An entry is stored as a bare `string`
IFF it has no non-empty description. The editor sends a FULL-REPLACE patch, so if the shape were
remembered rather than derived, an untouched echo would read as a change and stamp
`{source:'editor'}` on an unconfirmed Facebook-synced number — laundering it into the authoritative
block. That bug shipped once (2026-08-08). Deriving the shape makes the round trip a pure function.
⇒ Never "objects after the first edit"; one `normalizePhoneEntries` at BOTH write boundaries.

**4. ⭐ A false REJECT in a phone slot is a LOCKOUT, and the two costs are not comparable.**
Because the editor full-replaces, anything the merchant schema rejects blocks a no-op save — so one
bad row 400s edits to hours, address, everything. Three rules follow, all of them learned by
shipping the opposite:
- `isUsablePhoneEntry` asks "is this FIELD's content a phone?" and must not reuse `extractPhones`,
  which asks "is a phone hidden in this PROSE?" and carries a 9-digit floor that is correct there
  and rejected a real 7-digit Syrian landline here.
- **Already-stored numbers are GRANDFATHERED.** The supply of unjudgeable stored entries is
  continuous — `fb_sync` and the KB extractor write through the BASE schema *by design* — so
  without this, something Facebook wrote could lock a merchant out of their own hours field
  permanently. Judged only when ADDED or CHANGED.
- Canonicalization is a `z.preprocess`, not a `.transform()`: an over-long description truncates
  and an unknown key is dropped, rather than 400-ing a save.

**5. Where department numbers live.** Contact points for phones the PAGE owns; a phone belonging to
another ENTITY (a showroom with its own address) stays a row on that entity's fact list. MES's
«أرقام الأقسام» moved; «صالات الشركة» did not.

**6. A public post must not publish a restricted line.** `buildContactSuffix` prefers the first
UNCONDITIONAL number (by the invariant, a bare string) and carries the purpose when every line has
one. Taking `[0]` bare published «الإدارة — عند الطلب فقط» to everyone with the condition stripped —
honoured by the reply prompt, dropped on posts.

**7. Sanitize at the RENDER boundary too, not only on write.** Write-only sanitization is safe
exactly as long as every producer goes through it, which is not an invariant the formatter can
check. Idempotent, so no already-clean line moves.

**Reply-safety method worth reusing:** prove byte-identity by extracting the file from
`origin/main`, importing BOTH versions into one process, and diffing the rendered output over every
real production profile — 122/122 identical here, plus the lead-exclusion invariant. Rendering is a
pure function, so byte-equal input means the reply cannot differ: no sampling, no error bar. Gates:
`scripts/fleet-prompt-identity.ts`, `scripts/fleet-save-lockout.ts`.

## D-082 · The "Powered by Jawab24" watermark is removed, not built

**Ruling (owner, 2026-08-15).** `plans.show_branding` and every surface that sold it are deleted.
The column existed since the plans table was created, defaulted `true` on Starter and `false` on
paid plans, and was **never read by the reply path** — not in `messageProcessor`, `commentProcessor`,
`generator.ts`, nor the ai-worker. No reply ever carried a watermark. The only readers were plan
CRUD plumbing and two marketing surfaces (`/pricing` FeatureRow, landing Business card) that
advertised «بدون علامة تجارية» as a paid feature — i.e. we charged for the removal of something no
free user ever had. That is a false pricing claim, and the same defect class as a doc claiming an
unshipped feature exists (Rule 15).

**Why remove instead of build.** The ManyChat-style viral loop is real in principle (public comment
replies are a free distribution surface), but it contradicts the product's core promise: replies
that read as the merchant — human, dialect-mirrored, undisclosed automation. A watermark would brand
exactly the users we are trying to convert (trial/Starter) as automated, during evaluation, in a
market where that costs customer trust. It also collides with the standing rule that Jawab24 is
never called a "bot" in anything customer-visible.

**Revisit-if.** If acquisition ever needs a reply-borne loop, the acceptable shape is: public
COMMENT replies only (never DMs), free/trial tiers only, and measured against conversion before GA.
That would be a new decision with new evidence — this entry does not pre-authorize it.

**Blast radius of the removal.** Column dropped (`0166_drop_plans_show_branding.sql`,
`IF EXISTS` because the dev DB is push-maintained), field removed from `config/plans.ts`,
`services/plans.ts`, `utils/validation.ts`, `seed-plans.ts`, shared `Plan` type, `fallbackPlans.ts`;
pricing + landing + scale-tier bullets removed; i18n keys `branding`, `brandingShown`,
`brandingHidden` deleted (en+ar); `businessFeature3` repointed to the Business reply quota
(«4500 رد ذكي» / "4,500 Smart Replies"). Review rejected the first replacement, «ربط المتاجر» —
entitlement-true but not experience-true, since every integration still renders «قريباً» in-product;
the quota is unambiguously live. Test fixtures updated across both workspaces.
`docs/pricing-management.md` row deleted in the same PR (Rule 15).

**Deploy window, accepted explicitly.** The drop ships in the same release as the code swap; between
`db:migrate` and the container swap the old image's explicit `select` of `show_branding` errors on
plan reads. Repo precedent for column drops, seconds-wide, `/pricing` is ISR-cached — accepted
rather than split into a two-release expand/contract.

## D-084 · Per-page persona scoping replaces the reply-modes build; PR #769 parked on measurement

**Decided:** 2026-08-16 · **Status:** Active · (D-083 is recorded on the parked `feat/reply-modes` branch, PR #769 — the number stays reserved for it.)

**The measurement that redirected the work.** The owner asked why reply modes (D-083, PR #769,
65 files) was needed when a merchant could write the purpose into their persona. Measured before
answering: all 12 real production contact-asks from Shahin Resort (2026-08-01→08-15), each
replayed at its exact thread state, temp 0, 2 runs/arm. Two control numbers exist and they are
DIFFERENT measurements, not a contradiction: the prompt-arm replay
(`reply-mode-full-replay-2026-08-16.md`) scored the live persona at **5/12 failing situations
· 9 asks**, while the end-to-end effect gate (`per-page-persona-effect-gate-2026-08-16.md`,
the full pipeline this PR ships through) scored the same control at **8/12 · 14 asks**. The
treatment arms were clean in BOTH: persona + explicit info instruction **0/12**; same in
identity framing **0/12**; PR #769's INFO-DESK block **0/12**; the shipped page override
end-to-end **0/12, 0 promises**. A persona instruction equals the built feature on every case
that actually fails. The D-019/D-051 argument ("rules lose to demonstrations") did not hold here
and was withdrawn for this class. Transcripts:
`~/.claude/plans/reply-mode-{persona-arm-probe,multiturn-replay,full-replay}-2026-08-16.md` and
`~/.claude/plans/per-page-persona-effect-gate-2026-08-16.md`.

**The ruling (owner, generic-first).** The behaviour is self-serve persona text; what is NOT
self-serve is scope — `brandVoiceNotes*` was workspace-level while businesses are page-level
(17 multi-page workspaces / 87 pages; 4 run one persona over different businesses, incl. the
flagship 9-page الفريق الدمشقي; InMedia's own persona says «نطاق المنتجع» while serving a travel
agency page). So build the generic scoping layer instead of a mode:

1. `pages.brand_voice_notes_multi` JSONB NULL — NULL/`{}`/all-cleared = inherit; language
   content = a PIN (no workspace, no legacy fallback). Fourth instance of the established
   page-override pattern (leadStages / leadFields).
2. One choke point: `resolveBrandVoiceNotes(settings, message, pageOverride?)`; both callers
   (production `enrichPageContext`, playground/eval/cache-warm `buildPlaygroundContext`) pass
   the page row's value. `mapToPlatformPage` MUST carry the field — the processors hand that
   mapped object to the enricher, and dropping it there makes the feature playground-only
   (pinned by `platformPageMapping.test.ts`).
3. **No new cache mechanism and no PROMPT_VERSION bump** — the persona text already scopes both
   cache layers (`bv:` exact-key segment + semantic `brandVoiceHash`), so a page override lands
   in its own bucket exactly like a workspace persona edit. **No allowlist** — scoping an
   existing field is not a behaviour change; a NULL column is byte-identical behaviour, so GA
   from day one, inert until set.
4. Write path `PATCH /pages/:id/brand-voice` (admin+, `null` reverts), auto-translated through
   the same `smartTranslateMultiLang` the workspace save uses.

**Multi-turn eval is mandatory for this class.** Production is clean at turn 1 and asks from
turn 3 onward (11 of the 12 harvested failures had ≥4-turn history) — the 08-15 ship-gate probe
and the parked branch's Cat-77 cases are all single-turn, i.e. they measure the easy case.
Cat 78's replay cases therefore all carry `conversationHistory`, with a no-override control
case pinning attribution. The E-4 grader gap (bare «ورقمك» punishing the permitted
«شكراً لمشاركة رقمك» thank-you) was confirmed on real prod data and fixed in
`CONTACT_ASK_PHRASES`.

**PR #769 stays parked, not closed** (owner). Its unique remainders — `suppressPush` on lead
alerts and leads-tab hiding — are re-evaluated after the InMedia pilot week; the INFO-DESK
prompt block is redundant once page personas exist. UI surface: the **settings scope switcher
(option B) SHIPPED in the same PR** (owner call, 2026-08-16) — multi-page workspaces get a
scope selector on the persona card; single-page merchants see no change. What stays deferred
to pilot evidence is the page-card row (option A) and whether the switcher remains the
long-term surface; the backend contract is identical under either.

## D-085 · Reply modes revived as a structured per-page choice; partial reversal of D-084's parking (2026-08-17, owner-approved)

**Decision.** Revive the core of PR #769 as TWO reply modes per page — «مساعد مبيعات»
(`'sales'`, the default: today's behavior, fleet byte-identical) and «مصدر معلومات»
(`'info'`: answers + routes to the business's own channels, never collects contact
details, never promises callbacks) — stored as `settings.reply_mode` (workspace default,
`'sales'`) with `pages.reply_mode` as a NULL-inherits per-page pin, resolved via
`resolveEffectiveReplyMode` in shared. The behavior text is OURS: one curated INFO-DESK
prompt block with counter-demonstrations (gated per call in the ai-worker promptBuilder;
sales prompts stay byte-identical, NO `PROMPT_VERSION` bump). `suppressPush` mutes lead
push alerts for info pages (row/bell/SSE unchanged). UI is a business question inside the
D-084 scope switcher («ماذا يفعل المساعد عندما يرغب العميل في الشراء أو الحجز؟»), gated
to the InMedia pilot workspace on both sides, fail-closed (an empty allowlist enables
NOBODY; GA = deleting the gates in a reviewed PR).

**Why D-084's parking fell.** Its premise — "the persona text suffices" — died on
measurement (2026-08-17): merchant wording is FRAGILE. One word («تأخذي» for «تسجّلي»)
flipped the intent classifier to SPAM_OR_IRRELEVANT and silenced a reply to a customer
who had volunteered their number; a stricter phrasing brought the asks back. Meanwhile
ONE generic curated block scored 0 asks · 0 promises · 0 silent on all 24 real prod
threads — identical to the hand-tailored text — so a single canonical text we own serves
any merchant. Fleet classification (33 live AR-on pages): ~14 sales / ~6 booking-institutional
/ ~9 media / ~4 mixed — the collect default fits under half the fleet.

**Rejected:** editing Ex-14/15 at the source (PROMPT_VERSION bump burns the fleet reply
cache — Rule 17.1 — and re-rolls 14 working sales pages for zero measured gain); a paste-in
persona template (tamperable, competes for the 800-char persona budget, doesn't touch lead
alerts); leaving it (24 real asks on one page in 8 days the merchant does not want).

**Acceptance measured (2026-08-17, temp 0, local playground):** mode arm (resort fixture,
persona stripped, `reply_mode='info'`) on the 24 harvested threads = **0 asks · 0 promises
· 0 silent · 0 leak-tokens · 24 scored**; sales control arm on the same threads brought
back 6 asks + 1 promise + 1 silence. Eval Cat 77 (persona-less chalets fixture) 7/7;
Cat 78 untouched (784's clarify-vs-collect bistability reproduced on main itself).

**Rollout:** InMedia pilot (allowlist) ≈1 week → GA = gate-deletion PR. Leads-tab hiding
stays OUT (unbuilt; revisit after pilot). Per-page tone deliberately NOT built (D-084
wrinkle, documented in SETTINGS.md). PR #769 is superseded by this build and closes with a
pointer.

## D-086 · A freshness warning may speak for a whole list only when that list IS a schedule (2026-08-19, owner-reported)

**Decision.** `datedListFreshness` now gates its list-CHARACTERISING sentence (`ended`)
on `isScheduleShaped` — a strict majority of rows carrying a retiring date. A list whose
dated rows are a minority gets a new `rowsRetired` state naming the individual rows whose
dates have passed, and never speaks about the list. This REVERSES the explicit choice
pinned by the old test «a price list with one dated promo still warns about it».

**What it shipped.** On page `39aeab89` the list «أسعار الدورات» held 50 price rows of
which exactly ONE carried a date — «دورة المكياج او التجميل (الميك أب)», `starts_at
2026-08-13`, a stray the merchant typed onto a tier. When that one date passed, "every
dated row has retired" became true and the page announced **«انتهت التواريخ المعلنة في
«أسعار الدورات» — لم يعد جواب يذكرها. أضف التواريخ الجديدة.»** — while «مواعيد الدورات
المعلنة» beside it carried **seven live dates through 2026-08-31** for those very
courses (الإسعافات الأولية ×2, الحلاقة النسائية ×2, اللغة الألمانية, السكرتاريا, TOT).
The sentence was false by every reading a merchant has, and its instruction — "add the
new dates" — was wrong advice for a price list. The owner caught it on screen; the
first diagnosis offered ("technically true, merely confusing") was itself wrong and was
corrected against the rows.

**Why the majority rule, again.** This is the identical shape D-057's own tooling had
already been burned by: `isDatedCollection` carries a docblock about ONE dated promo tier
in a 50-row price list reclassifying the whole list (الدمشقي, 2026-08-06). That lesson was
written for the LAYOUT predicate and never carried into the WARNING predicate, which kept
the any-row rule. Two predicates answering "is this a schedule?" differently is what let a
single row make a claim about 50.

**What is deliberately NOT changed.** A genuine schedule that runs out still says so
list-wide (`ended`, 3-day `ending` window, D-057 unchanged).

Retired strays are named up to a cap of five, then «وغيرها» — and the ICU plural still
carries the EXACT total, so the sentence shortens without ever under-reporting what went
dark. (An earlier draft of this ruling claimed they are "named in full, never truncated",
which the same commit contradicted by shipping the cap; the cap is right and the sentence
was wrong. The truncation only engages when it hides at least two names — folding exactly
one row into a plural «others» would be false English.)

**Two things a first draft got wrong, both caught in adversarial self-review before
merge.** (1) It ALSO widened `isDatedCollection` — the LAYOUT predicate — to the retiring
anchor, justified as "inert: zero rows fleet-wide carry `endsAt` without `startsAt`". That
measurement bounds today's rows, not tomorrow's: `ListRowSheet` saves an end date with no
start date and nothing forbids it, so one «ساري حتى» promo row in a four-row price list
reaches the tie, reclassifies the price list as a schedule, empties `bases`, and removes
the tier row that is the entity sheet's only door — the 2026-08-06 «cannot edit»
regression, re-armed. The layout predicate is now left on `startsAt` alone and the two
predicates are documented as answering different questions. **A measurement that a change
is inert TODAY is not a safety argument; it only bounds the blast radius of shipping it.**
(2) It gated `ending` as well as `ended`, which silently dropped the early warning for a
cohort block announced inside a mostly-undated list. «آخر تاريخ معلن في «{list}» هو {date}»
reports a date rather than characterising the list, so it is true of any list holding dated
rows and is not gated. Only the sentence that CHARACTERISES the list needs the majority.

`isScheduleShaped` takes a STRICT majority where the layout rule takes a tie, because at
the tie the false wording is still reachable — two passed promo dates on a four-row price
list would print «انتهت التواريخ المعلنة في «الأسعار»», the very claim this rule exists to
prevent. Layout needs the tie (a two-row list mid-authoring must still edit as a schedule);
a sentence does not.

**Scope, measured before the change (prod, 2026-08-19).** Three collections fleet-wide
carry any dated rows at all; exactly ONE produced the false banner — the one on the
owner's screen.

**Found in passing — the vitest `next-intl` mock was verified by nothing.** Measured against
`intl-messageformat` (the formatter next-intl itself uses) over all 107 plural-bearing EN
messages at six counts, the resolver on `main` disagreed with production on **37 of 642
renders**, from two defects: a single-level regex could not match a plural whose branch body
carried its own placeholder (four shipped messages rendered as RAW ICU in tests), and an
explicit `=0 {No products yet}` branch lost to the locale category (seven more rendered
«0 products»). Both fail as plausible text rather than throwing, so assertions on them pass
or fail for reasons unrelated to the code under test. Both fixed — 0 of 642 now disagree,
with no case where the old resolver was right and the new one wrong. The resolver moved to
its own module (importing `setup.ts` from a test re-arms every `vi.mock`, which is why it
went unchecked) and `frontend/test/icuPlural.test.ts` now pins parity against the real
formatter over the real corpus.

**A note on the self-review itself.** Rule 10.11's question (a) — who READS what I changed —
was answered too shallowly the first time: the readers of `isDatedCollection` were
enumerated, then dismissed with a fleet measurement instead of a behavioural argument. Two
of the three test weaknesses found later were of the same kind: `toHaveTextContent` is a
SUBSTRING matcher, so an expected «7 rows …» passes against a rendered «17 rows …», and the
first attempt at strengthening it repeated the mistake. Notice assertions now compare
`textContent` whole.
---

## D-087 · Reply modes go GA; the control ships to everyone, the mode is turned on for nobody (2026-08-20, owner-approved)

**Ruling.** The D-085 pilot allowlist is DELETED from code — `config.replyMode.workspaceIds`
(backend) and `REPLY_MODE_WORKSPACE_IDS` / `isReplyModeVisible` (frontend). Every workspace
now sees the assistant-type question. This ships the CONTROL, not the mode: every stored
value is `'sales'` or NULL and `resolveEffectiveReplyMode` falls back to `'sales'`, so no
merchant's replies change until they choose. GA is a code deletion, never an env flip —
the reverse (emptying the var) was fail-closed by design and is now unreachable.

**Evidence.** Pilot 2026-08-17 → 08-20 on two real pages (Shahin Resort, الفريق الدمشقي)
plus three low-volume ones: **469 DM + 86 comment AI replies, 0 contact-asks, 0 callback
promises, 0 demo-phone leaks**, against sales baselines of 15 asks + 7 promises / 1354
replies and 50 asks + 2 promises / 1000 replies on the same predicate (the eval's own
`CONTACT_ASK_PHRASES` / `CALLBACK_PROMISE_PHRASES`). Expected ~13 asks at the pooled
baseline rate; observed 0 (Poisson P≈6e-7). Callback promises are NOT settled (λ=2.1,
P=0.12) and the comment surface has a zero sales baseline, so neither is claimed.

**The bound the pilot does NOT license.** Both measured pages belong to merchants who asked
for the feature, and both publish a phone. That is not the fleet. INFO-DESK ends «If no
channel is on file, be honest you don't have one and stop», so a page with no publishable
phone or WhatsApp gets a mode that neither asks nor routes — a dead end for a buying
customer. Measured on prod 2026-08-20: **7 of 36 live pages** pass
`hasRoutableContactChannel`; 10 of the 17 that store phones fail because the number is
`fb_sync` and unconfirmed, which `formatBusinessInfoPrompt` refuses to publish.

**Therefore the control WARNS and does not BLOCK.** The card shows the count of governed
pages with no channel, in the mode's own words, and lets the merchant proceed: a phone
published only in KB free text is invisible to the predicate, and refusing a mode on a
guess we know to be incomplete is worse than stating what we found. Rejected: blocking the
flip (paternalistic, wrong on KB-only pages); silently allowing it (the dead end is the
single most likely GA complaint); auto-promoting `fb_sync` phones to authoritative (that
gate exists because unconfirmed Facebook values were overriding merchant-typed KB facts —
D-010's contract, not this PR's to relax).

**Also in this PR, all found by the GA audit rather than by the feature work.** (a) `PUT
/workspaces/current/settings` wrote `replyMode` into the JSONB the reply pipeline actually
reads with no enum validation — its allowlist checks key NAMES only. Now 400s. (b) The
`PUT /settings` workspace-mismatch guard covered `'info'` only; widened to both modes,
because after GA the likelier mistake is turning info OFF on the wrong workspace. (c) The
Test button blocked on ANY unsaved change, so the only way to see what info mode does was
to save it live on every page; the mode now travels to the playground as an explicit,
never-persisted override, while every other unsaved field still blocks.

**Not touched, deliberately:** `PROMPT_VERSION` stays `v67` (the INFO-DESK block is
appended per-call inside an `if`, so sales prompts remain byte-identical and no
semantic-cache entry is retired — Rule 17.1), the `rm:` cache segment, and the INFO-DESK
prompt text itself. Leads-tab hiding stays unbuilt.

**⚠️ "Generally available" is WEB-ONLY until the next app release.** `capacitor.config.ts`
sets `webDir: 'out'` and only points `server.url` at a host when `CAP_SERVER_URL` is set
(dev), so a production mobile build serves a BAKED static export — the deleted
`isReplyModeVisible` allowlist is compiled into every installed Android/iOS build and keeps
hiding the control there. Nothing breaks (the backend accepts the write from any workspace,
and no merchant's replies change either way); the control is simply absent on phones until a
new app build ships. Same class as the `NEXT_PUBLIC` build-arg gap: a server env var cannot
reach a baked bundle. GA on mobile = the next release, not this deploy.

**The settings sync target — FIXED, and the reply-mode guard removed with it.**
`syncPipelineFieldsToWorkspace` resolved its destination via `resolveWorkspaceId`, which
returns the user's FIRST membership (`.limit(1)`, unordered) with no relation to the workspace
the request resolved. So for a multi-membership user, tone / persona / away / greeting text
already synced to a possibly-wrong workspace — and the D-085 guard covered `replyMode` only,
on a client that sends a DIFF, so any save not touching the mode skipped it entirely.
Guarding one field of a wrong destination is the wrong shape: `updateSettings` now takes the
request's membership-verified workspace and syncs there, which covers all 30 `PIPELINE_FIELDS`
and every save. ⚠️ **BOTH halves, and the second one shipped late.** Moving only the write left
`overlayWorkspacePipelineFields` — and `updateSettings`' own read-after-write return — on the
old resolver, so `GET /settings` served one workspace while `PUT /settings` saved into another:
the edited field snapped back, the dirty baseline reset from the response, and the next Save
computed an empty diff and sent nothing. A SHARPER failure than the consistent-but-wrong
resolver it replaced, live for all 3 multi-membership users (9, 10 and 18 of 29 overlay fields
divergent), and invisible to tests because each half was correct alone. `getSettings` now takes
the same workspace and the read/write symmetry is pinned in `settingsSync.test.ts`. The lesson,
recorded because it will recur: when a destination moves, move every READER of it in the same
change, and assert the two agree — not each in isolation. The `REPLY_MODE_WORKSPACE_MISMATCH` guard is deleted — with the destination
correct it would have refused writes that are now right. The resolver survives only as the
fallback for callers with no request (scripts, tests). Measured 2026-08-20: **3 of 85 users
have more than one membership, maximum 2 each** — small, live, and silent.

**Post-GA measurement owed:** re-run the eval-phrase ask/promise query weekly across every
effective-`info` page — the pilot measured pages WE chose; the point of GA is that
merchants choose next.

## D-088 · Business Info presence is measured across all four stores; the RAG chunk index is not evidence of content (2026-08-20, owner-reported)

**Ruling.** "Does this page have Business Info?" is answered by `hasBusinessInfoContent` —
`knowledge_base` characters OR non-empty `business_profile.merchant` fields OR
`catalog_items` OR `fact_rows`. `kb_chunks` is EXCLUDED from that question. It is the RAG
index over the free text, not a fifth store, and it is read at reply time only on the
retrieval path. One function, called by both the health flags and the payload field the
console renders, so a badge and a banner on the same screen cannot contradict each other.

**What it shipped.** The support console decided emptiness from `chunksTotal` — chunk rows
joined at `pages.kb_active_version`. Since Business Info became structured, THREE writers
bump that pointer without re-ingesting: `updatePage`'s `business_profile` branch, and
`invalidatePageCaches` from `services/catalog.ts` and `services/factCollections.ts`. The
pointer outruns the newest ingested set, the join matches nothing, and the page reads as
empty. Measured on prod: **49 of 92 live pages**, every one of them holding real Business
Info. «Shahin Resort» — active v54, newest chunks v51, **10,494 KB characters and 10 filled
profile fields** — printed «معلومات النشاط فارغة» on the same card that was offering "view
full Business Info" for those 10,494 characters. The owner caught it on screen.

**It was never only cosmetic, which is why the fix is not only in the UI.** `health.ts`
read the same signal: `kbLength === 0 || chunksTotal === 0` → RED `kb_empty`, so those 49
accounts were permanently red and the red was load-bearing — `anyThinOrEmptyKb` escalated
`hold_low_confidence` to a string asserting "the Business Info is empty/thin" about a 10k
KB. `chunksTotal < 5` fired `kb_thin` on the same rows. And `no_offering_chunks` asked the
chunk index whether the page had offerings while ignoring `catalog_items` entirely, even
though the `<product_catalog>` block outranks the free text in the prompt. Catalog items now
settle that question; the chunk index is consulted only when there are none, and never
while it is stale. ⚠️ That last one is a LATENT defect, not an observed symptom: the
carve-out changes the flag for **0 of 92** live pages (only two carry catalog items, and the
stale-index guard excludes both anyway). It is fixed because the predicate is wrong, not
because a merchant was hurt — and an earlier draft of this entry asserted the symptom
("a merchant whose whole Business Info is a catalog price list was told the AI cannot
answer pricing") without measuring it. Same error the code had: a claim the evidence did
not cover.

**Replies were never affected, and that was checked before anything was written.** D-050
sends non-ecommerce pages the FULL KB text with no retrieval call at all, and on the
retrieval path `resolveKnowledge` falls back to the full KB when `chunks.length === 0`. Of
the 49, **zero** are store-backed and **2** reach the retrieval path via `catalog_items`
(«Jawab24», «Shahin Resort»); both degrade to the full KB. So the cost is one wasted
embedding round-trip per reply on two pages — reported as its own flag,
`kb_chunks_stale`, and ONLY for pages that actually read the index. Flagging the other 47
would re-create the same conflation in a new colour.

**The generalisable rule.** A console must report the thing it names. `chunksTotal` was a
faithful measurement of the RAG index and a false one of Business Info; nothing was broken
in it, it was being asked the wrong question. When a domain concept splits into several
stores, every predicate that ever meant "the concept" has to be re-derived — grepping for
the READERS is what found `health.ts`, which was three levels away from the banner the
owner reported and carried the more damaging half.

**Also fixed, same class, found by the same sweep.** The Persona card showed the WORKSPACE
persona with nothing saying that a page carrying its own pin (D-084) never reads it —
`resolveBrandVoiceNotes` resolves inside the override with no workspace fallback. That is
D-087's reply-mode trap exactly, one field over: a workspace-scoped value presented as
fleet truth, wrong for precisely the pages someone deliberately configured. **5 of 92 live
pages** carry a persona pin. The card now names them, `persona_placeholder` no longer fires
when every page is pinned (fixing text no customer reads), and `hasPagePersonaPin` moved to
`@jawab24/shared` so the console and the pipeline decide "pinned" with ONE predicate.

**And the mode badge now shows on every page, sales included.** It was rendered for `'info'`
only, on the reasoning that `'sales'` is the default and a badge on every page is noise.
That is wrong about how an absent badge reads: not "sales", but "this console does not
know" — which is what sends support back to the workspace value, the exact failure D-087
created the badge to prevent. Both badges also state pinned-vs-inherited, because support
has to change a different setting depending on which it is.

**Two things the FIRST fix got wrong, both caught in self-review after the commit and
before the merge — and both were the over-claiming direction of the same defect.**

1. **A key count is not a fact count.** `businessProfileFields` was
   `count(jsonb_each(business_profile->'merchant'))` in SQL. But the modal live page carries
   exactly `name`, `category`, `language_hint` and `website`/`about` — **24 of 92 pages sit
   on that value** — every one of them page metadata that answers no customer question and
   contributes no BUSINESS_INFO line. So the fix reported "4 fields of Business Info" for a
   page holding none, and `hasAnyContent` would have suppressed `kb_empty` for a freshly
   connected page whose profile is pure FB metadata: a FALSE non-empty, replacing a false
   empty. Latent today (0 live pages depend on those fields alone) — and per D-086 that
   bounds the blast radius rather than excusing it. Cured by deleting the count and calling
   `countBusinessInfoFacts`, extracted from `formatBusinessInfoPrompt`'s own `anyValueAtAll`
   so the console counts exactly the six fields the PROMPT counts (address, phones, hours,
   policies, WhatsApp, email — the last two provenance-gated). Prompt output byte-identical;
   65 existing tests unchanged.

2. **`kb_thin` was never measured, and 500 characters is not "starved" on this fleet.** The
   median live page holds **148** characters of free text and **71 of 92** sit under 500 —
   because content moved into the structured stores. The old rule only looked sane because
   the false `kb_empty` short-circuited it for 49 pages; removing the false empty exposed the
   mis-calibration, and the first fix (`chars < 500 && structured < 5`) still flagged **71 of
   92** — a yellow on 77% of the fleet is noise, not a signal. Now `chars < 500 && structured
   === 0`: **36 pages**, the same order as the 33 the old rule produced, but for a reason that
   survives inspection. The arbitrary `< 5` constant is gone; it had landed exactly on the
   fleet's modal value.

   The self-review lesson, which is Rule 10.11(b) verbatim: the fix was measured on the
   predicate it was written for (`kb_empty`, all 92 pages) and NOT on the two other
   predicates it silently governed. Changing a short-circuit changes every branch behind it.

**One duplication the gate could not see.** The four-clause offerings rule was written out
in `health.ts` AND in `KbSection.tsx` — a one-liner, so below `check:duplication`'s
three-line floor and invisible to it. The panel now renders the server's
`no_offering_chunks` flag matched on `pageId`, the pattern `SettingsSection` already used
for `persona_placeholder`.

**NOT fixed here, deliberately: the pointer bump itself.** Making `invalidatePageCaches`
re-ingest would spend embeddings on every catalog and fact write for the 47 pages that
never read a chunk. The honest options are to stop bumping `kb_active_version` for writes
that do not invalidate the chunk set, or to re-ingest only on the retrieval path — a
reply-path change needing its own measurement and its own ruling. Re-saving Business Info
re-indexes a page today, and the console now says so.

**Kept in sync, per the obligation in `health.ts`'s own docblock:** `/merchant-settings`
and `/reply-quality` both carried the same defect — "no `offering` chunks = no products and
no prices" and "starved ≈ under 500 characters" — which would have produced a merchant
email asking someone to add a price list they had already entered in `catalog_items`. Both
playbooks now query all four stores and carry the re-measured calibration.

## D-089 · Post Reply exclude-keywords stays, despite zero production use (2026-08-22, owner ruling)

**Ruling.** The «كلمات الاستثناء» (exclude-keywords) field in `PostTriggerModal` is **kept**,
and this is not to be re-opened on usage grounds alone. Owner decision, 2026-08-22.

**The measurement that prompted the question.** A production sweep of `posts` on 2026-08-22
found the field has **never been used, by anyone, since it shipped**:

| field | placement | posts using it |
|---|---|---|
| like the comment | top level | 62 |
| image | top level | 16 |
| CTA button | inside «خيارات إضافية» | 4 |
| **exclude keywords** | inside «خيارات إضافية» | **0** |

(out of 271 configured triggers across 23 pages; 152 `all` mode / 119 keyword mode.)

**Why zero is not grounds to delete.** It is a *veto* — a comment matching any exclude word
skips the Post Reply and falls through to the AI pipeline. It costs nothing when unset (it is
`NULL` for every row today) and it sits behind a collapsed disclosure, so it imposes no cost
on the compose path the data shows merchants actually use. Its value is bounded-downside
insurance for the merchant who eventually needs it, not throughput. A feature that is free
when unused is not carrying its zero as a debt.

**What zero DOES tell us, and what it does not.** It is evidence about *discovery and need*,
not about *quality*: the field is deliberately buried, so no one has been offered it. Do not
read the 0 as "merchants tried it and rejected it" — nothing here measures that.

**Also settled by the same sweep: the layering is correct.** Keeping like + image at the top
level and burying exclude + button was validated, not merely asserted — the two top-level
options are used 23% and 6% of the time versus 1.5% and 0% for the two buried ones. That
split is the intended shape working, so the disclosure structure is not to be re-litigated
on "the modal feels long" grounds either.

**Measurement limit, stated so it is not overclaimed later.** This counts *completed*
configurations only. There is no telemetry for "opened the modal and gave up", so nothing
here bounds abandonment, and the per-page concentration of the 271 was not measured — they
may be skewed toward a few heavy pages.

## D-090 · A product sync never flushes the fleet's reply cache and never re-embeds unchanged text (2026-08-22)

**Ruling.** `invalidateCachesForStore` (backend `ecommerce.ts`) no longer runs
`redisScanDelete('cache:ai_reply:*')`, and `KbIngestionService.embedChunks` reuses the
embedding stored under the page's active `kb_version` for every chunk whose embed text
(`title\ncontentNormalized`) is byte-identical, sending only the misses to OpenAI. Both are
Rule 17.1 items: a cache hit turned into a miss is the most expensive change there is, and a
product webhook or the 6-hourly scheduled sync used to do it to **every workspace at once**.

**What was happening, verified in source.** The exact reply cache's key is a SHA-256 over a
list that includes `kbv:{kbActiveVersion}` (`ai.ts buildCacheKey`), so it cannot be
pattern-deleted per page — the only SCAN possible was the whole `cache:ai_reply:*` namespace,
which holds every page's warm replies, store-linked or not. It ran on every product
`create/update/publish/delete` webhook and on every scheduled sync of every non-demo store.
Meanwhile the same function never touched the Postgres tier of that cache (`ai_cache`), so
correctness had always rested on the `kbv:` rotation that `ingestFullPage` performs when it
activates the new version — the flush bought nothing and cost the fleet its hits. The
embedding side: `embedChunks` called `embedBatch` on every chunk of every linked page on every
ingest, with no reuse and no diff, so an unchanged catalog was re-embedded in full, once per
linked page, several times a day.

**Baseline captured before the change (prod Redis, 2026-08-22 ~16:45 UTC):** 15
`cache:ai_reply:*` keys in the entire fleet — the flush had been keeping the exact cache
near-empty — and `metrics:ai:attempts:embedding_ingestion:text-embedding-3-small = 1214`
against `embedding_rag = 50378`.

**After-measurement, read on prod 2026-08-22 19:25 UTC — the entry may now be cited as
proven.** Method: prod on `4185a37` (contains this change), one real `full_sync` enqueued for
the Zid dev store `e3deb6f2-…` (the same `replaceProductsAndRebuildSummary` →
`invalidateCachesForStore` path a product webhook takes), counters read either side.

| | before | after | expected before this change |
|---|---|---|---|
| `cache:ai_reply:*` keys, fleet-wide | 37 | **38** | 0 — the SCAN deleted the namespace |
| `metrics:ai:attempts:embedding_ingestion:…` | 1214 | **1214** | +1 — `embedBatch` emits once per batch, and 4 chunks are one batch |
| `metrics:ai:returns:embedding_ingestion:…` | 1211 | **1211** | +1 |

⚠️ Do not read the 15 → 37 rise between the baseline (16:45) and the first read (19:10) as
evidence of anything: the change only went live at 18:53, and the old flush fired only on a
product webhook or sync — none ran in that window (`last_sync_at` 13:36 / 14:35). The cache
would have grown the same way under the old code. The proof is the row above, and only the
row above: a real sync ran and the count went **up**. **The ingestion half is not vacuous:** the sync really
did re-ingest — `kb_chunks` gained a complete version 5 for page `d88d7c02-…` at 19:25:15
(4 chunks, 4 with embeddings, replacing version 4) — and the provider was never called, which
only reuse can produce. `embedding_rag` moved 50412 → 50420 over the same window: ordinary
reply traffic, untouched by this change and the control that shows the counters were live.

⚠️ Read the counter for what it is: `embedBatch` emits **one attempt per batch**
(`kb/embedding.ts:98`, `MAX_BATCH_SIZE` texts each), so it proves "zero provider calls" and
never measures how many texts or tokens were saved. A store with a catalog larger than one
batch saves proportionally more than this counter can show. If the size of the saving ever
needs a number, take it from `ai_usage_log` rows for `embedding_ingestion`, not from here.

**Consequences.** A page whose fire-and-forget ingest fails keeps its old version and
therefore its old cache entries — that drift is `reingestDriftedPages`' job, unchanged. The
per-page `semantic_cache` delete stays (it is scoped and cheap). `redisScanDelete` itself
stays: the admin `clearCache` and `pipelineMetrics` still use it. Reuse is an optimisation
only — a failed lookup embeds everything (pinned by test). D-088's "re-ingesting would spend
embeddings on every catalog and fact write" trade-off is weakened by this, not reversed:
unchanged text is now free, changed text still costs; that ruling's other reasons stand.
Pinned by `backend/test/services/ecommerce-rag.test.ts` (no SCAN/DEL on invalidation) and
`backend/test/services/kb/ingestion.test.ts` (reuse, all-reusable ⇒ zero provider calls,
fail-open).

## D-091 · The Google Ads signup conversion is the server-side `sign_up`, not a page-load rule and not a `/welcome` route (2026-08-22, owner ruling)

**Ruling.** The conversion Google Ads counts as "a new account was created" is the GA4
`sign_up` event the backend already sends once per account (`recordActivationEvent('signup')`
→ Measurement Protocol), imported into Ads from GA4. There will be **no** dedicated
post-signup route (`/welcome` + `has_seen_welcome`), **no** client-side
`gtag('event','conversion')`, and **no** conversion label copied into the code. The existing
`Sign-up (dashboard)` action — a page-load rule on `jawab24.com/dashboard` — is demoted to
Secondary after the import, never deleted, renamed, or re-pointed at a route that does not exist.

**Why not the brief's `/welcome`.** A page-load rule counts page loads. The defect it was meant
to cure — logins, reloads and the owner's own visits all counting as sign-ups — is a property of
*every* page-load rule, only narrowed by a dedicated route, and still defeated by the lazy-loaded
tag (`strategy="lazyOnload"`, a first-paint decision) on a page that redirects in under a second,
and by any ad blocker. The server already knows the exact moment an account row is inserted, and
sends an event that cannot double-fire (unique `(user_id, event)` index) and cannot be blocked.
Building a weaker signal next to a stronger one that was merely broken is not a fix.

**Why not the onboarding wizard as the trigger.** It is a modal on `/dashboard` gated on
`pages.length === 0 && !onboardingCompletedAt` — a returning merchant with no page sees it, and a
Facebook signup that auto-syncs a page never does. It has no URL. It measures "no page yet", not
"new account".

**The bug that made the server event look absent.** `sign_up` had never reached GA4 — not
because the code path was missing, but because the attribution id it needs
(`users.ga_client_id`) is posted by the browser only after the dashboard mounts, with the token
the auth response issued, while the `sign_up` row is inserted inside that same auth request. At
mirror time the id was always NULL; every send resolved `no_client_id`. The 2026-08-20 synthetic
test that "proved" the event could land was confounded by a fake client id and proved nothing
about the real path. Fix: replay a user's un-mirrored milestones the moment the id is first
stored, with a row claim (`activation_events.ga4_mirrored_at`, migration 0176) shared by the live
mirror and the replay so nothing ever sends twice, bounded to events younger than 24 h so the
~80 pre-existing accounts never convert retroactively. Details in
`.planning/codebase/INTEGRATIONS.md` § GA4.

**What this means for the Ads account (owner-side, after deploy).** Mark `sign_up` a key event
in GA4 once the first real one lands → import it into Ads as a Primary conversion, count One,
90-day click window → set `Sign-up (dashboard)` to Secondary. Internal traffic is then a
non-issue for this conversion — the owner opening the dashboard creates no account — and the GA4
internal-traffic filter is a reporting nicety, not a correctness requirement.

**Limits, stated.** Mobile (Capacitor) signups attribute to nothing: the WebView's cookie jar
never saw the ad click. A merchant who signs up with analytics blocked and logs in elsewhere more
than 24 h later is honestly lost. Neither is a regression — both were unreachable before too.

## D-092 · `check_inventory` resolves the product in code over the page's own index and answers stock locally; the platform is consulted by id only when the local answer is risky (2026-08-22)

**Ruling.** The product a customer means is decided by `backend/src/services/reply/productResolver.ts`,
never by a platform search and never by the model: a model-supplied `product_id` is validated
against the store's rows; otherwise the page's `kb_chunks` product rows are scored (`retrieveProducts`)
— pg_trgm first, then the reply's reused embedding — and the decision is `resolved`, `ambiguous` with
≤3 candidates, or `not_found`. Stock is answered from the synced `ecommerce_products` row; the platform
is asked **by id** (`getProductById`) only for a tracked row at/below `LOW_STOCK_UNITS` (5) whose store
last synced more than `STOCK_REFRESH_MIN` (10, env) ago — never for unlimited (`null`) rows or demo
stores — and the live figure is written back to the row only (count AND status together: `availabilityOf`
lets a platform `out_of_stock` status win over the count, so a count written alone after a restock
leaves the row saying "out of stock" at 10 units — not "risky", so every later local answer repeats
it until the next sync). Sold-out products stay visible as
"out of stock" through every reader that feeds the model — catalog block, index, re-ingest input,
resolver (`SELLABLE_STATUSES`); the mention-card scan stays `active`-only on purpose, so a product the
reply calls sold out gets no card. Per D-051, identity is a code decision;
per D-004, the retired `search_products` tool stays retired — resolution moved *inside*
`check_inventory` behind one seam. `PROMPT_VERSION` is untouched: the tool path bypasses the reply
cache.

**What was wrong, verified in source.** Each platform's `checkInventory` matched the model's free
text by substring; Shopify and Salla returned the FIRST search hit when nothing matched
(`|| products[0]`), so a wrong product, price and URL came back as `success:true` and was cached for
five minutes; Zid scanned page 1 only and its documented `?search=` ignores the term (live capture
2026-08-22). Every reader of `ecommerce_products` filtered `status = 'active'`, so a sold-out product
vanished from the catalog block, the index and the tool — the model said "we don't sell that" for a
product the merchant carries. The card builder re-resolved the product by `ILIKE 'title%'`, a second
matcher, and printed the currency twice; the index printed it twice as well ("Price: 300 SAR SAR").

**Calibration (measured, not guessed).** `scripts/product-resolver-probe.ts` replayed 65 customer
phrasings against the whole production product index (16 products, 3 stores, read-only):
`docs/integrations/product-resolver-probe-2026-08-22.md`. Trigram resolves exact/near-exact titles
(0.62–0.65, «عباية سوداء» 0.40) and close spelling variants (0.33); it RANKS the «ال»-article cases
first but at ~0.16, below the floor — the semantic stage decides those («النظارة» 0.536 vs 0.236).
Cosine cannot separate "right" from "unrelated" («كاميرا»→Sony 0.33, «ساعة ذكية»→nothing 0.41), so
the semantic stage mostly PROPOSES. The cost-weighted sweep (wrong resolve −3, false not-found −3,
ambiguous-with-answer 0) fixed `T_TRI=0.3 G_TRI=0.15 T_VEC=0.25 T_SOLO=0.35 G_VEC=0.12`: **0 wrong
resolves, 2 false not-founds, 42/65 strict**. Tuning to strict accuracy instead (floor 0.35) gives
48/65 with 4 wrong prices and 10 false not-founds — never do that. The two false not-founds are
Arabic transliterations of Latin brands with no Arabic description («جالكسي» 0.24, «ايربودز» 0.18),
which score below unrelated queries: no similarity signal separates them, so they are the open gap.

**Calibration limit, stated.** The probe scored trigram and cosine on the same short phrase. In
production stage 1 runs on the model's `product_name` paraphrase and stage 2 on the reply's reused
embedding of the customer's whole message — the distribution the thresholds were fit on only
approximately (the corpus has a few full sentences; most entries are fragments). Two consequences:
the embedding is reused only in `dual`/`off` retrieval mode, where it is the raw message's — in
`enriched` mode it carries earlier turns about other products, so the resolver embeds the phrase
itself (`ragRetrievalMode()`); and every index-stage decision is logged at info
(`[ProductResolver] decision`: phrase, top-3 ids with tri/vec, outcome) so the real score
distribution can be read off production before the thresholds are trusted further. The candidate
cut is the UNION of top-20 by trigram and top-20 by cosine, not one top-20 by the greater of the
two — a single-category catalog has more than 20 products at cosine 0.3–0.5, and one cut would drop
a near-exact title at trigram 0.33 before stage 1 saw it.

**Premise corrected by the eval.** The plan assumed a 50-product catalog makes the tool "the primary
path" because the inline block caps at 15 products. It does not: RAG's top-10 product chunks cover
a 40-product store, and at temp 0 the model called `check_inventory` **0 times in 12 attempts** on
the grown fashion fixture — answering correctly from context (sold-out stated, ambiguity listed,
not-found honest). The resolver therefore governs every call the tool *does* get, not every stock
question; its index-side half (sold-out rows indexed, price printed once) is what the eval exercises.
Eval: Cat 80 added (6 PASS pinning the customer-visible behaviour, 3 XGAP pinning the tool outcomes
until the model reaches the tool); Cat 48 6/6 and Cat 79 3/3 after the change; Cat 79's ids moved
785–787 → 788–790 because Cat 48 already used 786/787.

**Observability.** `metrics:ecom:check_inventory:{by_id,id_unknown,by_trigram,by_hybrid,
by_title_trigram,embedded,ambiguous,not_found,no_index,local,stale_served,demo_local,
live_refresh,live_cached,live_missing,live_failed}` — every resolved call emits one resolver
outcome AND one stock outcome, so the keys sum to twice the calls — `metrics:product_card:tool:*`,
`metrics:product_card:cooldown:suppressed`. A failed live refresh reaches Sentry once per store per
refresh window (`ecom:stock:failed:{store}`); the counter carries the volume. Re-probe on the first real 50+ product catalog; the
`not_found` share is the alarm. Deferred with their triggers: IDs in the inline block, a
`title_normalized` column, a partial index on `type='product'`, Shopify `inventory_levels/update`.

## D-094 · Salla listing launches in Saudi Arabia, UAE and Kuwait — not Saudi-only (2026-08-20, owner-decided; recorded 2026-08-23)

**Ruling.** The Salla App Store listing's *Supported Countries* field is ticked for the three
countries where Salla **registers merchants**: 🇸🇦 Saudi Arabia, 🇦🇪 UAE, 🇰🇼 Kuwait. Qatar, Bahrain
and Oman are NOT ticked — Salla supports selling and shipping *into* those markets, but that
describes where a Saudi or Emirati merchant's **customers** live, not where the installing
merchant's store is registered.

**Reverses the recommendation this file's companion carried until today.**
`docs/store-listing/salla/PORTAL_FIELD_MAP.md` recommended **Saudi-only**, on three grounds. Two
were wrong and are recorded there as superseded so they do not get restored:

- «Syria is barred on WhatsApp and the copy leads with WhatsApp» is a real constraint on our own
  direct signups, but Salla does not onboard Syrian merchants — **Syria never appears in this
  picker**. The constraint is true and irrelevant, which is the easiest kind of reasoning to carry
  forward unexamined.
- «Salla's merchant base is overwhelmingly KSA» describes where the merchants are. It is not a
  reason to exclude the ones who are not: excluding UAE and Kuwait does not improve KSA service,
  and the wizard prices per plan, not per country, so there is no per-country pricing exposure
  either (see the note below on the original "free tier" wording).

The third ground survives — a country we cannot serve is a support burden and a review risk — and
it is discharged by an explicit check rather than by narrowing the market.

⏳ **Open check, owed before the countries are ticked in the portal:** confirm WhatsApp Cloud API
messaging is available for a sender registered in the UAE and Kuwait, from Meta's own docs
(AI_INSTRUCTIONS §10.12 — never assume third-party API behaviour). Our records bar exactly one
country and no GCC country appears in them, but that is our record, not Meta's policy.

⚠️ **The field's semantics are unverified.** This ruling assumes *Supported Countries* means the
installing merchant's registration country. Confirm the wizard's wording at fill time; if it turns
out to mean market reach, revisit — widening is a portal edit, but retracting a country after
merchants install is not.

⏳ **Second open check (added 2026-08-23):** Salla's own publishing-standards article lists this
field's values as "UAE or Saudi Arabia" (salla.dev/blog/standards-salla-apps-publications). The
2026-08-20 fill session saw the picker accept more than two countries, so Kuwait is probably
offered — confirm it is actually in the picker before recording it as ticked. If it is not, the
ruling degrades to SA · UAE without further debate.

**Note (2026-08-23):** this entry was drafted on 2026-08-20 as D-088 and renumbered on rebase —
D-088 had meanwhile been taken by the Business-Info presence ruling. The "free launch tier"
argument it originally leaned on is superseded by the 2026-08-23 wizard measurement (no free
pricing type exists for public apps); the pricing point stands only in its weaker form, that the
wizard prices per plan, not per country.

## D-093 · Salla Easy-Mode claim: the owner-email proof applies to LIVE stores only; demo/development stores bind to whoever claims them

> Numbered before D-094 but recorded after it: D-094 was drafted on 2026-08-20 as "D-088" and
> renumbered on its rebase the same hour this entry was written; both landed 2026-08-23.

**Decided:** 2026-08-23 · **Status:** Active (amends D-031; D-031's proof is unchanged for live stores)

**Ruling.** `claimStoreHandler`'s `verifyOwnership` reads `store/info` (as it already did for the
email) and returns `true` without the email comparison when `type` is `demo` or `development`.
`live`, a missing field, and any unknown value keep the full D-031 proof — the exemption is an
allow-list of the two documented non-live values (docs.salla.dev/5394261e0), never "anything that
is not live". The `no_email` gate on the Jawab24 account stays in front of the verifier.

**Why.** The first real token push against the production app (2026-08-23, demo store
`2108580704`) exposed a lock-out the dry-run never reached: a Salla demo store's registered email
is a synthetic `<slug>@email.partners` that nobody can sign in with — Jawab24 has no
email/password signup, Facebook login rewrites `users.email` from the profile on every sign-in
(so a one-off DB edit dies at the next login), the demo store's settings pages 404 (the email
cannot be changed), and the Partners portal's Demo/Ready Store forms take no email at all. At the
same time, **an app in Development status can only be installed on demo stores**
(docs.salla.dev/421410m0). So under D-031 as written, no store that exists before publication
could ever be claimed — not by the Tier 3 rehearsal (`docs/SALLA_TEST_PLAN.md`) and not by Salla's
reviewer using the Service Trial credentials. The proof exists to stop a stranger attaching a real
merchant's store to their workspace; a demo store has no merchant, no customers and no orders of
value, so for it the match was never a proof, only a lock-out. Real merchants' path is untouched.

**Rejected.** (a) A real Salla store registered with the review account's email — unusable
pre-publication (demo-only installs). (b) Editing the reviewer user's `users.email` — overwritten
at their first Facebook login. (c) An env allow-list of merchant ids — a second, hand-maintained
source of truth for something `store/info` already states. (d) Exempting everything not `live` —
an unknown future type must fail closed.

**Residual risk, stated.** Anyone who installs the app on *their own* demo store can bind it to
*their own* Jawab24 workspace without an email match — which is exactly the intended use, and
yields a store with no real customers. A reviewer who installs onto their own test store instead
of using ours now succeeds rather than hitting `email_mismatch`.
---

## D-095 · Zid App Market prices match the website: 146 / 296 SAR ex-VAT — the D-072 gross-up is withdrawn (2026-08-23, owner ruling)

**Context.** D-072 listed the Zid plans above the website price (189 / 379 SAR) so that the
net after Zid's 20% commission and withholding tax would land on the Stripe USD price. The
owner reported that the resulting sticker — 217.35 / 435.85 SAR with VAT — is what makes the
product hard to sell, while the measured cost per reply is ~$0.002
(`backend/src/config/plans.ts` margins 75–80% at full quota use, see
`project_pricing_economics`). The direct competitor on the same shelf (Radad, app 5668) lists
10,000 replies at 113.85 SAR displayed.

**Ruling.** The Zid plans are priced at the website's USD price converted at 3.75 SAR/USD,
entered ex-VAT in the Partner Dashboard: **الأعمال (3740) = 146 SAR** (= $39, 167.90 SAR
displayed) and **الاحترافي (3741) = 296 SAR** (= $79, 340.40 SAR displayed). Trial stays 14
days. Applied in the Partner Dashboard on 2026-08-23 and verified on a fresh load; the app is
still `Draft`, so the numbers remain editable until publication.

**Consequences.** Jawab24 absorbs Zid's commission and the withholding tax instead of
passing them to the merchant: net per Business subscription ≈ $29–31 against a maximum AI
cost of $9, net per Pro ≈ $60–63 against $20. A marketplace merchant now sees the same
price as a website merchant plus KSA VAT, which Zid adds for every app. The quotas are
unchanged; a quota increase is a separate decision. The WHT rate is still unconfirmed — it
moves the net by 5–15%, not the ruling.

**Rejected.** (a) Matching Radad's per-reply price (≈99 SAR ex-VAT for 10,000) — the net
≈ $21 sits under the $20 full-quota AI cost, so any heavy merchant is sold at a loss.
(b) Keeping the gross-up and cutting the website price instead — gives up revenue on the
direct channel, which has no commission, to fix a marketplace-only problem.

---

## D-096 · Order-tracking identity verification is self-healing: Phase 2 verifies against whichever Phase-1 blob exists or a live read — the pending blob is a saved platform call, never a gate (2026-08-23)

**Context.** The e-commerce order tools are two-phase: `lookup_order` / `track_shipment`
confirm the order exists, park its data in Redis under
`ecom:pending:<store>:<order|shipment>:<n>` (10 min), and return an identity challenge;
`verify_and_get_order` / `verify_and_get_shipment` compare the customer's name or phone
against that blob and only then return the data. Phase 2 arrives on the customer's **next**
message — a fresh request whose history is text only — so the model re-decides which verify
tool to call with no memory of the Phase-1 tool, and often calls it with no Phase 1 in that
request at all. Measured on the Salla review page 2026-08-23: `lookup_order` 7 calls,
`track_shipment` 0, `verify_and_get_shipment:verification_expired` **4 of 4**. The backend
read only the requesting family's key and its own challenge text said "call
verify_and_get_order **or** verify_and_get_shipment". Two smaller cliffs shared the error: a
cache-served Phase 1 never wrote a blob, and a customer answering after 10 minutes had none.
The customer-visible result was a correct identity answer met with «انتهت صلاحية التحقق».

**Ruling.** `handleVerification` finds something to verify against in this order — the
requesting family's blob, the sibling family's blob, then a **live platform read of the
requested family** — and the identity comparison (`namesMatch` / `phonesMatch`, unchanged)
always runs **before** any read of the data the customer asked for. Once it passes, a
sibling-only blob triggers a live read of the requested family so a tracking question gets
tracking, degrading to the order summary rather than an error if that read fails. A live
Phase-2 read parks its blob, so a retry inside the TTL is free. The Phase-1 challenge names
the verify tool of its own family. `verification_expired` is retired as unreachable.
Counters: the tool outcome stays `success`/`<error>`; `metrics:ecom:verify:{own|sibling|
live|requested_empty|requested_live_failed}` records how each pass was satisfied. The last
two are deliberately separate: `requested_empty` is a successful read of a family the
platform has nothing for (an unshipped order asked about by tracking — the commonest
cross-family case, and healthy), `requested_live_failed` is a throw. Folding them together
would report the healthy path as a platform failure and bury the 403 that SALLA_TEST_PLAN
3.8 uses these counters to find. Demo stores route the order tools to
`services/demoOrders.ts` so the eval can reach them (Cat 81, measured same-day: pre-fix
2/4, fixed 4/4).

**Security, assessed.** The pending blob never gated anything — both phases already run in
one request when the customer supplies number and name together, and `lookup_order` already
answered the "does this order exist" question. Guesses per message rise from ≤3 to ≤6
(`MAX_TOOL_CALLS_PER_ROUND` 3 × `MAX_TOOL_ROUNDS` 2) inside the DM limiter's 10
messages/min/sender/page, against a full first-name token or a 9-digit phone.

What the identity check gates, precisely — the two halves are easy to conflate and an
earlier draft of this ruling stated the stronger one wrongly:
- It gates every BYTE returned. No order or shipment field reaches the model on any path
  before `namesMatch`/`phonesMatch` passes; PII is stripped from what it then returns.
- It does NOT gate the platform READ on the no-blob path — there the order must be fetched
  to have anything to compare against, so a wrong guess against an order number that exists
  costs one platform call and parks that blob. Measured, not assumed (probe, 2026-08-23:
  wrong name + empty Redis ⇒ 1 `lookupOrder`, 1 `SET ecom:pending:…`). It is bounded rather
  than free: the park means further guesses against the same order number cost no read, so
  the ceiling is one extra call per (order number, family) per 600 s — the same shape of
  budget `lookup_order` already hands an unauthenticated DM, which is why it is accepted.
  Once any blob is held, a failed guess causes no read at all.

A per-order daily cap on failed checks is a cheap follow-up if the counters ever show
guessing; it is not needed to make this change safe.

**Rejected.** (a) *Fix it in the prompt / tool descriptions* — cannot work: at Phase-2 time
the model has no record of the Phase-1 tool, so no wording can make it pair correctly;
the description change shipped only to stop teaching the cross. (b) *Make one family a
superset of the other* — they come from different platform calls (Salla's shipments
endpoint needs `shipping.read`; Shopify's fulfilment is a separate GraphQL selection), so
merging them doubles every Phase-1 call for the common case. (c) *Use the pending blob as
the Phase-1 cache and drop `ecom:tool:*` for order tools* — simpler, but it changes the
`cached` counter's meaning and three pinned tests; recorded as a later simplification.

## D-097 · Salla storefront links come from the platform's `urls.customer`, the store domain is canonicalised at ingest, and a model reply envelope is parsed in ONE place that can never pass raw text (2026-08-23)

**Context.** The first real conversation on a Salla-linked page (the «Jawab24 Salla Test»
page, demo store `demostore.salla.sa/dev-jkgsyu3w6pzzfrzw`, 26 messages) surfaced three
defects with three separate causes. (1) The last reply reached the customer as the French
answer **followed by the raw `{"reply":…,"intent":…}` envelope**, flagged clean: the
e-commerce tool path runs without `response_format`, and its two inline parsers — plus the
failover provider's — fell back to the raw content on a parse failure (one of them with no
flag at all). (2) The store link rendered `https://https://demostore…`: Salla's
`store/info.domain` is a full URL, with a path for demo stores, stored verbatim, and every
reader prefixed `https://`. (3) No product or category link existed, so the model invented
`?category=تنورة` for a customer who asked for the skirts page three times: the mapper read
`p.slug`, which Salla does not have (20/20 real rows `handle = NULL`), while the real links
— `urls.customer` on products and on `categories[]` — were in every payload and discarded.
The same class as the invented Zid tracking fields (D-095 era): an integration written
against assumed field names, verified only by a demo seed that hand-typed the "right" data.

**Measurement that shaped the ruling.** Forcing the strict reply grammar on the tool path
would have made the leak grammatically impossible — but `response_format` alongside `tools`
**suppresses tool calling** (gpt-4.1-mini, 10 runs per arm: a stock question 10/10 →
3/10 `check_inventory` calls, an order question 10/10 → 5/10). The API accepts both; the
old "cannot coexist" comment was wrong about the mechanism and right about the outcome. On
the real tool prompt the leak shape is rare (0/12 on the replayed thread; 1/12 bare prose),
and JSON-wrapping the assistant history (the #773 mechanism) took that to 12/12 clean — a
history-format change held back as a separate, owner-approved step.

**Ruling.**
1. **One parser.** `ai-worker/src/services/reply/parseReplyContent.ts` serves every reply
   call site (plain, provider, both tool phases). It parses, else **salvages** an embedded
   envelope (its `reply` IS the answer; flag `json_salvaged`), else **empties** a broken one
   (flag `invalid_json`), else passes envelope-free prose through. Raw content carrying an
   envelope is never the reply. The empty-reply arbitration (`assertDeliverableOrThrow`) is
   shared too; the tool path's hard-coded English "Thank you for your patience!" is gone,
   and a Phase-2 empty reply propagates (the verified order data exists only in that call)
   rather than regenerating without it. The eval harness fails ANY case whose delivered
   reply contains an envelope marker. The tool path keeps `response_format` off, for the
   measured reason above, recorded beside the shared schema constant (`replySchema.ts`).
2. **Canonical domain.** `services/storeDomain.ts:normalizeStoreDomain` — scheme stripped,
   host lower-cased, **path kept**, no trailing slash — applied in `fetchStoreInfo`;
   `storeBaseUrl` is the only way to build a URL from the column. Migration `0177` rewrote
   existing Salla rows in `ecommerce_stores` and `pending_ecommerce_installs` (collisions
   skipped with a WARNING, never resolved in SQL). Zid keeps hostname-only (its stores have
   no path; re-keying would change a unique key); Shopify already validates a bare host.
3. **Links from the platform.** New `ecommerce_products.product_url` holds the platform's
   canonical URL (Salla `urls.customer`); `productUrlFor` is the one resolver — canonical
   URL first, handle-derived `/products/{handle}` for Shopify/Zid, **nothing** for a Salla
   row without one. The `/p/{slug}` branch is deleted. Category links are gathered per sync
   and stored atomically on `platform_data.categories` (`saveStoreCategories`), rendered as
   a `Categories:` line with its own budget. Product cards gate on `productUrlFor`, so Salla
   cards fire. The demo fashion store is seeded in the real row shape.

**Out of scope, on record.** Return policy / contact unknown (Salla never syncs
`policiesSummary`; `storeEmail` is the merchant's login, not customer-facing); the
third-person voice («their support»), Gulf replies to a Levantine customer, and
accent-less French reading as the Latin floor are model/detector behaviour with existing
rulings — none of it is a prompt change, which this PR does not make.

## D-098 · Plain prose is an anomaly only where the envelope was enforced; `json_salvaged` is informational, never an alarm (2026-08-23)

**Context.** Three hours after D-097's shared parser reached production, the Salla review page
carried «خطأ في معالجة الرد» on 10 correct replies (`flag_reason = invalid_json,low_confidence`),
each with a `flagged_reply` push — against **0** such flags in the 12,297 AI replies of the
previous week. The customer had received the right text every time. The parser's `plain`
outcome (`invalid_json` + `low`) was the plain path's long-standing fallback, where the model
is made to emit the envelope (`response_format` json_schema) and prose therefore means
something broke. D-097 routed the two e-commerce tool sites through the same parser — and
those sites run **without** `response_format` (it suppresses tool calling, 10/10 → 3/10),
so prose there is a normal, correct answer. Before D-097 that site had accepted prose quietly
(`confidence: medium`, no flag) for months. Blast radius today: our own test page only (the
three live stores are ours), but every store-linked page's tool path was affected.

**Ruling.**
1. The parser's context carries `envelopeEnforced: boolean` — **required**, so a new call
   site must say which it is. Plain prose is `invalid_json` + `low` only where it is `true`
   (plain path, failover providers). Where it is `false` (both tool phases) prose is used
   as-is with `medium` confidence and no flag. The envelope outcomes (`json`, `salvaged`,
   `broken`) are about the envelope, not the grammar, and do not change.
2. `json_salvaged` is the same class of marker as `reply_shortened`: the reply delivered was
   correct. It is stripped at `computeReplyFlags` — the one choke point production and the
   playground share — so it never reaches `flag_reason` (it has no i18n label) and never
   trips `needsAttention` or the push. It stays countable in the ai-worker's
   `invalid_json_reply` log line (`salvaged: true`).
3. Refines D-097 ruling 1 ("passes envelope-free prose through"); reverses nothing.

**Evidence.** Prod rows 2026-08-23 15:32–15:36Z on page `eb06462a-…`; fleet count before/after
the 14:55Z deploy; unit tests pin both sites (`parseReplyContent.test.ts`,
`ecommerceToolHandler.reply.test.ts`) and the strip (`generator.test.ts`), each mutation-checked.
