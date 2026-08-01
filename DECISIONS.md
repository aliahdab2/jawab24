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
  state. Trials mirror Shopify's clock (trialDays) and bypass the Stripe trial ledger.
- No Stripe beside Shopify: shopify-billed accounts are hard-blocked from
  checkout/change-plan/subscription-intent (code `SHOPIFY_BILLED`), the top-up CTA is
  hidden, and the pricing page routes plan management to the admin deep link
  (`admin.shopify.com/store/{store}/charges/{app_handle}/pricing_plans`,
  `SHOPIFY_APP_HANDLE` env). Never adopt over a LIVE stripe/manual row — Sentry, a
  human untangles it.
- Store-connect plan-gating is deliberately DEFERRED: gating connect on a plan would
  break the reviewer-walked install funnel; revisit after listing approval.

**Verify-first caveat (V3).** Whether `activeSubscriptions` reflects App Pricing
enrollments is unverified until the dev-store dogfood; the fork is isolated inside
`fetchShopifyActiveSubscription` — if it proves wrong, its internals swap to the
Partner API with zero caller changes.
