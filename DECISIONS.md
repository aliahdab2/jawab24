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

<!--
Template for new entries:

## D-NNN · <one-line ruling>
**Decided:** <YYYY-MM-DD> · **Status:** Active | Superseded by D-MMM
<What was decided, in 1-3 lines.>
**Why:** <The reasoning, so it isn't re-derived.>
-->
