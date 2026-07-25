# Leads — Design, Behavior, and Incident History

> The single reference for how lead capture works and why each rule exists.
> Every non-obvious guard in `leadExtractor.ts` was paid for by a production
> incident — they are catalogued at the bottom. Read this before touching the
> gate, the prompt, or the upsert.
>
> Related docs: [lead-digest-email.md](lead-digest-email.md) (daily digest),
> `.planning/LEADS_MODULE_PLAN.md` (original 2026 build plan, historical),
> `.planning/codebase/ARCHITECTURE.md` §backend (condensed summary — keep in sync).

## What a lead is

A **lead** is a customer who shared a phone number with the business inside a
conversation (DM) or comment. One row per **sender per page** — the lead's
identity is the *person talking*, not the phone number. Everything else the
customer volunteered (name, course, size, address, …) is AI-extracted into a
flexible card.

Product surface: `/leads` page (list + detail card with call/WhatsApp buttons,
status pipeline, custom fields, CSV export, server-side search), SSE toast +
push notification on capture, daily digest email.

## Data model (`leads` table, `backend/src/db/schema.ts`)

| Column | Notes |
|---|---|
| `senderId` + `pageId` | **Unique** (`idx_leads_sender_page`) — one lead per customer per page. All captures for the same sender merge into this row |
| `phone` | **Single scalar, NOT NULL** — the number the call/WhatsApp buttons dial. See "One phone column" below |
| `extractedData` | jsonb `{ summary?, fields: [{key, label_en, label_ar, value}] }` — the AI card. Bilingual labels, arbitrary keys. ⚠️ legacy rows are **double-encoded** (see Traps) |
| `status` | `new` → `contacted` → `converted`. Merchant-owned; the pipeline **never** regresses it (CRM standard) |
| `subStage` / `customFields` | Merchant-defined config in workspace settings (`settings.leadStages` / `settings.leadFields`), optional per-page overrides |
| `extractionStatus` / `extractionAttempts` | `completed` \| `pending` \| `failed`; attempts is a **shared counter** across first capture, re-shares, and re-extractions (cap 10) |
| `needsFollowUp` / `followUpReason` / `followUpAt` | Re-engagement flag: an already-handled lead (status ≠ `new`) came back. Non-destructive — status untouched; cleared when the merchant next changes status |

### One phone column — the settled design (see DECISIONS.md)

The row models the *sender*; additional people/numbers in the conversation
(e.g. a parent registering two children) are **card data**, stored as
`extractedData` field pairs (`name`/`phone`, `name_2`/`phone_2`, …). There is
deliberately no `alternatePhones` array/table: fields already render on the
card, are searchable, and export to CSV — a structured multi-contact model
would touch schema+UI+search+CSV+digest for no added merchant value at this
product stage.

Consequences the code must uphold:
- The `phone` column holds the **most recent** customer-owned number (most
  actionable for the buttons).
- A differing number must **never be silently discarded** — a displaced column
  value is preserved as a card field (see Upsert semantics; July 2026 incident).

## Capture pipeline

```
messageProcessor / commentProcessor  (after reply — fire-and-forget, NEVER awaited)
    └─ maybeCaptureLead()
         1. region hint      workspace timezone → defaultCountry (Redis-cached settings)
         2. gate text        stripForwardedPostBlocks(messageText)
         3. cheap pre-gate   extractPhones(gateText) empty? → maybeReextractLead() and stop
         4. exclusion set    KB business phones + prior merchant turns (+ post text for comments)
         5. real gate        extractCustomerPhones(gateText, businessTexts)[0] — empty → re-extract path
         6. daily budget     leads:extraction:{ws}:{date} (Redis, fail-open)
         7. AI extraction    EXTRACTION_PROMPT over the 20-turn transcript
         8. phone trust      AI phone re-validated via extractCustomerPhones, else keep gate phone
         9. upsert           merge into (senderId, pageId) row
        10. notify           SSE lead:captured + push (new) / re-engagement (handled lead returned)
```

### Phone detection (`packages/shared/src/utils/validation.ts`)

`extractPhones(text, {defaultCountry})`:
- Pre-normalizes: strips FB/IG bidi marks, Arabic-Indic digits → ASCII,
  `00CC…` → `+CC…`.
- **Primary: libphonenumber-js** — validates against real numbering plans
  (rejects sizes/prices/dates), handles every format. `defaultCountry` (from
  the merchant's timezone) resolves bare national numbers; an explicit `+CC`
  always wins.
- **Permissive fallback** (contiguous + space-grouped regexes, 9–15 digits)
  catches runs libphonenumber can't resolve so a real lead is never dropped —
  history: a single regex forbidding spaces silently dropped `+963 968 271 162`
  (June 2026), and before that, naive matching welded adjacent numbers (#81).
  Both regex shapes are constructed so two adjacent numbers can't weld.

### Business-number exclusion (`extractCustomerPhones`)

A lead must be built **only from the customer's own input, never from our
answers**. Any number that also appears in merchant-authored text is excluded,
matched cross-format (E.164 + last-9-digit tail). The exclusion set:

| Source | Catches | Incident |
|---|---|---|
| KB business phones (`getBusinessPhones`, Redis 1 h) | customer pastes/types the merchant's published line | June 2026 — 8 bogus leads dialing the merchant |
| **Prior** merchant turns of this conversation (`priorBusinessTurns`) | customer pastes our earlier reply back (e.g. to translate it) | June 2026 — ICDL paste-back |
| Forwarded `[Shared post: "…"]` blocks — stripped from gate text AND fed to the exclusion | customer forwards the merchant's own ad whose body ends with the merchant's number | June 2026 — Nourva ad forwards |
| Comment path: the post text | merchant's number in their own post | — |

**The temporal cutoff is the subtle part.** `priorBusinessTurns` keeps only
assistant turns *before* the customer's latest message. The reply we generated
*in response to* the current message is already stored (messageProcessor
commits it before firing capture) and naturally **echoes the customer's own
number back** («رح نتواصل معك على الرقم 09…»). Feeding that echo into the
exclusion made the gate misread the customer's own number as the business's and
silently drop the whole lead — the July 2026 **echo-drop** (17 leads lost
across Nourva/الدمشقي/Ultra, all backfilled). Discriminator: paste-back = we
said it *before* the customer's message; echo = we said it *after*. Same
reason the comment path excludes the post but **not** `replyText`.

### AI extraction (`EXTRACTION_PROMPT` + `callExtractionAI`)

gpt-4.1-mini over the last 20 turns (`Customer:` / `Agent:` labels), returns
`{phone, summary, fields[]}`. Rules baked into the prompt: extract **only from
Customer turns**; quoted/pasted Agent text is not customer data; multi-person
conversations emit one `name_N`/`phone_N` field pair per person; summary in the
customer's language.

**Never trust the AI phone blindly.** It is re-validated through
`extractCustomerPhones` before it may replace the gate phone — the model has
put a course **price** (`2500000`) in the phone field (June 2026: live call
buttons dialing a price) and can lift the merchant's line from an Agent turn.
Invalid/empty AI phone → keep the libphonenumber-validated gate phone.

### Upsert semantics (`upsertLead`) — non-destructive by contract

Insert on first capture; on conflict (`senderId`,`pageId`) **merge**:

- `extractedData`: `mergeExtractedData` — fresh value wins per key (the AI read
  the full history, so fresh reflects the latest statement), **existing keys
  are never dropped**, empty fresh values never overwrite, field order stable.
- `extractionStatus`: `completed` is never demoted to `pending` (a re-share
  while over budget / on AI failure arrives with an empty pending card — the
  merge keeps the populated card).
- `status`: never touched. A handled lead (≠ `new`) re-sharing a number sets
  `needsFollowUp`/`reshared_contact` instead (returning-customer badge).
- `phone`: newest wins, but a **differing displaced number is preserved as an
  `extractedData` field** — it must never vanish (July 2026: a parent sent two
  daughters' numbers; the second overwrote the first and one girl's name+number
  pairing was lost off the card while the buttons dialed the other girl's line).

### Follow-up re-extraction (`maybeReextractLead`)

Customers naturally send the phone **first** and the details **after** (final
size, recipient name, address) — one-shot extraction shipped Nourva orders from
stale cards (July 2026, "leads not caught" complaint). A no-phone message from
a sender whose lead is still fresh re-runs the AI over the full history and
merges into the card. Guards, in order:

- DM-only (comment context is a synthetic single turn — nothing to re-read)
- lead `status = 'new'` (checked pre-AI **and in the UPDATE's WHERE** — the
  merchant can flip status mid-AI-call; a handled card is theirs)
- window: `LEAD_REEXTRACT_WINDOW_HOURS` (default 24, `0` = kill-switch, read
  per call)
- attempt cap 10 (`extractionAttempts`, DB-backed), Redis cooldown 180 s per
  lead (SET NX **before** the call — burst coalescing), separate daily budget
  `leads:reextraction:{ws}:{date}` (150/ws, fail-open)
- writes `extractedData`/`extractionStatus`/`extractionAttempts`/`updatedAt`
  **only** — never `phone` (the gate owns it), `status`, `senderName`, flags.

`reextractLeadNow(pageId, senderId, userId, {dryRun})` is the same merge path
without the guards — built for the echo-drop backfill and manual re-runs.

### Budgets & failure posture

Everything is fire-and-forget and fail-open: Redis budget errors allow, AI
failure saves the lead phone-only as `pending` (retried by later traffic),
all exceptions go to `captureError`. Losing a lead is worse than an extra AI
call (~$0.0004; daily caps bound the damage).

## Traps (all shipped and caught)

- **jsonb double-encoding**: ALL pre-2026-07 rows store `extracted_data` as a
  jsonb *string* containing JSON (`jsonb_typeof = 'string'`). Drizzle's read
  path unwraps it; raw SQL must use `(extracted_data #>> '{}')::jsonb` —
  `extracted_data->'fields'` returns NULL. Do NOT "fix" rows to objects; the
  app normalizes both encodings (`normalizeExtractedData`) and mixed encodings
  are the consistent state. Search (`getLeadsByPage`) normalizes via a CASE and
  scopes ILIKE to summary + field **values**, never keys/labels (a whole-doc
  `::text` match on «المقاس» returned every lead).
- **`leads.phone` is NOT NULL** — a gate returning null means *no row at all*,
  not a partial row. That's why every gate false-negative (spaces, echo-drop)
  presented as "the lead was never captured".
- **Integration tests**: `leads.source_id` is a uuid column — fixtures must use
  `randomUUID()`, and `maybeCaptureLead` swallows the INSERT error on a bad
  one (silent no-row). Re-extraction integration tests must seed `messages`
  (the path reads real history).
- **`extractionAttempts` is shared** across capture/re-share/re-read — it is
  not "10 re-extractions". A cap of 5 would have failed a real Nourva replay.

## Incident history (chronological)

| When | Incident | Root cause | Fix |
|---|---|---|---|
| ~2026-05 | #81 two numbers welded into one | naive regex ran across whitespace | bounded regex; later superseded by libphonenumber + dual fallback |
| 2026-06-16 | Spaced numbers silently dropped (`+963 968 271 162` → no lead) | the #81 fix forbade internal whitespace | dual contiguous+grouped fallback, digit-bounded; libphonenumber primary |
| 2026-06-21 | Course **price** as lead phone (`2500000`, live call buttons) | AI phone trusted unconditionally over the validated gate phone | AI phone re-validated; fallback to gate phone |
| 2026-06-23 | 8 bogus leads dialing the **merchant's own line** | gate scraped merchant numbers arriving inside customer text: ad-forward / paste / quoted reply | `extractCustomerPhones` + KB business phones + shared-post stripping (#347) |
| 2026-07-14 | **Echo-drop**: 17 real leads never written | our confirmation reply echoed the customer's number → exclusion ate it → `rawPhone=null` → NOT NULL → no row | `priorBusinessTurns` temporal cutoff (`f2d4ba7e`); backfill + enrichment via `reextractLeadNow` |
| 2026-07-02 | "Leads not caught" (Nourva) — cards missing post-phone details; search couldn't find lead #78 | one-shot extraction; client-side-only search | follow-up re-extraction + merge; server-side search (#390) |
| 2026-07-25 | **Two-person lead mispaired** (الدمشقي): parent registered two daughters; card showed daughter A's name with daughter B's number on the buttons, daughter B's name lost entirely | `phone` column silently overwritten on conflict (the one destructive field in an otherwise non-destructive upsert); prompt had no multi-person convention, so `name` collapsed per-key | preserve displaced number as card field; prompt emits `name_N`/`phone_N` pairs per person; regression test from the real conversation |

## Known gaps (open)

- **`hold_low_confidence` drops leads** (found 2026-07-22): the hold path in
  `messageProcessor` returns before `maybeCaptureLead`, so a held message never
  produces a lead — and held messages skew toward exactly the off-KB ones where
  customers volunteer contact info (prod: a B2B pharmacy lead lost). Fix
  direction: extract on the hold path too (independent concerns); check sibling
  early-returns + `commentProcessor`. Needs owner go.
- Arabic-Indic-digit messages weren't covered by the echo-drop backfill *scan*
  (ASCII-only pre-filter); live path handles them.
