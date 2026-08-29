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
- ✅ **Content-free CTA rewrite is channel-agnostic (since #391, 2026-07-02):**
  `rewriteContentFreeCta` fires in **every** reply mode — public, private, and dual —
  not dual/private only. (It was DM-gated until #391; the old gate silently dropped
  solicited `.`/`٠٠٠` engagement on public-mode CTA campaigns — the لامار الشام
  regression, eval #324.)
- ✅ **The rewrite is gated on the post's INVITATION (D-111, 2026-08-29):** a
  content-free comment reaches the rewrite only when the post's text explicitly asked
  for that symbol (`services/reply/commentCta.ts` + the once-per-post classifier
  `services/contentCtaClassifier.ts`). Uninvited symbols («❤️» under an event video,
  a bookmark «.» on a caption that asked nothing) are skipped BEFORE the model — no
  reply in any mode, no quota — under `uninvited_symbol`. Ships in shadow mode
  (`COMMENT_CTA_GATE_MODE=shadow`: decide + log only) and is switched to `enforce`
  after a week of live shadow data.
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
  has axios-level retries. Currently unused for DM failures
  because sender.ts catches & swallows; step 5 lets `transient` propagate so
  BullMQ picks them up.
  > **Corrected 2026-08-17.** This step recorded `fbAxios` as retrying
  > "429/5xx/4/17/32". Code 17 was never implemented, and blanket 5xx/network
  > retries were the cause of a duplicate public comment reply: `fbAxios` replayed
  > `POST /{comment-id}/comments` after an ambiguous failure, and Meta applies no
  > duplicate protection to that write. `fbAxios` now retries a **non-idempotent**
  > request (POST/PATCH) only when the failure PROVES it was never applied — 429,
  > FB codes 4/32, DNS failure, refused connection — or when the call site declares
  > the write semantically idempotent (`semanticallyIdempotent: true`, RFC 9110's
  > own escape hatch; used by converging writes like `subscribed_apps`, comment
  > hide, and the mention-guard repair). Ambiguous failures (5xx,
  > ECONNABORTED/ECONNRESET/ETIMEDOUT/EPIPE) are otherwise retried for idempotent
  > methods only, per RFC 9110 §9.2.2, and handed to BullMQ job-level retry —
  > the layer that owns the de-duplication context. Note `whatsapp.ts` does NOT
  > go through `fbAxios` — the Cloud API client uses a bare axios with no
  > transport retry. See [`fbAxios.ts`](../backend/src/lib/fbAxios.ts).
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

## Post Reply (per-post trigger keyword)

Separate from the three reply modes above. A merchant can attach a
`triggerKeyword` + `triggerReply` to any single post (ManyChat-style
"comment X to get details" engagement tactic).

**Rules:**

1. If the comment **matches** one of the trigger keywords, the configured
   `triggerReply` is sent as a Post Reply (skipping the AI path entirely).
   Match rules follow the shared keyword matcher (Arabic substring, English
   word-boundary, diacritics normalized; punctuation-only keywords require
   full-string match — `^\.+$` for `.`, so `.` never matches a real message).
2. If the comment **does not match**, it falls through to the normal AI
   pipeline. A post having trigger keywords does NOT silence off-keyword
   questions — real customer questions on the same post still get answered.
3. If `triggerReply` is empty, or workspace-level `commentsAutoReply` is off,
   the trigger block is skipped and the AI pipeline runs.
4. The trigger path acquires the same per-comment Redis lock as the AI path
   before calling the platform API. Without it, a duplicate webhook delivery
   could race: the second attempt is rejected by Facebook as a duplicate
   reply, returns `success:false`, and the comment would sit as Pending in
   the merchant's view even though the real reply had already been posted.
5. Send failures on either path flag the comment as `needsAttention=true`
   (surfaces in "Needs Attention"). The comment is never left as silently
   Pending — if the pipeline cannot deliver, the merchant must be told.

**Pending-state invariants** (enforced across every pipeline exit):

| Exit condition                          | DB state              | UI bucket         |
|-----------------------------------------|-----------------------|-------------------|
| Friend-tag silent skip                  | `resolved=true`       | Resolved          |
| AI-classified spam / irrelevant         | `resolved=true`       | Resolved          |
| Workspace auto-reply disabled           | `resolved=true`       | Resolved          |
| Rate-limited                            | `resolved=true`       | Resolved          |
| Send to Graph API failed                | `needsAttention=true` | Needs Attention   |
| AI returned no reply + no fallback      | `needsAttention=true` | Needs Attention   |
| Offensive content                       | `needsAttention=true` | Needs Attention   |
| Low-confidence reply held               | `needsAttention=true` | Needs Attention   |
| Subscription inactive / handoff active  | `replied=false` (intentional) | Pending   |

The only states that legitimately remain Pending are ones the system will
retry (handoff re-enqueue) or ones the merchant is expected to resolve by
reactivating subscription. Every other failure resolves or flags — never
leaves a ghost "Waiting to reply" card.

### The Needs-Attention queue expires after 7 days (D-078, corrected by D-080)

A flagged item auto-resolves 7 days after the **customer wrote it**
(`expireStaleAttentionItems`, part of the existing `[Cleanup]` sweep in
`backend/src/utils/cleanup.ts`, every 6h, fleet-wide, no per-merchant setting).
It covers `messages`, `comments` and `instagram_comments`, each swept in its own
`try`/`catch` so one queue failing cannot skip the others.

Measured on messages before shipping: 93% of everything a merchant ever resolves
is resolved within 7 days (median 4 hours), while the open message queue had
reached 23,660 with 68% older than 30 days.

⚠️ **Comments share the window on their own, much thinner evidence.** Only 146
comments had ever been individually resolved in 90 days — 57.5% within 7 days
against 93% for messages, i.e. a ~42% give-up rather than 7.1%. The owner ruled
on the absolute instead: **62 comments over 90 days, ~21 a month fleet-wide**,
against a comment queue that had reached 31,885. Never quote 7.1% for comments,
and treat that 146-row sample as the first thing to re-measure if comment
behaviour changes.

⭐ **It resolves; it never deletes, and it never clears the flag.** `resolved =
true`, with `needs_attention` and `flag_reason` left in place. The queue is what
the MERCHANT works; the flags and their stored customer questions (`flag_meta`)
are what reply quality is measured from, and emptying the first must not cost the
second. So a small queue is **not** evidence of good replies: read quality off
the flags, never off the queue.

⚠️ **It does not write `updated_at`** — the one place it deliberately differs
from the merchant's own resolve button. That column is the schema's only proxy
for "resolved at", and stamping it (as the first release did, on 56,147 rows)
makes sweep-resolved rows indistinguishable from merchant-resolved ones. Leaving
it alone preserves the proxy and marks an expired row: resolved, but `updated_at`
still back at its original write.

It also calls `invalidateEndpointStatsCaches` for every workspace it touched —
required of any mutation of these counts, because the Needs-Attention chip has no
polling fallback.

---

## Where the logic lives

| File | Responsibility |
|------|----------------|
| `backend/src/utils/commentText.ts` | `stripCommentNoise(text)`, `hasMention(text)`, `isPunctuationOnly(text)`, `stripTagsByOffsets`, `hasUserTag`, `hasOwnPageTag`, `FacebookMessageTag` type |
| `backend/src/services/reply/commentPreprocess.ts` | **Single source of truth** for skip classification + language resolution: `preprocessCommentText`, `resolveCommentLanguage`, `rewriteContentFreeCta`. Used by generator and playground — do not duplicate these rules. |
| `backend/src/controllers/webhook.ts` | Ingest FB/IG webhook, capture `message_tags`, enqueue job with tags, normalise attachment types |
| `backend/src/services/reply/commentProcessor.ts` | Route generator output → send / skip / flag. Hosts the **early user-tag guard** (step 3a) that short-circuits before the trigger-keyword branch. Threads `messageTags` + `ourFacebookPageId` into the generator context. Emits `comment:skipped` SSE event on silent-skip so the frontend can patch the comment to `resolved` in real time. |
| `frontend/src/hooks/useSSE.ts` | Listens for `comment:received`, `comment:reply_sent`, `comment:reply_failed`, `comment:skipped`. On `comment:skipped`, patches the cache to flip the card from "Pending" to "Resolved" without a round-trip and refreshes stats. |
| `packages/shared/src/sse-events.ts` | Typed SSE event contract. `comment:skipped` payload carries `{ commentId, pageId, reason: 'friend_tag' \| 'spam' \| 'offensive', flagReason? }`. |
| `backend/src/services/reply/generator.ts` | Decide if/how to reply; AI call; CTA boost — delegates skip/language to `commentPreprocess.ts` |
| `backend/src/services/reply/commentProcessor.ts` | Route generator output → send / skip / flag |
| `backend/src/services/reply/adapters/facebookCommentAdapter.ts` | Pick nudge language (FB comments) |
| `backend/src/services/reply/adapters/instagramCommentAdapter.ts` | Pick nudge language (IG comments) |
| `backend/src/services/reply/sender.ts` | Send comment reply per mode (public / private / dual) |
| `backend/src/services/reply/nonTextHandler.ts` | DM attachments: store-then-enrich stub, transcribe audio, describe images (vision), resolve shared posts, stickers, nudge (see "Store-then-enrich" below) |
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
    │ CONTENT-FREE GATE  (D-111 — applyContentFreeGate)             │
    │ Runs BEFORE the AI-enabled / quota branches and any model     │
    │ call, on CONTENT-FREE comments only. Text («تم», «كم السعر؟»)  │
    │ never enters it — no lookup, no classification.               │
    │                                                               │
    │ 1. What did the post's TEXT ask for? Read the stored verdict  │
    │    (content_cta_classifications: none|dot|digits|word|heart|  │
    │    any|uncertain) — classified ONCE per post by gpt-4.1-mini  │
    │    on the first content-free comment no Post Reply rule       │
    │    handled (concurrent first comments share one call); the    │
    │    playground/eval classifies the caption per request.        │
    │    uncertain / confidence < 0.7 / no caption / call failed    │
    │    all read as NONE. Only model-authored verdicts persist.    │
    │ 2. Does the comment's SHAPE match it? (commentCta)            │
    │    dot|digits ← a dot run OR a digit run (one class; #324)    │
    │    heart      ← hearts only          any ← any symbol         │
    │    word|none  ← nothing (a dot on «اكتب تم» is skipped —      │
    │                 owner ruling; that merchant uses Post Reply)  │
    │ MATCH   → continue to the rewrite below.                      │
    │ NO MATCH→ enforce: SKIP (reason `uninvited_symbol`, metric    │
    │           skipped_uninvited_symbol + per-post tally).         │
    │           shadow: log + metric cta_gate_shadow_skip + tally,  │
    │           then continue exactly as before.                    │
    └─────────────────┬─────────────────────────────────────────────┘
                      ▼
    ┌─────────────────┴─────────────────────────────────────────────┐
    │ CONTENT-FREE CTA REWRITE  (rewriteContentFreeCta)             │
    │ ALL reply modes — public, private, AND dual (since #391)      │
    │                                                               │
    │ postMessage present                                           │
    │   && isContentFree → replace the comment with a synthetic     │
    │   question ("أريد التفاصيل" / "I want the details") so the AI │
    │   answers with the post's details instead of a bare token.    │
    │                                                               │
    │ isContentFree = no letter in ANY script → covers "." "..."    │
    │   emoji "❤️", ASCII "000", Arabic-Indic "٠٠٠" (NOT just       │
    │   punctuation — widened from isPunctuationOnly in #86).       │
    │                                                               │
    │ Was DM-only (effectiveChannel=='dm') until #391 (2026-07);    │
    │ the old gate silently dropped solicited engagement on         │
    │ public-mode CTA campaigns (لامار الشام, eval #324). Now the   │
    │ rewrite runs in public too and the reply is posted publicly.  │
    │                                                               │
    │ Synthetic-question LANGUAGE = resolveAuthoredCtaLanguage:     │
    │   merchant default first, then post → KB (NOT the post's      │
    │   detected language). See D-107 / #967 in Language selection. │
    │                                                               │
    │ Reached only through the CONTENT-FREE GATE above (D-111): in  │
    │   enforce mode an uninvited symbol never gets here; in shadow │
    │   mode it still does (and is counted as a would-be skip).     │
    └───────────────────────────────────────────────────────────────┘
                      │
                      ▼
              Language: detectCommentLanguage(strippedText, postMessage)
                (script-less → fall back to post language;
                 content-free CTA path → resolveAuthoredCtaLanguage)
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

**Mentioning the commenter (Post Reply only, Facebook only).** With `posts.tag_commenter`
armed on a post, whatever we post in the PUBLIC column above is prefixed with `@[PSID]`
(the commenter's `from.id`), so Facebook also sends them a "you were mentioned"
notification. The DM is never touched — the customer is already its recipient.

The prefix is applied AFTER the nudge's `NUDGE_MAX_LENGTH` truncation. A well-formed
`@[id]` Meta cannot resolve is stripped silently, but a token sliced in half (`@[1784`, no
closing bracket) is not a mention at all and DOES survive as literal text — so the ordering
is what keeps raw markup off the merchant's page.

Meta only renders the tag when the page has «Others Tagging this Page» enabled, and **no
API exposes that setting** — measured 2026-08-07 on a live page: `/{page-id}/settings`
returns 13 settings and none is this one, `are_tagging_others_allowed` is not a field, and
`?metadata=1` introspection is disabled on v23.0. So the capability can only be learned by
attempting. `commentMentionGuard.mentionPlan` returns one of three answers per page:
`skip` (proven to reject mentions — post untagged), `trust` (rendered one within 7 days —
tag without the read-back), or `verify` (unproven — tag, then read `message_tags` back).
On failure it rewrites the comment to the untagged text and memoizes the page for 30 days;
on success it memoizes for 7, so verification costs one Graph read per page per week rather
than one per reply — the difference matters against Meta's ~4,800 calls/page/day ceiling.
Blast radius is one briefly-wrong comment per page, and it self-heals either way.

A rendered mention is detected by the PRESENCE of a `type: 'user'` tag, not by matching the
id we sent: we add exactly one mention to a comment we just created, so any user tag is
ours, and requiring id equality would strip working mentions if Graph ever echoes a
differently-scoped id. `metrics:mention:{rendered|stripped|skipped|unverified}` counts the
outcomes.

What "did not render" looks like, measured live 2026-08-07: posting `@[<unresolvable-id>] x`
returns HTTP 200 and reads back as `" x"` — the token is **stripped**, with no error and no
`message_tags`. The customer-visible defect is therefore a stray leading space, not raw
markup; the guard's rewrite removes even that. The repair call is verified against real
Graph (`POST /{comment-id}` with a new `message` → `{"success":true}`). Deleting a comment,
if ever needed, requires the token as a QUERY PARAM — Graph ignores a JSON body on DELETE.

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

## Store-then-enrich for attachments (the text+attachment race fix)

**Problem it solves.** A customer often sends a question as *text* and the disambiguating
*attachment* (a screenshot, voice note, or shared post) as two separate webhook events
seconds apart. Enrichment is slow — image vision 6–20s, Whisper ~3s, shared-post fetch
up to ~12s — and historically the attachment row was only INSERTed *after* that work
finished. So the text job's consolidation (`messageProcessor` step 11) ran first and
answered the bare text (a wrong, stale-context guess), then the attachment produced a
second, correct reply ~10s later. Confirmed in prod (~139 text+attachment combo sends/day).

**The lifecycle.** `nonTextHandler` now stores the attachment row **immediately** at
webhook receipt with a placeholder body (`[صورة]`, `[رسالة صوتية]`, …) and an
`enrichment_status`:

| status | meaning |
|--------|---------|
| `NULL` | no lifecycle — text, outgoing, sticker, non-enrichable (video/file), legacy rows |
| `pending` | stub stored, enrichment in flight (bounded by service timeouts) |
| `done` | enrichment succeeded; `message` now holds the real transcript/description/post text |
| `failed` | enrichment failed/denied; the placeholder text is final |

Flow: **store stub (`pending`) + publish `message:received` SSE → enrich → `finalizeEnrichment`
(one atomic UPDATE of text + status, guarded on `pending`) → enqueue the reply job → publish
`message:updated` SSE.** On failure the stub is finalized `failed` and the text-only nudge is
sent (no reply job). This also fixes two older defects: the merchant inbox now shows the
attachment instantly (previously invisible for the whole enrichment window, and lost entirely
on a mid-enrichment crash), and consolidation no longer depends on the `setCreatedTime`
ordering hack.

**The park.** In `messageProcessor` step 11, if any unreplied row from the sender is still
`pending` (and younger than `PENDING_ENRICHMENT_MAX_AGE_MS` = 60s — older ⇒ the enricher
crashed, don't wait on a corpse), the reply job **parks**: it re-enqueues itself with a short
delay (`ATTACHMENT_PARK_DELAY_MS`) via a new `attachmentRetries` counter, bounded by
`MAX_ATTACHMENT_RETRIES` (8 → ~40s > worst-case enrichment). When the attachment finalizes
`done`, its own reply job (or the parked text job's retry) consolidates **text + real content
into ONE reply**. If the budget is exhausted, the job replies *without* the still-pending row
(never a permanent no-reply) — the pending row is answered later by its own job or the orphan
recheck.

- The `attachmentRetries` counter is kept **separate** from `handoffRetries`/`aiRetryCount`:
  a park must NEVER carry `handoffRetries`, or the resumed job would be treated as handoff
  backlog and stale-suppressed (dropped). All three park kinds share one `reEnqueueParked`
  helper in `replyWorker`, each bumping only its own counter.
- `hasNewerUnrepliedMessage` (step-5 debounce) ignores `pending`/`failed` rows — it only
  defers to a newer message whose reply job is guaranteed to exist (`NULL` text or `done`).
- `markOlderMessagesAsReplied` is **id-scoped** to the exact rows consolidated at step 11
  (not a blanket per-sender sweep), so an attachment that finalizes mid-generation isn't
  silently marked replied under a reply that never saw it.

Diagnostics: `pipelineMetrics` outcomes `attachment_park`, `attachment_park_requeued`,
`attachment_park_exhausted`. A healthy fleet shows `attachment_park` ≈ the combo-send rate
and `attachment_park_exhausted` ≈ 0.

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
| `.` (post text invites a dot)‡           | none                 | `.` (→ synthetic)    | NO    | AR nudge                   | full AR reply (from post) |
| `.` (post text invites nothing)‡         | none                 | `.`                   | YES (enforce) | —                  | — (`uninvited_symbol`; shadow: answered as the row above + `cta_gate_shadow_skip`) |
| `🎉` (no post context)                   | none                 | `🎉`                  | YES   | —                          | —         |
| `https://spam.com`                       | none                 | `""` + no post → YES | YES   | —                          | —         |
| `مرحبا` (public mode)                    | none                 | `مرحبا`               | NO    | full AR reply              | —         |
| `مرحبا` (private mode)                   | none                 | `مرحبا`               | NO    | — (fallback only)          | full AR reply |
| `مرحبا` (private, DM fails)              | none                 | `مرحبا`               | NO    | full AR reply (fallback)   | failed    |
| `مرحبا` (dual, DM fails)                 | none                 | `مرحبا`               | NO    | full AR reply (no nudge)   | failed    |

† Current word count is whitespace-based; `شو سعر الدورة؟` is 3 tokens (≤ 3).
 * Known limitation — short Arabic real questions collide with the friend-tag
   threshold. See [Known limitations](#known-limitations).
 ‡ Since D-111 the `.`→synthetic rewrite is gated on the post's stored CTA verdict
   (`content_cta_classifications`, classified once per post from the caption text —
   see the CONTENT-FREE GATE box). Rows show dual mode; in **public** mode an invited
   input produces a **full public reply** (channel-agnostic since #391), in private
   mode a DM only, and an uninvited one is skipped in every mode (enforce).

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
isContentFree false (has letters)
→ continue to AI (a real content-full comment — no rewrite)

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
isContentFree true, and postMessage exists
→ SPAM FILTER does NOT fire (has post context)
→ CONTENT-FREE CTA REWRITE replaces "." with "أريد التفاصيل" before AI
  (fires in every mode; here the reply is delivered as a dual-mode DM)

Public:       AR nudge
DM:           full AR answer with price (AI answered the synthetic question)
```

### Example 6b — Same dot, public mode (post-#391)
```
Mode:         public
Post:         "Comment . to get the price"
Input:        "."
→ SPAM FILTER does NOT fire (has post context)
→ CONTENT-FREE CTA REWRITE fires (channel-agnostic since #391):
  "." → "أريد التفاصيل" before the AI
→ AI answers the synthetic question from post context

Public:       full AR reply (with the price), posted publicly
DM:           —

Note: before #391 this path was DM-only, so public mode saw the raw "." and
often spam-classified it → silence on solicited CTA comments (eval #324).
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
isContentFree true  (no letter in any script)
→ same as Example 6b/7 depending on postMessage
  (with post context → CONTENT-FREE GATE: the rewrite fires in every mode only
   if the post's text invited a symbol that a 🎉🔥 satisfies — `any`. On a «علّق
   بنقطة» post or a post with no invitation it is skipped in enforce mode.)
```

### Example 8b — Comment-originated DM follow-up inherits post context

When a customer's DM thread started from a comment→DM (dual or private mode), the
conversation row stores `origin_content_id` pointing at the post. Every follow-up
DM is processed with `postMessage = origin post text`, exactly like the original
comment had.

> **Wiring note (fixed 2026-06-20):** the last hop of this flow was incomplete for a
> long time. `messageProcessor` (step 11c) resolved `postMessage` and passed it to
> `generator.generateForMessage`, but that method **dropped it** before building the
> AI request — so `[current_post]` never reached the DM prompt and the model answered
> as if the post reply never happened (e.g. asking "which course?" right after a
> post-reply that named the course and price). The playground (`generateForPlayground`)
> always forwarded it, so the bug was invisible there and only bit production DMs.
> Fixed by forwarding `context.postMessage` into the DM AI request, mirroring
> `generateForComment`. Note: RAG retrieval is deliberately **not** enriched with the
> post here — the post is optional `[current_post]` context only, never a retrieval
> signal. Enriching DM retrieval with post content regresses off-topic follow-ups (the
> "Doaa case", 2026-04-19: an address question after a course post-reply missed the
> address chunk); see `backend/test/services/generator-rag-enrichment.test.ts`.

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

   **Exception — the content-free CTA rewrite** (`rewriteContentFreeCta`): when the
   comment carries no language signal at all (`.`/emoji/`٠٠٠`), the synthetic
   question's language comes from `resolveAuthoredCtaLanguage` — **merchant default
   first**, then post → KB — NOT the post's detected language. This is text *we*
   author on the customer's behalf, so the merchant's configured default is the
   authority, and this synthetic language then becomes the reply's language (fed back
   as the explicit hint). Fixed in #967 (D-107): the old `detectLanguageCode(postMessage)`
   sent an English brochure to every emoji comment on a page with decoratively
   Latin-styled captions (`P O O L`, `M L U E`) — 238 replies on one page in 30 days.
   See `backend/src/utils/replyLanguage.ts`.

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

6. ~~**The content-free CTA rewrite has no CTA check.**~~ **Resolved by D-111
   (2026-08-29)** — see the CONTENT-FREE GATE box in the decision tree. What remains
   open, by design:
   - **A CTA that lives only in the image/video** is invisible to the caption-only
     classifier, so a dot wave on such a post is skipped (once `enforce` is on). The
     Post Reply nudge (a post drawing symbol comments with no rule → one-tap rule
     creation) is the intended path for those merchants and ships with `enforce`, not
     after it. Image classification is a later phase; the stored verdict is designed
     to accept extra sources without a shape change.
   - **`word` CTAs are strict** (owner ruling): a dot on «علق باسم الدورة» is skipped —
     a merchant who wants every comment answered there configures a Post Reply
     («الكل» or a keyword). 62 such dots in 60 days on rule-less posts.
   - **A lone 😡** is content-free with no invitation → skipped, no alert (1 in 733
     emoji-only comments; 0 answered in 30 days). Emoji + words («غالي 😡») take the
     normal path and still raise `angry_customer`.
   - **The like-without-reply for skipped emoji** (workspace «الإعجاب بالتعليقات»
     on) is decided but not built — it ships with the nudge.

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
  content-free CTA rewrite (channel-agnostic; `resolveAuthoredCtaLanguage`).
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
