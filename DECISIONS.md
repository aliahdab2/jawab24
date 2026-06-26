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

<!--
Template for new entries:

## D-NNN · <one-line ruling>
**Decided:** <YYYY-MM-DD> · **Status:** Active | Superseded by D-MMM
<What was decided, in 1-3 lines.>
**Why:** <The reasoning, so it isn't re-derived.>
-->
