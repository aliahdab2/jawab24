# Business Info Audit — «تقييم معلومات نشاطك التجاري»

> **Status: DESIGNED, not built (2026-07-26).** Owner approved the direction and asked to start simple and improve.
> One merchant-pressed button that reviews the merchant's Business Info and reports what will not work. No warning banners, no score.

## Context — the problem that started this

Waleed Raffas (`waleedraffas@gmail.com`, page «متجر أجدابيا للأصلي», Ajdabiya/Libya, starter trial) wrote this line into his Business Info:

```
ملاحظة: اي عميل يرسل رقم تلفونه تحوله ضمن (تم التحويل)
```

He is instructing the AI to move a lead into the `converted` status. **It has never worked and nothing tells him.** The KB only feeds the reply model; the AI has no tool that can write to `leads`. The only writer is `updateLeadStatus` (`backend/src/services/leadExtractor.ts:1036`) behind `PATCH /leads/:id/status` (`backend/src/routes/leads.ts:35`) — i.e. the dashboard.

He is not a careless merchant. He is the platform's **best sub-stage user** — 11/11 leads tagged by hand (see `CUSTOM_LEAD_STAGES_PLAN.md` and the 2026-07-24 adopter note). The KB was simply the only place he had to ask for automation.

The same KB contains a second silent failure: he wrote «ارجو اظهار الصورة للزبون» next to `https://ibb.co/V0SWbqSR`, which is an ImgBB **viewer page**, not an image file — so Messenger renders a link card, not the picture. His other link (`files.catbox.moe/5mo9uz.jpg`) is a direct `.jpg` and works. Nothing in the product tells him which is which.

**Generalized problem:** merchants write instructions the product cannot execute, believe they are live, and conclude the product is broken. With most subscribers at ≤5 leads, this is an activation and churn vector, not a cosmetic one.

## Product decisions (owner-confirmed)

| Decision | Rationale |
|---|---|
| **One explicit button, no warning surfaces** | Passive warnings on a page the merchant edits constantly become wallpaper; a permanent badge on «نشاطك التجاري» reads as "you did it wrong" on every visit. An action the merchant chose gets read. |
| **No score / no "72 / 100"** | Not actionable, and a low first score on a merchant who just typed his whole catalog is a churn trigger. Verdict line + ranked findings instead. |
| **Cap the findings (~5)** | A merchant handed 30 findings fixes zero. Ranking matters more than completeness. |
| **Never auto-fix** | Silent AI writes into merchant-verified content is the D-008 mistake. Show finding + suggested edit; the merchant applies it. |
| **Start simple, improve** | V1 below is deliberately the smallest thing that catches Waleed's two real failures. |

## The capability manifest — verified against the pipeline, not assumed

This is the ground truth the classifier is given. **Every row was checked in code on 2026-07-26.** A wrong row here ships a confident lie to a merchant, so nothing enters this table without a file reference.

| id | What merchants write | Real? | Evidence |
|---|---|---|---|
| `lead_status_change` | "move him to تم التحويل" / any lead status or sub-stage change | **✗** | Only writer `updateLeadStatus` (`services/leadExtractor.ts:1036`) behind `PATCH /leads/:id/status` (`routes/leads.ts:35`). No AI tool touches leads — the tool list is order/shipment/inventory only (`ai-worker/src/services/ecommerceToolHandler.ts:62-142`) |
| `conditional_silence` | "don't reply when they send an image / X" | **✗** | Silent-skip paths exist but are **system-owned**: spam, emoji-only, debounce, hold (`services/reply/messageProcessor.ts:611-701`, `commentProcessor.ts:74`). Nothing reads the KB to decide silence |
| `human_handoff` | "hand this customer to a human" | **✗** | Handoff pause is **implicit** — triggered by the merchant replying manually (`services/conversationPause.ts`). `escalation.ts` notifies on a timer. The AI can initiate neither |
| `collect_payment` | "send them a payment link" | **✗** | `payment_requests.user_id → users.id` (`db/schema.ts:916`) = Jawab24 billing the merchant, not the merchant billing their customer |
| `scheduled_message` | "follow up after 24 hours" | **✗** | Nudge timing is system-owned (`services/reply/nudge.ts`) |
| `conditional_reply_text` | "when they say سعر, answer …" | **✓** | Plain KB text. Waleed's KB is full of these and they work |
| `dialect_mirroring` | "speak Libyan dialect with customers" | **✓** | Prompt v40/v44 dialect mirroring |
| `read_customer_image` | AI understanding a photo the customer sent | **✓** | `services/imageUnderstanding.ts`, gpt-4.1-mini vision |
| `bare_link_image_preview` | "send only the link so the image shows" | **⚠️** | **Not our behavior at all** — Messenger's link preview. Works only for a direct image-file URL |

**The ⚠️ row is a design constraint, not a footnote.** Findings are not binary. A third state — *works, but not because of Jawab24* — is required, or the audit will confidently take credit or blame for platform behavior it does not control.

## Finding classes

| Class | Engine | Cost | Examples |
|---|---|---|---|
| **A — impossible instruction** | LLM classifier against the manifest | 1 call | `lead_status_change`, `conditional_silence` |
| **B — internal contradiction / data defect** | Deterministic, local | $0 | duplicate delivery city, product with no price, two prices for one product |
| **C — platform-dependent** | Deterministic, local | $0 | non-direct image URL where the KB asks to show an image |
| **D — coverage gaps** | **Reuse, don't rebuild** | $0 | existing readiness chips (`BusinessReadinessCard.tsx`) + open rows from `services/kb/gap-detector.ts` |

Class A cannot be done by an LLM alone: *"can Jawab change a lead's status?"* is a fact about **our product**, not about language. The manifest supplies that fact; the model only matches instructions against it.

**Note on the no-hand-maintained-lists rule:** the manifest is a list of **our features**, not a list of Arabic phrasings. There is deliberately no regex for «تحوله ضمن» — the model handles infinite phrasings, the manifest supplies truth. This distinction is the reason the approach is acceptable.

## Anti-hallucination contract (this is what makes a cheap model safe)

A finding is only accepted when the model returns:

1. `manifestId` — from a **closed enum** (the ✗ rows above). Cannot name a capability that does not exist.
2. `quote` — **verbatim** from the KB. The server drops any finding whose quote is not a literal substring of the exact KB string sent to the model.

Result: the model cannot invent a capability (not in the enum) and cannot invent a violation (quote will not match). Hallucination becomes *structurally impossible* rather than statistically unlikely. This is the load-bearing design element — without it, one false "this rule doesn't work" destroys merchant trust on first run and the feature is worse than nothing.

## Model — pinned, NOT the merchant's model

**`gpt-4.1-mini`, hardcoded.**

- **Do not route through `services/aiModelResolver.ts`.** That resolves the *merchant's chosen reply model*. A merchant who picks `gpt-4.1-nano` to cut cost must not silently get a worse audit. Precedent: `services/imageUnderstanding.ts` pins 4.1-mini regardless of the merchant setting.
- Mini is the right tier because this is **constrained classification with the ground truth supplied in the prompt**, not open reasoning.
- Must go through `makeTrackedOpenAI` (`services/openaiClient.ts`) — raw `new OpenAI()` is ESLint-banned outside that module, and the wrapper gives `ai_usage_log` + §13c `attempts`/`returns`/`logged` metrics for free.
- Requires a new member on the `AiPipeline` union (`backend/src/types/aiPipeline.ts`): `business_info_audit`. Not a reply pipeline — must **not** be added to `REPLY_PIPELINES` or it will distort the cache hit-rate denominator.

**Cost:** Waleed's KB ≈ 2.6k in / ~300 out ≈ **$0.0011 per run**. Classes B and C cost $0. Cached in Redis on a hash of the KB text, so re-pressing without edits is free.

## Placement — the trap

The obvious home is the readiness card on `/business`. **It reaches nobody today.**

`/business` is gated by `isCatalogVisible(user)` → `user.isAdmin === true` (`frontend/src/lib/featureFlags.ts`) — platform admins only, and the page bounces everyone else to `/dashboard`. Waleed cannot open it.

**Put the button in `frontend/src/components/knowledge-base/KnowledgeBasePanel.tsx`** (footer, next to the raw-mode toggle). That panel is shared by:
- `KnowledgeBaseModal` → `/pages?openKb=true` — **what every merchant uses today**
- the inline editor on `/business` — where it lands automatically when B1 goes GA

One insertion point, both surfaces, no canary problem.

## Two surfaces, one service — merchant + admin

The founder needs to run this **across merchants**, not just on their own page. Today that work is done by hand through the `/merchant-settings` and `/reply-quality` skills, one merchant at a time. The audit is the self-serve version of exactly that, so it ships to both surfaces in V1.

**Admin home: `frontend/src/components/admin/customer/KbSection.tsx`** (the per-page Business Info health card on `/admin/customers/detail`). It already renders exactly this shape — a `Card` per page with chunk-type pills, char count, gap count, and two **lazy expanders** (`toggleText` → full KB text, `toggleGaps` → unresolved gaps, each fetching on first open via `adminApi`). The audit is a **third expander** (`runAudit` → findings), following the identical pattern. Almost no new UI, and it lands where the founder already looks when a merchant reports "the AI isn't doing what I told it".

**Backend: one service, two thin route wrappers.** The merchant endpoint is workspace-scoped (`resolveWorkspace`); admin acts across workspaces and cannot use it. Precedent already exists — `GET /admin/pages/:pageId/kb-status` and `/kb-gaps` sit beside the merchant-scoped `/pages/:id/kb-gaps`.

- merchant → `POST /pages/:id/business-audit` (read scope, workspace-gated)
- admin → `POST /admin/pages/:pageId/business-audit` (admin-gated, any page), delegating through `backend/src/services/admin/kb.ts` like the other admin KB endpoints

**Never fork the audit logic between them.** Both call the same `services/businessAudit.ts`. Divergent findings between what the founder sees and what the merchant sees would make the admin view useless for support.

### What differs in the admin view (presentation only)

| | Merchant | Admin |
|---|---|---|
| Findings shown | capped at ~5 | **all of them** |
| `manifestId` | hidden | **shown as a badge** (`lead_status_change`) — the founder needs the raw signal, and Latin ids scan faster than Arabic prose |
| Fix links | yes | no — admin is read-only diagnosis, never edits the merchant's KB from this card |
| Verdict line | yes | replaced by a per-class count |

The ~5 cap exists for merchant psychology, not correctness. The founder wants completeness.

**Cache is shared and that is a feature.** Both routes read the same Redis entry keyed on the KB hash, so if the merchant already ran the audit, the admin view is free and instant — and, more importantly, the founder sees *exactly the findings the merchant saw*.

**Read-only.** The admin run mutates nothing: no KB write, no re-ingestion, no notification to the merchant.

### Why this makes V2 telemetry much stronger

Once findings are persisted (V2), `/admin/customers` can carry a column — *"3 impossible rules"* — turning the audit into a cross-merchant sweep. That single column answers both questions at once: **which merchants are silently broken** (support), and **which unbuildable feature is most requested** (roadmap). Waleed's `تم التحويل` line stops being one merchant's mistake and becomes a counted demand signal.

## V1 — the simple version

**Deliver:**
1. `packages/shared/src/businessAudit.ts` — manifest (ids + severity + fix-hint keys), finding types, and the deterministic class-B/C checks. Shared so backend checks and frontend rendering agree on one shape.
2. `backend/src/services/businessAudit.ts` — run deterministic checks → one classifier call → verify quotes → merge, rank, cap at 5.
3. `POST /pages/:id/business-audit` in `routes/pages.ts` (**read-scope registration**: any workspace member may run it; it mutates nothing). Rate limit like `test-reply` (10/min).
4. `KnowledgeBasePanel` footer button + a results sheet listing findings.
5. i18n keys in the **existing `kb` namespace** (the panel already calls `useTranslations('kb')`) — avoids the 4-step new-namespace registration and its `getMessages.ts` trap.
6. `POST /admin/pages/:pageId/business-audit` via `services/admin/kb.ts`, + `adminApi.runBusinessAudit(pageId)` in `frontend/src/lib/api.ts`.
7. Third lazy expander in `KbSection.tsx` rendering the uncapped findings with `manifestId` badges. Keys go in the existing `admin` namespace (`customer.*`, matching `kbViewFull` / `kbGapsTitle`).

**Ranking:** class A above class C above class B. An impossible rule outranks a typo.

**Explicitly out of V1:** telemetry aggregation, auto-run after first save, tap-to-fix deep links, auto-apply, coverage class D, the cross-merchant `/admin/customers` column.

### Expected V1 output on Waleed's KB

```
تقييم معلومات نشاطك التجاري — 4 ملاحظات

① قاعدة لا يستطيع جواب تنفيذها
   «اي عميل يرسل رقم تلفونه تحوله ضمن (تم التحويل)»
   جواب لا يستطيع تغيير حالة العميل المحتمل. يُنشأ العميل بحالة
   «جديد» تلقائيًا عند مشاركة رقمه، والتغيير يتم من صفحة العملاء.

② قاعدة لا يستطيع جواب تنفيذها  (سطران)
   «لما زبون يرسلك صورة لا ترد عليه»
   جواب يقرأ الصورة ويرد عليها دائمًا؛ لا يمكن إيقاف الرد على نوع
   رسالة معيّن. لإيقاف الرد على محادثة، أوقفها من صفحة الرسائل.

③ رابط لن تظهر منه الصورة
   «https://ibb.co/V0SWbqSR» — بخور العنفر الملكي
   هذا رابط صفحة وليس رابط صورة مباشرًا، فلن تظهر الصورة للزبون.
   رابط بخور إنسام صحيح (files.catbox.moe/5mo9uz.jpg) — استخدم
   الصيغة نفسها.

④ مدينة مكرّرة في جدول التوصيل
   «الابيار 25» مذكورة مرّتين.
```

## V2 / V3 — improve

- **V2 — findings become a product backlog.** Persist accepted findings keyed by `manifestId`. *"14 merchants wrote a rule asking the AI to change lead status"* is the cleanest feature-demand signal we would have — far better than inferring from usage. Waleed's line is not a mistake; it is a feature request written in the only place he had. Also V2: run the audit **once** automatically right after a merchant first saves Business Info, shown inside that same save flow (not a banner — this respects the no-warnings decision while not depending on the merchant's curiosity; the merchants who most need it are the ones who will never press a button). Plus tap-to-fix jumps reusing the `onFixChip` pattern.
- **V3 — show the consequence, not the rule.** The most persuasive output is not a finding list but the actual result: *"a customer asks X → Jawab answers Y."* The machinery exists (`services/reply/playgroundContext.ts` + `replyGenerator`, already wired to «جرّب أن تسأل جواب»). Slower and costlier — hence not V1.

## Traps (do not skip)

1. **`/business` is admin-canary** — see Placement. A button there ships to zero merchants.
2. **Do not use `aiModelResolver`** — pin the model, per the reasoning above.
3. **Do not use raw `new OpenAI()`** — ESLint-banned outside `openaiClient.ts`; use `makeTrackedOpenAI` or the call escapes `ai_usage_log`.
4. **Do not add `business_info_audit` to `REPLY_PIPELINES`** — it would dilute the reply cache hit-rate metric (the 54%-reads-as-12% problem documented in `types/aiPipeline.ts`).
5. **Verify quotes against the exact string sent to the model** — normalizing the KB before the call but comparing against the raw column silently drops every valid finding.
6. **Arabic copy is فصحى** (rule 5). Scope boundary: this is *our* copy. It does not touch the reply pipeline's deliberate dialect mirroring — the audit must never flag «طارجو التحدث باللهجة الليبية» as a problem (`dialect_mirroring` is a ✓ row precisely to prevent that).
7. **Class C false-positive risk is real.** A blanket "non-direct URL" rule would flag Waleed's Google Maps link, which is correct as-is. V1 rule must fire only when an image intent and a non-image URL co-occur. Tune against real KBs before shipping — this check is the one most likely to embarrass us.
8. **RTL** — logical properties only in the sheet (`ms-`/`me-`/`text-start`).
9. **No new i18n namespace** — reuse `kb` (merchant) and `admin` (founder); a new one needs all 4 registration steps and `getMessages.ts` is the one that gets forgotten.
10. **The admin route cannot reuse the merchant route.** `/pages/:id/*` runs `resolveWorkspace`, which scopes to the caller's workspace — an admin hitting it for another merchant's page gets a 404, not a result. Register under `/admin/*` with the admin guard, exactly like `kb-status` / `kb-gaps` already do.
11. **Do not let the admin view drift from the merchant view.** Same service, same cache entry. Presentation may differ (cap, badges, no fix links); findings may not.

## Test plan

- **Shared**: unit tests per deterministic check, including the negative cases (Maps link not flagged; direct `.jpg` not flagged; single legitimate price mention not flagged).
- **Backend**: quote-verification drops a fabricated finding; unknown `manifestId` is dropped; classifier failure degrades to deterministic-only findings rather than erroring the request; cap and ranking hold.
- **Frontend**: button renders in both merchant hosts (modal + `/business`), sheet renders all three finding classes, empty state.
- **Admin**: the admin route reaches a page outside the caller's workspace (the whole point) and is rejected for non-admins; `KbSection` expander lazy-loads on first open like its siblings; admin and merchant runs on the same KB return identical findings.
- **Fixture**: Waleed's KB, asserted to yield exactly the four findings above. It is the reason this feature exists and is the honest regression test.
- Run `npm run lint`, `npm run test`, `npm run translation:validate` before calling it done.

## Docs to sync on merge (rule 15)

`SYSTEM_ANALYSIS.md` (new merchant-facing capability) and `.planning/codebase/ARCHITECTURE.md` (new AI pipeline tag).

## Open questions

1. Should the audit be available to workspace **members** or admin+ only? V1 assumes members (read-only, mutates nothing).
2. Class C tuning: how narrow does the image-intent rule need to be to keep false positives at zero on the current merchant KBs?
3. Does the results sheet reuse `DetailSheet` (keyboard-safe pattern) or a simpler modal? It has no text input, so the keyboard concern does not apply — a plain sheet is probably right.
