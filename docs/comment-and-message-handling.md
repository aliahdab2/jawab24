# Comment & Message Handling — Behavior Reference

How Jawab24 decides whether to reply to a comment or DM, which channel it replies
on, and in what language. Covers every edge case that affects whether the customer
sees a response: tags, dots, emojis, stickers, images, shared posts, voice notes.

Maintainers: if you change behavior here, update this doc in the same commit.

---

## 🚧 Current implementation status

**Shipped (mention/tag handling):**
- ✅ `@[id:Name]` and `@hadi`-only comments silent-skip
- ✅ **Facebook `message_tags` user-tag rule (2026-04-20):** any comment whose
  webhook payload contains a `type: 'user'` entry is silent-skipped — including
  plain-name tags that render without `@` (e.g. `"Khadeja Alrefae"`). Skip applies
  even with trailing real text (peer-to-peer talk, not for the page). Overridden
  only when a `type: 'page'` entry matches our own Facebook page id.
  Enforced at two sites: (a) early guard in `commentProcessor.processComment`
  step 3a, **before** the trigger-keyword branch — needed because trigger matches
  send a reply immediately and bypass the AI path; (b) `preprocessCommentText`
  for the AI path itself. Both must agree for future rule changes.
- ✅ **Graph API tag enrichment (2026-04-20):** Facebook Page feed webhooks
  inconsistently omit `message_tags` for comments that DO carry a structured
  user tag — confirmed on Graph API v23.0 in production (webhook empty, same
  comment id returns tags via `GET /{comment_id}?fields=message_tags`). When
  the webhook is silent AND `isConfidentlyNotATag(text)` returns false (short
  text, no `?` / `؟`, no digits, no currency, no URL), we fetch authoritative
  tags from Graph API before the friend-tag guard runs. Inverted gate on
  purpose — "plausibly a tag" heuristics had false-negative rates on Arabic
  names. Lives inline in `commentProcessor.ts` step 3a (the logic is ~10
  lines; a separate module would be ceremony). BullMQ's per-comment lock
  makes this effectively once-per-comment without a dedicated cache layer.
- ✅ Nudge language derives from stripped text — no more English nudge on Arabic
  pages with tagged commenters
- ✅ CTA-boost scoping documented correctly (dual/private only, not public)
- ✅ Shared preprocess module `backend/src/services/reply/commentPreprocess.ts`
  is the single source of truth for skip rules + language resolution, used by
  both `generateForComment` (production) and `generateForPlayground` (admin/eval).
- ✅ **Live UI reflection of silent-skip:** on silent-skip, backend emits
  `comment:skipped` SSE event (`{ commentId, pageId, reason: 'friend_tag' | 'spam',
  flagReason? }`) and invalidates the workspace stats cache. Frontend
  (`useSSE.ts`) patches the comment in the React Query cache to `resolved: true`
  and refetches stats. Result: a friend-tagged comment flips from "Pending" →
  "Resolved" in real time and the "Needs Action" counter decrements, without a
  page reload. Offensive comments do NOT emit this event (they stay flagged for
  merchant attention via the existing notification pipeline).
- ✅ **Trigger-keyword replies emit `comment:received` before `comment:reply_sent`:**
  previously the trigger-match path stored the comment and went straight to
  `sendAndFinalize`, skipping the `comment:received` SSE event. The downstream
  `comment:reply_sent` handler's `setQueriesData` patch was then a no-op because
  the comment wasn't in the cache, and if the send later failed the merchant
  saw the comment stuck as "Waiting to reply" on the next refetch. Both paths
  (trigger match AND AI fallthrough) now emit `comment:received` immediately
  after `storeComment`, keeping the frontend cache consistent.

**In progress — DM-failure-aware fallback** ([plan](#dm-failure-aware-fallback)):
- ✅ Step 1: `backend/src/utils/fbGraphErrors.ts` — error classifier utility
  with `DmFailureBucket`, `classifyDmError()`, and `DmSendError` wrapper (24
  unit tests passing)
- ✅ Step 2: `facebook.sendPrivateReplyToComment` and `instagram.sendDirectMessage`
  now throw structured `DmSendError` carrying `code`/`subcode`/`type`/`isTransport`.
  Message format preserved for back-compat — existing tests still pass.
- ✅ Step 3: `SendReplyResult` / `SendCommentResult` extended with optional
  `dmFailure` + `suppressedPublic` fields (no behavior change yet)
- ✅ Step 4: retry queue verified — BullMQ has 3 attempts + exp backoff
  ([`replyQueue.ts:27-35`](../backend/src/lib/replyQueue.ts#L27-L35)), `fbAxios`
  has axios-level retries for 429/5xx/4/17/32. Currently unused for DM failures
  because sender.ts catches & swallows; step 5 lets `transient` propagate so
  BullMQ picks them up.
- ✅ Step 5: **sender.ts refactored** — privacy leak fixed for Facebook.
  Private-mode DM failure no longer posts the full reply publicly. Dual-mode
  DM failure posts the short nudge only on `window_expired`, nothing on any
  other bucket. Transient errors rethrow for BullMQ retry. 30 sender tests
  (including a cross-bucket regression guard that asserts `replyText` never
  appears in a public post call).
- ✅ Step 6: Instagram comment adapter mirrored. Same 5-bucket behavior, same
  regression guard (36 tests). Privacy leak fixed on both platforms.
- ⏳ Step 7: `pages.integrationAlert` column + helpers
- ⏳ Step 8: wire `commentProcessor` to set/clear page-level alert
- ⏳ Step 9: frontend banner on page settings view
- ⏳ Step 10: logging + Sentry breadcrumbs
- ⏳ Step 11: final doc update once everything lands

**Facebook privacy leak is now fixed (step 5).** Instagram still needs the
same treatment — step 6 lands next.

---

## DM-failure-aware fallback

**Problem:** When a merchant has `commentReplyMode = 'dual'` or `'private'` and
the DM send fails, `sender.ts` today posts the full AI-generated reply as a
public comment. Because that reply was generated with `channel='dm'` (detailed,
with prices, customer-specific offers), dumping it on a public thread violates
the merchant's explicit choice of private delivery.

**Root cause:** the catch block treats every DM error identically — we discard
Facebook's structured error code that would tell us *why* the DM failed.

**Fix (in flight):** classify the failure into one of five buckets and act on
bucket, not on "something failed":

| Bucket | Graph signals | Public-comment action | Merchant visibility |
|---|---|---|---|
| `customer_refused` | `10/2534014`, `551`, `100/2018001` | None (both private and dual) | Log only |
| `window_expired` | `10/2018278` | Nudge only (never full reply) | Log only |
| `transient` | `613`, network errors, 5xx | None; rethrow for retry | Log only |
| `our_fault` | `190` (token), `200` (perms) | None | **Page-level banner** on settings view; auto-clears on next successful DM |
| `unknown` | unmatched | None (safe default) | Log only |

Core principle: **privacy dominates.** DM-style content never leaks publicly.
In dual mode, the only public comment that can appear on DM failure is the
short nudge, and only for `window_expired`. The current "post full reply
publicly" branch is deleted entirely.

**Merchant noise principle:** no per-comment `needsAttention` flags for DM
failures. Only `our_fault` surfaces to the merchant, and as a single sticky
page-level banner — not a per-comment flag.

---

## Contents

1. [The three reply modes (comments)](#the-three-reply-modes-comments)
2. [Where the logic lives](#where-the-logic-lives)
3. [Input shapes we have to deal with](#input-shapes-we-have-to-deal-with)
4. [Comment decision tree](#comment-decision-tree)
5. [DM decision tree](#dm-decision-tree)
6. [Behavior matrix — comments](#behavior-matrix--comments)
7. [Behavior matrix — DMs](#behavior-matrix--dms)
8. [Worked examples](#worked-examples)
9. [Language selection](#language-selection)
10. [Known limitations](#known-limitations)
11. [Testing](#testing)

---

## The three reply modes (comments)

Configured per user in settings (`commentReplyMode`). Applies to Facebook and
Instagram **comments only** — DMs always send as a DM.

### Public (default)
```
Customer comment:  "شو سعر الدورة؟"
Public reply:      "سعر الدورة 500 ريال. للتسجيل..."     ← full answer
DM:                (none)
```

### Private
```
Customer comment:  "شو سعر الدورة؟"
Public reply:      (none)
DM:                "سعر الدورة 500 ريال. للتسجيل..."     ← full answer

Fallback: if DM send fails, post the full reply as a public comment.
Rationale: customer always gets an answer, even if their DMs are closed.
```

### Dual
```
Customer comment:  "شو سعر الدورة؟"
Public reply:      "أرسلنا لك التفاصيل برسالة خاصة 📩"    ← short nudge
DM:                "سعر الدورة 500 ريال. للتسجيل..."     ← full answer

Fallback: if DM send fails, post the full reply publicly (NO nudge).
Rationale: a nudge pointing to a DM that wasn't delivered would lie.
```

**Nudge variations** (configurable per-user in settings, with AI-generated
variations stored per language) — picked at send time to avoid Facebook's spam
detection on identical repeated comments.

---

## Where the logic lives

| File | Responsibility |
|------|----------------|
| `backend/src/utils/commentText.ts` | `stripCommentNoise(text)`, `hasMention(text)`, `isPunctuationOnly(text)`, `stripTagsByOffsets`, `hasUserTag`, `hasOwnPageTag`, `FacebookMessageTag` type |
| `backend/src/services/reply/commentPreprocess.ts` | **Single source of truth** for skip classification + language resolution: `preprocessCommentText`, `resolveCommentLanguage`, `rewritePunctuationForDualDm`. Used by generator and playground — do not duplicate these rules. |
| `backend/src/controllers/webhook.ts` | Ingest FB/IG webhook, capture `message_tags`, enqueue job with tags, normalise attachment types |
| `backend/src/services/reply/commentProcessor.ts` | Route generator output → send / skip / flag. Hosts the **early user-tag guard** (step 3a) that short-circuits before the trigger-keyword branch. Threads `messageTags` + `ourFacebookPageId` into the generator context. Emits `comment:skipped` SSE event on silent-skip so the frontend can patch the comment to `resolved` in real time. |
| `frontend/src/hooks/useSSE.ts` | Listens for `comment:received`, `comment:reply_sent`, `comment:reply_failed`, `comment:skipped`. On `comment:skipped`, patches the cache to flip the card from "Pending" to "Resolved" without a round-trip and refreshes stats. |
| `packages/shared/src/sse-events.ts` | Typed SSE event contract. `comment:skipped` payload carries `{ commentId, pageId, reason: 'friend_tag' \| 'spam' \| 'offensive', flagReason? }`. |
| `backend/src/services/reply/generator.ts` | Decide if/how to reply; AI call; CTA boost — delegates skip/language to `commentPreprocess.ts` |
| `backend/src/services/reply/commentProcessor.ts` | Route generator output → send / skip / flag |
| `backend/src/services/reply/adapters/facebookCommentAdapter.ts` | Pick nudge language (FB comments) |
| `backend/src/services/reply/adapters/instagramCommentAdapter.ts` | Pick nudge language (IG comments) |
| `backend/src/services/reply/sender.ts` | Send comment reply per mode (public / private / dual) |
| `backend/src/services/reply/nonTextHandler.ts` | DM attachments: transcribe audio, resolve shared posts, stickers, nudge |
| `backend/src/services/reply/nudge.ts` | Nudge variation picker (language-scoped) |
| `backend/src/utils/attachmentLabels.ts` | Attachment → i18n placeholder/nudge strings |

---

## Input shapes we have to deal with

### Comments (text-only)

Facebook's webhook delivers `comment.message` as raw text. A commenter who tags
someone produces one of three formats:

| Format      | Example                                      | Origin                             |
|-------------|----------------------------------------------|------------------------------------|
| Structured  | `@[100012345678901:Hanaa Kanaan]`            | Older clients; typed `@` then picked a profile |
| Plain       | `@hadi`                                      | Typed `@handle` manually           |
| Bare name   | `Khadeja Alrefae` (no `@` in text)           | Modern clients; picked a friend from the tag suggester |

The first two are stripped by regex in `stripCommentNoise`. The third has no
regex signal — it arrives in the webhook's structured `message_tags` array
alongside the raw message, with `offset`/`length`/`type`/`id` for each tagged
span. We handle it via `stripTagsByOffsets(text, message_tags)`.

Classification uses `message_tags` — not the text:

- any `type: 'user'` tag → **silent skip** (friend-directed, peer-to-peer).
- `type: 'page'` matching our own `facebookPageId` → treat as real question,
  strip the tag span, continue to AI.
- `type: 'page'` for some other page → skip (not our business).

See `preprocessCommentText` for the implementation.

### DMs (can carry attachments)

From the webhook, DMs arrive with either a `message.text` field, an `attachments[]`
array, or both. The attachment types we recognise:

| Type                | Treatment                                                           |
|---------------------|---------------------------------------------------------------------|
| `audio`             | Transcribe via Whisper → feed transcript to AI                      |
| `post`, `ig_post`, `reel`, `ig_reel` | Fetch post content → feed `[Shared post: "..."]` to AI |
| `image`, `video`, `file` | Store placeholder + send one-off nudge ("Please send text")    |
| `sticker`           | **Silently ignored** — stored for history, no reply                 |
| `fallback`          | Unknown — placeholder + nudge                                       |

The Facebook 👍 Like button arrives as `type=image` with `payload.sticker_id` set.
`webhook.ts:resolveAttachmentType` normalises it to `sticker` so it's ignored.

---

## Comment decision tree

```
┌──────────────────────────────────────────────────────────────────────┐
│ New comment from webhook OR playground test                          │
│ rawText = comment.message                                            │
│ messageTags = comment.message_tags (FB only, undefined on IG)        │
│ postMessage = parent post text (may be undefined for orphan/ad)      │
└─────────────────────┬────────────────────────────────────────────────┘
                      │
                      ▼
    ┌─────────────────┴─────────────────────────────────────────────┐
    │ USER-TAG FILTER (message_tags-based, Facebook only)           │
    │                                                               │
    │ hasUserTag(messageTags)                                       │
    │   && !hasOwnPageTag(messageTags, ourFacebookPageId)           │
    │                                     → SILENT SKIP             │
    │   ( bare friend tag "Khadeja Alrefae", with OR without text;  │
    │     overridden when a page-tag matches our own page id )      │
    └───────────────────────────────────────────────────────────────┘
                      │
                      ▼
              stripTagsByOffsets(rawText, messageTags)
                → textAfterTags
              stripCommentNoise(textAfterTags)  → strippedText
              hasMention(textAfterTags)         → mention?
                      │
    ┌─────────────────┼─────────────────────────────────────────────┐
    │ REGEX FRIEND-TAG FILTER (fallback for payloads w/o tags)      │
    │                                                               │
    │ mention? && strippedText == ""     → SILENT SKIP              │
    │   ( pure @tag, nothing else )                                 │
    │                                                               │
    │ mention? && strippedText words ≤ 3 → SILENT SKIP              │
    │   ( "@Ali check this", "@ahmad شكراً" )                       │
    └───────────────────────────────────────────────────────────────┘
                      │
                      ▼
    ┌─────────────────┴─────────────────────────────────────────────┐
    │ SPAM FILTER                                                   │
    │                                                               │
    │ strippedText == "" && !postMessage  → SILENT SKIP             │
    │   ( empty-after-strip with no post context to infer from )    │
    │                                                               │
    │ isPunctuationOnly(strippedText)                               │
    │   && !postMessage                   → SILENT SKIP             │
    │   ( ".", "...", "🎉" with no post context )                   │
    └───────────────────────────────────────────────────────────────┘
                      │
                      ▼
    ┌─────────────────┴─────────────────────────────────────────────┐
    │ CTA BOOST (dual & private modes only — not public)            │
    │                                                               │
    │ replyMode in {dual, private}  (effectiveChannel == 'dm')      │
    │   && postMessage                                              │
    │   && isPunctuationOnly → replace the comment with a synthetic │
    │   question ("أريد التفاصيل" / "I want the details") so the AI │
    │   answers the DM with the post's details instead of a "." .   │
    │                                                               │
    │ Public mode: no replacement. The AI sees the raw "." + post   │
    │ context and generates a public comment reply directly.        │
    └───────────────────────────────────────────────────────────────┘
                      │
                      ▼
              Language: detectCommentLanguage(strippedText, postMessage)
                (script-less → fall back to post language)
                      │
                      ▼
              AI generateReply()
                      │
                      ▼
              commentProcessor → adapter.sendReply()
                      │
                      ▼
     ┌────────────────┴────────────────┐
     │ Mode     │ Public       │ DM     │
     │──────────┼──────────────┼────────│
     │ public   │ full reply   │ —      │
     │ private  │ —  (fallback)│ full   │
     │ dual     │ nudge*       │ full   │
     └──────────┴──────────────┴────────┘

    *nudge language = detectCommentLanguage(strippedText, postMessage)
     — identical to the AI's language, so they never disagree.
```

`SILENT SKIP` = `commentProcessor` resolves the comment in the DB and returns
success. No Facebook API call, no notification, no DB row for a reply.

---

## DM decision tree

```
┌──────────────────────────────────────────────────────────────────────┐
│ New message from webhook                                             │
└─────────────────────┬────────────────────────────────────────────────┘
                      │
      ┌───────────────┴───────────────┐
      │                               │
  has attachment?                  text-only
      │                               │
      ▼                               ▼
  ┌─────────────────────┐       ┌───────────────────────┐
  │ attachment type?    │       │ enqueue for AI reply  │
  │                     │       │ (normal DM pipeline)  │
  │ sticker             │       └───────────────────────┘
  │   → silent store,                       │
  │     NO reply                            ▼
  │                              ┌───────────────────────┐
  │ audio                        │ Preset-reply match?   │
  │   → transcribe               │  YES → send template  │
  │     ├── ok: enqueue          │  NO  → AI reply       │
  │     │      for AI            └───────────────────────┘
  │     └── fail: nudge
  │
  │ shared post / reel
  │   → fetch content,
  │     enqueue for AI with
  │     [Shared post: "..."] context
  │
  │ image / video / file / fallback
  │   → placeholder stored,
  │     one-shot nudge with 1h cooldown
  └─────────────────────┘
```

Key differences from comments:

- DMs have **no "reply mode"** — they always reply as a DM.
- DMs use **conversation history** (last N messages). Comments don't.
- DMs have **nudge cooldown** (1/hour/sender) for unsupported attachments;
  comments don't have this because the friend-tag skip is silent (never nudges).

---

## Behavior matrix — comments

Arabic page, post in Arabic, dual mode unless noted.

| Comment input                            | message_tags         | Stripped             | Skip? | Public output              | DM output |
|------------------------------------------|----------------------|----------------------|-------|----------------------------|-----------|
| `Khadeja Alrefae` (bare friend tag)      | `[user@0/15]`        | `""`                 | YES   | —                          | —         |
| `Khadeja Alrefae شو السعر؟` (tag + text) | `[user@0/15]`        | `شو السعر؟`           | YES   | — (user-tag rule)          | —         |
| `Jawab كم السعر؟` (tags our page)        | `[page@0/5, id=us]`  | `كم السعر؟`           | NO    | AR nudge                   | full AR reply |
| `@[id:Hanaa Kanaan]` (structured)        | none                 | `""`                 | YES   | —                          | —         |
| `@hadi`                                  | none                 | `""`                 | YES   | —                          | —         |
| `@Ali check this`                        | none                 | `check this` (2 w)   | YES   | —                          | —         |
| `@[id:Ali] شكراً`                        | none                 | `شكراً` (1 w)        | YES   | —                          | —         |
| `@[id:Ali] شو سعر الدورة؟`               | none                 | `شو سعر الدورة؟` (3)† | YES*  | —                          | —         |
| `@Ali كيف أسجل في الدورة القادمة؟`        | none                 | `كيف أسجل في الدورة القادمة؟` (5) | NO | AR nudge               | full AR reply |
| `شو السعر؟`                              | none                 | `شو السعر؟`           | NO    | AR nudge                   | full AR reply |
| `.` (no post context)                    | none                 | `.`                   | YES   | —                          | —         |
| `.` (on CTA post "Comment . for price")  | none                 | `.` (→ synthetic)    | NO    | AR nudge                   | full AR reply (from post) |
| `🎉` (no post context)                   | none                 | `🎉`                  | YES   | —                          | —         |
| `https://spam.com`                       | none                 | `""` + no post → YES | YES   | —                          | —         |
| `مرحبا` (public mode)                    | none                 | `مرحبا`               | NO    | full AR reply              | —         |
| `مرحبا` (private mode)                   | none                 | `مرحبا`               | NO    | — (fallback only)          | full AR reply |
| `مرحبا` (private, DM fails)              | none                 | `مرحبا`               | NO    | full AR reply (fallback)   | failed    |
| `مرحبا` (dual, DM fails)                 | none                 | `مرحبا`               | NO    | full AR reply (no nudge)   | failed    |

† Current word count is whitespace-based; `شو سعر الدورة؟` is 3 tokens (≤ 3).
 * Known limitation — short Arabic real questions collide with the friend-tag
   threshold. See [Known limitations](#known-limitations).

---

## Behavior matrix — DMs

| DM input                           | Channel treatment                          | Customer sees |
|------------------------------------|--------------------------------------------|---------------|
| `"كم سعر الدورة؟"` (text)          | Normal AI pipeline                         | Full answer   |
| `.` or `🎉` (text)                 | AI pipeline; treated as vague, uses last assistant message as context | AI reply (often a clarifying nudge) |
| `@someone` (text)                  | Same as comments: stripped → empty → AI sees empty → vague-handling kicks in (DM path enriches with history) | AI reply from history |
| Voice note (audio)                 | Whisper transcribes → AI pipeline          | Full answer   |
| Voice note, transcription fails    | Placeholder `[Voice message]` + nudge (1h cooldown) | "Please send text" nudge |
| Image / video / file               | Placeholder + nudge (1h cooldown)          | "Please send text" nudge |
| 👍 (Facebook Like)                 | Normalised to `sticker` → **silent ignore** | Nothing        |
| Any sticker                        | **Silent ignore** — stored for history     | Nothing        |
| Shared post / reel                 | Fetch post text → AI pipeline with `[Shared post: "..."]` context | AI reply scoped to that post |
| Shared post (can't fetch)          | Fallback context: title or `[Customer shared a post]` → AI | Generic acknowledgement |

**Why stickers are silent**: a sticker/like carries no conversational intent —
the customer tapped a button, they're not waiting on an answer. Replying would
feel robotic and risk nudging a customer who doesn't want a nudge.

**Why shared posts go to AI with context**: the customer shared it *at us* for
a reason — usually a question about that product/post. We resolve the post text
so the AI can answer precisely instead of guessing.

---

## Worked examples

All examples below: Arabic page, Arabic post, dual reply mode.

### Example 1 — Pure structured tag (the bug we just fixed)
```
Input:        "@[100012345678901:Hanaa Kanaan]"
hasMention    true (regex matches @[)
stripped      ""
→ FRIEND-TAG (stripped empty) → SILENT SKIP

Result:       no public reply, no DM, comment marked resolved in DB.
Before fix:   English nudge "Details sent via DM", DM never delivered.
```

### Example 2 — Plain `@hadi` in the playground
```
Input:        "@hadi"
hasMention    true
stripped      ""
→ FRIEND-TAG (stripped empty) → SILENT SKIP

Result:       playground UI shows "skipped", no nudge, no DM.
```

### Example 3 — Tag + short chatter
```
Input:        "@Ali check this"
hasMention    true
stripped      "check this" (2 words)
→ FRIEND-TAG (≤ 3 words) → SILENT SKIP

Result:       no reply. The commenter is pointing their friend at the post.
```

### Example 4 — Tag + real question
```
Input:        "@Ali Ahdab كيف يمكنني التسجيل في الدورة القادمة؟"
hasMention    true
stripped      "كيف يمكنني التسجيل في الدورة القادمة؟" (6 words)
→ continue to AI

Language:     ar (from stripped text)
Public:       "أرسلنا لك التفاصيل برسالة خاصة 📩"  ← AR nudge, correct
DM:           full Arabic answer with registration details.
```

### Example 5 — CTA dot on Arabic post
```
Post:         "اكتب تم للحصول على السعر"
Input:        "تم"
hasMention    false
stripped      "تم"
isPunctuationOnly  false (has letters)
→ continue to AI

Language:     ar
Public:       AR nudge
DM:           full AR answer with the price
```

### Example 6 — Literal dot on Arabic CTA post (dual mode)
```
Mode:         dual
Post:         "Comment . to get the price"
Input:        "."
hasMention    false
stripped      "."
isPunctuationOnly  true, but postMessage exists
→ SPAM FILTER does NOT fire (has post context)
→ CTA BOOST replaces "." with "أريد التفاصيل" before AI (DM channel)

Public:       AR nudge
DM:           full AR answer with price (AI answered the synthetic question)
```

### Example 6b — Same dot, public mode
```
Mode:         public
Post:         "Comment . to get the price"
Input:        "."
→ SPAM FILTER does NOT fire (has post context)
→ CTA BOOST skipped (only applies to dual/private)
→ AI sees raw "." + post context

Public:       AR reply generated directly from post context
DM:           —
```

### Example 7 — Same dot, no post context (rare — orphan comment)
```
Post:         (not available — e.g. deleted/archived)
Input:        "."
hasMention    false
stripped      "."
isPunctuationOnly  true, !postMessage
→ SPAM FILTER fires → SILENT SKIP

Result:       no reply. We won't guess intent from a dot in a vacuum.
```

### Example 8 — Emoji-only comment
```
Input:        "🎉🔥"
hasMention    false
stripped      "🎉🔥"
isPunctuationOnly  true
→ same as Example 6/7 depending on postMessage
```

### Example 8b — Comment-originated DM follow-up inherits post context

When a customer's DM thread started from a comment→DM (dual or private mode), the
conversation row stores `origin_content_id` pointing at the post. Every follow-up
DM is processed with `postMessage = origin post text`, exactly like the original
comment had.

```
Scenario:     customer commented "." on TOT course post → dual-mode DM sent.
              Customer then DMs "تكلفة" in Messenger.
Stored state: conversations.origin_content_id = <post_uuid>
messageProcessor (step 11c):
  conversation.origin_content_id → posts.message = "دورة TOT ..."
  → context.postMessage = "دورة TOT ..."
AI pipeline:  classifier sees "تكلفة" + [current_post] → intent=QUESTION
Result:       customer gets a real pricing reply instead of silent-skip.
```

**Staleness guard:** if the origin post is older than 60 days, `postMessage` is
omitted. Old posts often contain relative-time claims ("tomorrow we start X") that
would mislead the AI; degrading to no context is safer than confident-but-wrong
echoes of stale copy. The underlying staleness issue also affects comments on old
posts and is tracked as a separate change.

**First-write-wins:** `origin_content_id` is only ever set when the stored value
is NULL. A customer who later DMs off-comment keeps the original post link — but
the field is never overwritten. If the customer's first DM was off-comment the
field stays NULL and the DM pipeline behaves exactly as before this change.

**Graceful degrade:** no FK on `origin_content_id` (it targets either `posts` or
`instagram_media` resolved via the conversation's platform). If the referenced
row was deleted, the lookup silently returns no `postMessage`.

### Example 8c — Example 8b, old post (staleness guard)
```
Scenario:     same as 8b, but the TOT post is 90 days old.
messageProcessor (step 11c):
  conversation.origin_content_id → posts, posts.created_time = 90d ago
  → AGE > 60 days → context.postMessage = undefined
AI pipeline:  classifier sees "تكلفة" with no post context
Result:       same behavior as pre-fix (possibly SPAM_OR_IRRELEVANT);
              merchant can still reply manually.
```

### Example 9 — DM voice note (Arabic)
```
Webhook:      attachment type=audio, url=<mp3>
Handler:      nonTextHandler → Whisper transcribes → "كم سعر الدورة؟"
              → enqueue as normal DM job
AI pipeline:  answers in Arabic using KB
Result:       customer gets full Arabic answer in the DM thread.
```

### Example 10 — DM sticker / 👍 like
```
Webhook:      attachment type=sticker (or image with payload.sticker_id)
Handler:      store `[Sticker]` in messages table, return.
Result:       no reply sent. Sticker appears in the dashboard conversation view
              so the merchant can see the customer reacted.
```

### Example 11 — DM image
```
Webhook:      attachment type=image
Handler:      store "[Customer sent an image]" placeholder
              → send one-off nudge "Please describe it in text 📝"
              → set 1h cooldown for (senderId, pageId)
Result:       one nudge, then silence for an hour if they send more images.
```

### Example 12 — DM shared post
```
Webhook:      attachment type=post, payload.url=<fb.com/...>
Handler:      facebookService.getPostContent() → "Special offer on course X..."
              → store `[Shared post: "Special offer on course X..."]`
              → enqueue as normal DM job
AI pipeline:  answers scoped to that post's content
Result:       contextually accurate reply, not a generic fallback.
```

---

## Language selection

Four places language matters. They must all agree or the customer sees a
mismatched nudge/reply.

1. **Generator AI call** — `detectCommentLanguage(strippedText, postMessage)`
   with ambiguous-Latin-on-Arabic-KB override (`isAmbiguousLatin` → `ar`).

2. **Comment-adapter nudge** (`facebookCommentAdapter` / `instagramCommentAdapter`)
   — same function, same args: `detectCommentLanguage(stripped, postMessage)`.
   This is the fix that prevents English nudges on Arabic pages after a tagged
   comment.

3. **DM non-text nudge** (`nonTextHandler`) — detected from the sender's last
   incoming text message; defaults to Arabic.

4. **Attachment placeholders** — passed explicit `lang` per call.

**Rule**: anywhere language is derived from the raw comment, it must be derived
from `stripCommentNoise(rawComment)` first. Raw comment text pollutes detection
with `@name` Latin characters.

---

## Known limitations

1. **Short Arabic real questions collide with the friend-tag threshold.**
   `@Ali شو السعر؟` → stripped `شو السعر؟` (2 tokens) → skipped as friend-tag.
   The fix would be switching word counting to meaningful-Arabic-token counting
   or dropping the ≤ 3 rule when the post is short (CTA-style). Today we accept
   this trade-off because false skips are silent and customers typically ask
   longer questions.

2. **Plain `@Name Surname` where surname is lowercase.** `@Ali ahdab` → only
   `@Ali` is stripped, `ahdab` remains. The post-language fallback usually
   recovers Arabic correctly, but the stripped text has a stray Latin word.

3. **Shared post fetch can fail** (deleted, private, API hiccup). We fall back
   to `[Customer shared a post]` + AI. The AI then has only "the customer shared
   something" to work with — answers are generic.

4. **Nudge cooldown is per-sender-per-page, not per-thread**. A customer who
   sends an image to page A and an image to page B (same FB account) gets two
   nudges. Intentional — each page is a separate merchant.

5. **Comment word count is whitespace-only**, Unicode-naïve. A single compound
   Arabic word with a ZWJ or tatweel may miscount; rare in practice.

---

## Testing

Keep these tests green. Add new ones here when behavior changes.

- `backend/test/utils/commentText.test.ts` — strip + mention-detection +
  `isPunctuationOnly` across both mention formats, URLs, edge cases. Plus
  `stripTagsByOffsets` / `hasUserTag` / `hasOwnPageTag` covering bare-name tags,
  multiple tags, malformed offsets, page-tag exception.
- `backend/test/services/reply/commentPreprocess.test.ts` — the shared module's
  behavior matrix: user-tag skip (with and without trailing text), page-tag
  exception, regex fallback, punctuation skip, language resolution edge cases,
  dual-DM synthetic rewrite.
- `backend/test/services/generator.test.ts` — `ReplyGenerator - Mention/tag skip
  behavior` describe block (regex fallback path).
- `backend/test/services/reply/facebookCommentAdapter.test.ts` — stripped input
  reaches `detectCommentLanguage` (structured + plain tag cases).
- `backend/test/services/reply/instagramCommentAdapter.test.ts` — Arabic nudge
  selected for tagged comment on Arabic post (two cases).
- `backend/test/services/commentProcessor.test.ts` — `SPAM_OR_IRRELEVANT` from
  generator → `resolveComment` called, no `sendReply`. Plus plumbing tests
  asserting `messageTags` + `ourFacebookPageId` flow into `generateForComment`.
- `scripts/playground-eval.ts` Category 46 — end-to-end eval cases for user-tag
  skip, user-tag + text skip, no-tag normal reply.

**Regression-test trigger**: any time you see an English nudge on an Arabic
page, a bot replying to `@tag` comments, or a DM bot that keeps sending "please
send text" every single time a customer sends an image, start here.
