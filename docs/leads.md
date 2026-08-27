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

**Visibility of the standing queue (Aug 2026).** Three surfaces read ONE number —
the workspace-wide count of leads at `status = 'new'`, from `GET /leads/count`
with no `pageId` (`{ count, latestName, latestAt, oldestAt, byPage }`, where
`byPage` splits the same queue per page, longest-waiting page first, and `count`
/ `oldestAt` are derived from it so they cannot disagree):

| Surface | Notes |
|---|---|
| Nav badge (sidebar link, mobile "More" button, **and the Leads tile inside the More sheet**) | `useNewLeadsSummary`, reached through `useNavBadgeCounts` — one map keyed by href that every nav surface reads, so a destination cannot be badged on one and bare on another. Server-derived, so it survives an app restart, and it clears when a lead's **status changes** — not when the merchant merely visits `/leads`. The "More" button's number is `aggregateNavBadge` rolling up the destinations it hides. Query key is scoped to the active workspace (switching does not clear the cache, so an unscoped key served the previous workspace's number) |
| Dashboard attention banner | ONE aggregate leads row, never one row per lead, plus the count in the banner total. The time chip shows **`oldestAt`** — how long the queue's worst case has waited — matching the sibling comment/message rows (`earliestAt`) and the digest's age trigger. `latestAt` would read "5 minutes ago" over a ten-day backlog |
| Daily digest email | Volume **or** age — see [lead-digest-email.md](lead-digest-email.md) |

Why all three: before Aug 2026 the badge was a **session counter** that started at
0 on every app load and only ever incremented from a live `lead:captured` SSE
event, visiting `/leads` reset it without working a single lead, and the dashboard
never mentioned leads at all. A paying merchant sat on 19 unworked leads with
every surface showing nothing (2026-08-04).

The badge on "More" was then a **dead end** for another day: it carried the count,
but the sheet behind it drew icon + label only, so a merchant who tapped it faced a
grid of identical tiles with nothing pointing at Leads (2026-08-05, 29 waiting). A
badge on a container is a promise that something inside needs attention — the item
that owns the count repeats it, in both the portrait grid and the landscape row.

**Resolving the badge (Aug 2026).** Surviving the visit is only half the bargain:
a badge that never resolves into the thing it counts is one merchants learn to
ignore, and this one could not be resolved at all — `/leads` opened on **All**,
scoped to **one page**, so a badge of 9 led to a mixed list of a single page's
leads and no view in the product showed the 9. Three parts, all keyed off the
same summary:

- **The badge routes to `/leads?status=new`** — `NavBadge.targetHref`, applied by
  `resolveNavHref` on every nav surface, so the sidebar and the More sheet cannot
  disagree about where one badge leads. Only while `count > 0`; on an empty queue
  the link stays `/leads`, because a filtered view would be empty.
- **The page honours `?status=`** (`parseStatusFilter`, `frontend/src/utils/leadsView.ts`)
  and the chips write back to it, so a reload, a shared link, and the back button
  all reproduce the view. Unknown values are rejected rather than cast — a filter
  no chip can show would leave every chip unselected over a filtered list.
- **It lands on a page that HAS waiting leads** (`pickWaitingPage`, from `byPage`).
  The merchant's own page wins whenever it is waiting; otherwise the longest-waiting
  page is opened. Without this the deep link is a regression for multi-page
  merchants: an empty list under a badge of 9. The page picker also labels every
  entry that has waiting leads with its share, which is where the workspace total
  becomes legible as a set (9 = 4 + 5) instead of a number shown nowhere.

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
         2. gate text        customerAuthoredGateText(messageText) — strips [Shared post: …] blocks
                             and URLs (https?://…, www.…); an image-message body
                             ([Image: …]/[صورة: …]) contributes NO gate text
         3. cheap pre-gate   extractPhones(gateText) empty? → maybeReextractLead() and stop
         3b. identity turn   this reply's tool round ran verify_and_get_* (any outcome) or
                             find_order_by_phone (success only)? → the phone is an ORDER
                             identity claim, not a contact line: count
                             metrics:lead:suppressed:order_verification, log page+sender,
                             maybeReextractLead() and stop (D-105)
         4. exclusion set    business phones (KB ∪ Business Info fields ∪ fact rows)
                             + prior merchant turns + image-message turns + URL-only digits
                             (+ post text for comments)
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
| Business phones (`getBusinessPhones`, Redis 1 h under a **`kbVersion`-scoped key**) — the UNION of the KB free text, the structured Business Info fields (`phones` + WhatsApp) and the fact-collection rows (names + attribute values) | customer pastes/types the merchant's published line, wherever the merchant happens to keep it | June 2026 — 8 bogus leads dialing the merchant · Aug 2026 — MES fact-row migration |
| ⚠️ **NOT yet a source: the persona** (`brandVoiceNotesMulti`) | a merchant who wrote their routing table into «الشخصية ونبرة العلامة» publishes those numbers in every reply, and none of them are excluded | open — see the note below |
| **Prior** merchant turns of this conversation (`priorBusinessTurns`) | customer pastes our earlier reply back (e.g. to translate it) | June 2026 — ICDL paste-back |
| Forwarded `[Shared post: "…"]` blocks — stripped from gate text AND fed to the exclusion | customer forwards the merchant's own ad whose body ends with the merchant's number | June 2026 — Nourva ad forwards |
| Image-message turns (`imageTurnTexts`) — the whole body is dropped from gate text AND every image turn in the history joins the exclusion | numbers OCR'd from a photo the customer shared (a doctor's prescription stamp, another clinic's flyer footer) — third-party contact lines, never the customer's | July 2026 — Port Said hospital, 3/3 leads |
| URL-only digit runs (`urlOnlyPhoneTexts`) — URLs stripped from gate text AND their digits fed to the exclusion | a link's path/query digits (`…/gallery/253941151/…`, a Messenger channel id, a tracker's `pid`) validating as a phone under the permissive fallback | Aug 2026 — Shahin Resort, 3 junk leads in 90 days |
| Comment path: the post text | merchant's number in their own post | — |

**Every strip does BOTH halves.** Removing text from the gate is only half a
guard: the AI extractor still receives the full message, and its phone
*replaces* the gate phone whenever it re-validates (step 8). So each shape
removed above is also pushed into `businessTexts`. A strip that skips the second
half leaves the same junk reachable through the model.

**Where the business's numbers live has changed, and the exclusion follows it.**
`getBusinessPhones` read `pages.knowledge_base` alone until 2026-08-12. When the
Business Surface migration moved a merchant's numbers out of prose into fact
rows (MES, 2026-08-08: «صالات الشركة» + «أرقام الأقسام»), those lines silently
left the exclusion set and his own wholesale department line was captured as a
customer's phone. Any NEW surface that publishes a merchant number must be added
to that union in the same PR. Expired/unavailable fact rows are included on
purpose — a business's old number is still not a customer's.

🔴 **The persona is such a surface, and it is NOT in the union yet.** A number in
`settings.brandVoiceNotesMulti` reaches customers on every reply, so a customer
echoing it back becomes a lead whose call button dials the merchant — the same
defect the fact-row gap produced, on a surface two of our most engaged merchants
actually use (one at the 800-char cap with 18 phone tokens in it). Adding it has
one trap worth writing down: the persona is **settings**-scoped, while this cache
key is `kbVersion`-scoped, and a settings save moves nothing on `pages`. Joining
the union without adding a persona dimension to the key would serve stale numbers
for up to an hour — re-creating exactly the staleness the 2026-08-12 fix removed.

**The `phones[]` / legacy `phone` dual shape has ONE reader**, `businessPhoneList`
(`packages/shared/src/businessInfoPrompt.ts`), shared with the prompt formatter.
The set the prompt PUBLISHES and the set capture EXCLUDES must be identical; an
inline `phones ?? [phone]` reads an empty array as "no phones" while the prompt
still publishes the legacy value, which puts the merchant's own line back on a
lead's call button. Same rule for `whatsappNumbers`.

Since 2026-08-13 an entry may also be a `{number, description}` object (the
contact standard — a line can say what it is for). `businessPhoneList` still
returns bare NUMBERS, so this file's contract is unchanged by construction;
`businessPhoneEntries` is the reader for anything that wants the description
too. Never iterate `merchant.phones` directly — an object reaching
`texts.join('\n')` renders `[object Object]` and every one of the merchant's
numbers silently leaves the exclusion set.

**Two bounds on the URL strip, both measured over 90 days of prod inbound (128,187
messages), not guessed:**
- **Bare domains are not stripped** — eating `word.tld` risks customer-typed text,
  and no observed false lead came from one.
- **Phone-bearing deep links (`wa.me/<digits>`) are not exempted.** 5 inbound
  messages carried one; 3 were already dropped by the image / shared-post strips
  and none of the 5 produced a lead, so an exemption buys nothing and costs a
  hand-maintained host list. A number the customer *also typed plainly* is never
  excluded, so sharing your own `wa.me` link beside your number still captures.
- Note the deliberate asymmetry: `getBusinessPhones` does **not** strip URLs, so a
  merchant's own `wa.me` line in their KB still lands in the exclusion set.
  Over-excluding a business number is safe; under-excluding one dials the merchant.

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
Customer turns**; quoted/pasted Agent text is not customer data; `[Image: …]` /
`[صورة: …]` turns are machine OCR of a shared photo whose contact details belong
to the photographed document's author, never the Customer (belt-and-braces — the
code-level gate/exclusion is the real defense, the prompt rule alone failed 3/3
in prod); multi-person conversations emit one `name_N`/`phone_N` field pair per
person; summary in the customer's language.

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
| 2026-07-29 | **Image-OCR numbers as lead phones** (Port Said hospital): all 3 leads captured that day had an external doctor's/clinic's number from a customer's prescription/flyer photo as `phone` — call buttons dialed a psychiatrist's personal mobile | vision stores the photo as `[صورة: <OCR>]` message text; the gate treated it as customer-typed, and the prompt's sender-ownership rule alone didn't hold (3/3) | `customerAuthoredGateText` drops image bodies from the gate; `imageTurnTexts` joins the exclusion set so the AI can't lift an image number from the transcript; explicit image-marker prompt rule; regression test from the real payloads |
| 2026-08-08 | **The merchant's own department line captured as a customer lead** (MES): «مبيعات الجملة» was pasted back by a customer and became a lead whose call button dialed the merchant's own wholesale desk | `getBusinessPhones` read `pages.knowledge_base` ONLY. The Business Surface migration had moved his numbers out of prose into fact rows, so they left the exclusion set with no error and no log — the KB no longer contained them | `getBusinessPhones` now unions KB text ∪ Business Info fields (`businessPhoneList` + `whatsappNumbers`) ∪ fact-row names/attribute values; the Redis key carries `kbVersion` so a merchant edit invalidates it at once instead of serving stale numbers for an hour; integration tests seed each source in isolation |
| 2026-08-27 | **Order-tracking customers filed as prospects** — found by the owner before any store merchant was live: a customer asking where their order is was answered with an identity challenge, and the phone they gave created a "potential customer" card plus a new-lead push (a handled lead was even re-flagged "came back") | capture reads only the message text; it had no way to know the number answered "prove the order is yours". Both order paths ask for one: Phase-2 verification, and `find_order_by_phone` (D-101) which REQUIRES phone + name | `isIdentityVerificationTurn(toolOutcomes)` — same-turn, read from the executed tool names: Phase-2 verifiers whatever their outcome, `find_order_by_phone` only on `success` (it is callable on any message, so a failed search is not evidence of a buyer), Phase-1 `lookup_order` / `track_shipment` excluded. Forwarded by both processors at all three call sites; capture routes such a turn to re-extraction instead (existing card still enriched, nothing created, no alert), counts `metrics:lead:suppressed:order_verification` and logs `pageId`/`senderId` so a "my leads stopped appearing" report is traceable |
| 2026-08-11 | **URL digits as lead phones** (Shahin Resort): a vendor-spam DM's Behance link `…/gallery/253941151/…` became lead `04681bce`, its card, call and WhatsApp buttons all pointing at nine meaningless path digits. A 90-day sweep found 3 such leads (also a Messenger channel id and a spam tracker's `pid`) | a URL's path/query digit run validates as a phone under the permissive 9-digit fallback, and the gate treated the whole body as customer-typed | `stripUrls` removes `https?://…` / `www.…` from the gate text, and `urlOnlyPhoneTexts` feeds the removed digits into the exclusion set so the AI cannot lift them back out of the transcript; URL-only digits only, so a number typed plainly beside its own `wa.me` link still captures |

## Known gaps (open)

- **`hold_low_confidence` drops leads** (found 2026-07-22): the hold path in
  `messageProcessor` returns before `maybeCaptureLead`, so a held message never
  produces a lead — and held messages skew toward exactly the off-KB ones where
  customers volunteer contact info (prod: a B2B pharmacy lead lost). Fix
  direction: extract on the hold path too (independent concerns); check sibling
  early-returns + `commentProcessor`. Needs owner go.
- Arabic-Indic-digit messages weren't covered by the echo-drop backfill *scan*
  (ASCII-only pre-filter); live path handles them.
