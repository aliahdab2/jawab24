# WhatsApp Coexistence echoes — who sent it, the phone or the app?

Reference for anyone touching `smb_message_echoes`, the handoff pause, or a
Coexistence merchant report of "Jawab24 answered once and then went quiet".
Ruling: **D-109**. Code: `backend/src/services/whatsappEchoClassifier.ts`,
`backend/src/controllers/webhook.ts` (`processWhatsAppEchoes`),
`backend/src/services/messages.ts` (`getInboundRecency`, `storeOutgoingMessage`).

## The one thing to know

On a Coexistence number (the merchant keeps the number on their WhatsApp Business
app AND we hold it on Cloud API), Meta echoes **everything the app sends** through
one webhook field, `smb_message_echoes`:

- a reply the merchant **typed** on the phone — a real human handoff; the AI must stand down;
- the app's **own automations** — its Greeting Message and Away Message — which are
  not a handoff at all.

**The payload carries no author field.** It is `from · to · id · timestamp · type ·
<type>` and nothing else (verified against Meta's `smb_message_echoes` reference and
the "Onboarding WhatsApp Business app users" page on 2026-08-29 — don't re-check,
read the two pages if you doubt it). There is no flag to read. Authorship is
**inferred** here.

## What went wrong (2026-08-29, the first real Coexistence merchant)

Every echo was stored as `outgoing` + `reply_method='manual'`, which is exactly what
the handoff pause (`conversationPause._getRecentManualReply`) keys on. The
merchant's app greeting («شكرا لك على تواصلك مع …») arrived 1–4 s after every
customer's first message, so every conversation went: customer → AI greeting →
app greeting (read as "human took over") → **15 minutes of silence** → the
customer's real question answered 14 min 22 s late. Three concordant proofs: the
code path, the playground (generation fine, delivery gated), and the device (the
reply landed 9 s after the window closed).

The code's own docstring said echoes are "always human-authored". That was the
assumption D-045 was built on, and it was wrong in exactly the dangerous direction.

## The rule (rule 1 of the plan — the only one shipped)

WhatsApp's own definition of its greeting: *sent automatically when a customer
messages you for the first time or after 14 days of no activity.* We apply that
definition to the echo:

```
app_auto  ⇔  the echo arrived ≤ 10 s after the customer's latest inbound
             AND the customer had NOT written in during (now − 14 d, now − 10 s]
manual    ⇔  anything else (slow reply, reply inside an active thread,
             or no inbound row at all)
```

- `APP_AUTO_WINDOW_MS = 10_000`, `APP_AUTO_INACTIVITY_DAYS = 14` — pinned by
  `backend/test/services/whatsappEchoClassifier.test.ts`. Change them with new
  evidence, not by feel.
- "Prior inbound" is measured from the **window edge**, not from the latest
  message, so a customer's 2–3-message burst is still an opener.
- Time is **our clock on both sides** (inbound `created_at` vs echo receipt).
  Meta's echo `timestamp` is never mixed in.
- The inbound row is written by the **reply worker**, not the webhook, so the echo
  can land before the row exists. On a missing row the classifier re-reads once
  after `ECHO_RECENCY_RETRY_MS` (2 s). Still missing ⇒ `manual` (the safe side).

### Why those numbers (measured on production, 2026-08-29)

| Fact | Value |
|---|---|
| App-greeting echoes seen so far | 5, identical text, 5 distinct customers, **1–4 s** after the inbound |
| Human inbox replies (FB/IG, 90 d) | 729 |
| …answered a **conversation opener** in < 10 s | **0** (fastest 10–30 s; 43/50 > 2 min) |
| …replied in < 10 s at all | 48 — every one inside an already-active thread (≥ 1 inbound in the previous 24 h) |

So the rule has **0/729 human false positives** on our data, and the failure it
can still produce is the cheap one: a human misread as the app costs one double
reply; the app misread as a human costs a whole pause window of silence.

### What the rule deliberately does NOT do

- **Away messages inside an active thread** are read as `manual` and pause once.
  The verbatim-repeat rule (same text to ≥ 2 other customers ⇒ `app_auto`) was
  designed and measured but **deferred**: ship it only if the `whatsapp_echo_classified`
  log shows such pauses actually happening. The design is in
  `~/.claude/plans/write-the-best-plan-inherited-quilt.md`.
- It does not shorten or split the pause duration. `handoffPauseDurationMinutes`
  is one global knob on purpose: the fix is on the *author* axis, and a human on the
  phone must still pause the AI — that is the point of Coexistence.

## What `app_auto` changes downstream

| Reader | Effect |
|---|---|
| `conversationPause._getRecentManualReply` | predicate is `= 'manual'` ⇒ `app_auto` never pauses (by construction, no code change) |
| `processWhatsAppEchoes` backlog clear | skipped for `app_auto` — the greeting answers nothing, the customer's question stays `replied=false` and the worker answers it |
| `ReplySourceBadge` | «Your WhatsApp app» / «تطبيق واتساب لديك», amber, phone glyph — never "Manual" |
| `messages.getStats byMethod` | FILTERs are on incoming rows ⇒ unaffected |
| `ecommerceAnalytics.queryReplyStats` | `app_auto` excluded from `totalReplies` |
| `docs/landing-stats.md` | in neither the automated nor the manual bucket |
| conversation `platform` | echoes now pass `'whatsapp'` to `storeOutgoingMessage`, so a first-contact echo can no longer create a `facebook` conversation on a WhatsApp page |

## Reading production

Every echo logs exactly one line:

```
[WhatsApp] whatsapp_echo_classified: …   { messageId, method, cleared,
                                           msSinceLastInbound, priorInboundBeforeWindow, retried }
```

- `method='app_auto'` with `msSinceLastInbound` 1 000–5 000 ⇒ the greeting, working as intended.
- `method='manual'`, `msSinceLastInbound` small, `priorInboundBeforeWindow=true` ⇒ a
  fast reply in an active thread — either a real human, or the app's **away
  message** (the deferred case). Count these before building the verbatim rule.
- `msSinceLastInbound=null, retried=true` ⇒ the inbound row never appeared: the
  queue-lag race, or a merchant-initiated outreach. If this is frequent, the 2 s
  re-read is too short or the worker is lagging — look there, don't widen the rule.

Re-measure with the SQL in the 2026-08-29 session scratchpad (`q.sql`, `q2.sql`,
`q3.sql` — human-baseline gap buckets and opener baseline) before changing any
constant; the memory file `project_whatsapp_coexistence_echo_pause.md` carries the
numbers and the method.

## What the merchant is told

On the connected WhatsApp card of a Coexistence number (`pages.whatsappCoexistence
=== true`): «الرقم يعمل أيضاً على هاتفك — أوقف رسالة الترحيب ورسالة الغياب في
التطبيق», with an InfoPopover explaining that a reply from the phone pauses Jawab24
on that conversation for the handoff window. This is the standard Coexistence
onboarding instruction across vendors (WhatsTeam requires it; respond.io treats
echoes as inert). It is prevention at the merchant's end — the classifier is the
guard for when it isn't followed, so the failure degrades to a double greeting
instead of silence.

## Industry context (so nobody re-litigates it)

- "An agent reply pauses the AI on that thread" is the standard always-on-AI
  behaviour — that is our design, and it stays.
- Coexistence vendors either treat echoes as inert (respond.io) or tell merchants to
  switch app automations off (WhatsTeam, Social Intents). Nobody infers authorship,
  because their bots are trigger/workflow bots, not an AI answering every message.
  Our classifier is the adaptation of the standard rule to a channel with no author
  signal — bespoke by necessity, kept as small as the evidence allows.
