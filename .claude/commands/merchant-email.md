Draft a merchant-facing email about a problem we found in their account — one problem, one action, every claim traced to production — in فصحى, for the founder to review and send.

Arguments: $ARGUMENTS
- A merchant email, a page name (Arabic or English, partial OK), a `facebook_page_id`, or an internal page UUID → resolve the page first.
- Plus what the email is about, in a few words ("instagram dead", "dead phone line", "empty business info"). If it's omitted, ask — never guess which finding to write about.
- Optional `en` → write in English instead (rare; only for merchants who write to us in English).

**This skill drafts. It does not send.** Output is a file the founder reads, edits, and sends. See "Sending" at the end for why that boundary exists and what the send options actually are.

---

## The rule that makes these emails work: ONE email, ONE action

A merchant audit produces a list. An email must not. Every extra ask lowers the odds the merchant does the one thing that matters — and these emails exist to get a thing *done*, not to be complete.

So: pick the single highest-value action, write only that, and list what you deliberately left out in the founder notes so nothing is lost. If two problems genuinely both need doing, that's two emails sent days apart, not one email with two sections.

Corollary — **only "merchant action" findings belong in a merchant email.** The `/reply-quality` three-bucket split is the filter:
- **merchant action** → this is what you write about.
- **product action** → never. It's our bug; we fix it and say nothing.
- **by design** → never. Explaining our own correct behavior to a merchant reads as an apology for a defect.

## Step 1 — Establish the facts before writing a word

Resolve the page and pull the evidence for the specific claim you intend to make. Everything goes through `./scripts/prod-db-query.sh` (SELECT-only).

**Every number and every quote in the email must come from a query you actually ran in this session.** Not from memory, not from a previous audit's summary, not from a plausible inference. A merchant who finds one wrong number in our email stops believing the rest of it — and rightly.

Write down, for each claim you plan to make, the query that backs it. Those pairs become the founder-notes evidence block in Step 5. If a claim has no query, it does not go in the email.

**Beware the grounding trap.** Before writing "your Business Info is missing X", dump every surface — `kb_chunks` AND `pages.business_profile #>> '{}'` AND `fact_rows`. Facts live in all three. Telling a merchant something is missing when it is sitting in `business_profile` is the single most credibility-destroying mistake available here (precedent: the Shahin "fabricated" WhatsApp number, and the MES business hours that looked invented and were not).

## Step 2 — Quote the merchant's own customers

The most persuasive paragraph in these emails is not our explanation. It is three of their customers' unanswered questions, verbatim.

```bash
./scripts/prod-db-query.sh "
SELECT LEFT(message,120) AS msg, created_at
FROM messages WHERE page_id = '<PID>' AND direction='incoming'
  AND <the condition that defines the failure>
ORDER BY created_at DESC LIMIT 6;"
```

Pick the ones that are obviously *buying* questions — asking a price, an address, availability. «وين موقع الصاله» lands; «شكراً» does not.

**Keep customer quotes byte-verbatim in whatever dialect they wrote.** They are quotations, not our copy, so the فصحى rule does not touch them — and "correcting" a customer's dialect would make the quote a fabrication.

## Step 3 — Language and register

**فصحى only.** `AI_INSTRUCTIONS.md` §5 names emails explicitly as Jawab24-authored copy. No «شلون / بدك / وش / مو / هالـ / ليش». The merchant may write to us in dialect; we still answer in فصحى.

Address the merchant as **حضرتك/أنتم** (plural courtesy), never تُخاطبه بالعامية أو بالاسم المجرّد. Open with «الأستاذ <name>، تحيةً طيبة».

Tone rules that matter more than they look:
- **Never blame.** «تطبيق بقي متّصلاً» not «أنتم ربطتم تطبيقاً». The cause is usually something reasonable they did months ago.
- **Never make them feel behind.** No «كما نبّهناكم سابقاً», even when we did.
- **No internal vocabulary.** They don't know what a webhook, a KB, a chunk, or a flag is. "إنستغرام يرفض تسليم الردّ" beats any accurate technical phrasing.
- **Say what still works.** A merchant reading "there's a problem" assumes everything is broken. One sentence — «أمّا فيسبوك فيعمل بصورة سليمة تماماً» — prevents a panicked call.

## Step 4 — Structure

```
الموضوع: <the problem, and that it's solvable, in one line>

الأستاذ <name>، تحيةً طيبة،

<2–3 sentences: what we found, scoped to the one channel/feature. What still works.>

**ما فقدتموه فعلاً**
<the number, then 3 verbatim customer questions>

**السبب**
<plain-language cause. No jargon.>

**الحل**
<numbered steps they can follow on their own device>

**ما نطلبه منكم**
<the ONE thing, plus the explicit reply request — see below>

<one line: what remains unaffected>

وفي انتظار ردّكم، ولكم منّا التقدير،
فريق جواب24
```

### Instructions they will actually follow

If the fix is in a third-party UI (Instagram, Facebook, Meta Business Suite, Stripe), **verify the menu path before asserting it** — Rule 12. Official help centers are frequently JS-rendered and will not yield a path to WebFetch; when that happens, do NOT assert one path from memory. Cover the known variants and say the UI differs by app version.

⛔ **Do not add a "contact us if you can't find it" fallback.** It reads as an escape hatch but it is a reply request wearing a disguise, and the founder has cut it (2026-08-12). Which raises the bar on the instructions themselves: since the merchant has no sanctioned way to come back, **the path must be right the first time.** If you could not verify it, say so to the founder in the notes and recommend checking it on a real device before sending — do not paper over an unverified path with an invitation to write to us.

### Never ask them to identify something we could have identified

If the thing they must remove/fix has an identity we can obtain — an app name, a row, a number — **get it first**, even if that means running a probe. An email that says «احذف تطبيق X» converts far better than one that says «ابحث عن تطبيق لا تعرفه واحذفه». Only fall back to teach-them-to-find-it when the identity is genuinely unavailable to us, and then say plainly why we can't see it, so the ask doesn't look lazy:

> نعرف بالدليل أن تطبيقاً آخر يستحوذ على المحادثات، لكننا لا نستطيع رؤية اسمه من جهتنا.

## Step 5 — Formal register, and do NOT ask for an email reply

**These emails are formal business correspondence, not friendly notes** (founder ruling, 2026-08-12). Concretely:

- Salutation «حضرة السيد <الاسم الكامل> المحترم» then «تحيةً طيبةً وبعد،» — not «الأستاذ <first name>، تحية طيبة».
- Number the sections «أولاً / ثانياً / ثالثاً» rather than using conversational headings.
- Sign «إدارة جواب24», close «وتفضّلوا بقبول فائق الاحترام والتقدير».
- Impersonal constructions: «نودّ إفادتكم» / «ويُرجَّح أنّه» / «تُعالَج المسألة» — not «ولعلّه» or «وسطر واحد يكفينا».
- No emoji, no exclamation marks, no chatty asides.

**⛔ Do not ask the merchant to reply to the email.** Not «أرسلوا لنا الاسم», not «أخبرونا», not a WhatsApp alternative as a demand. Replace any reply request with a standing-offer line that closes the loop without obliging them:

> ونبقى على أتمّ الاستعداد لتقديم أي مساعدة تحتاجونها.

The consequence is structural, so design around it: **the email must be complete without a round trip.** If the fix depends on information only the merchant can give us, that email cannot be written yet — get the information ourselves first (Step 4's "never ask them to identify something we could have identified" becomes mandatory, not preferred). A soft urgency line tied to *their* loss is still fine: «كلّ يوم يمرّ يعني استفسارات عملاء تبقى دون إجابة».

### If a reply channel is ever reinstated

Only relevant if the founder explicitly asks for one. **Before writing "reply to this email", confirm the From address actually accepts replies.**
`backend/src/services/email.ts` sends via Resend with `from: <fromName> <fromEmail>` and a
`reply_to` taken from `RESEND_REPLY_TO` — **omitted entirely when that is unset**, in which case
replies fall back to `fromEmail` (`RESEND_FROM_EMAIL`, or the `info@jawab24.com` default). The
same resolved address is printed in the shared footer, so what a merchant reads and where a reply
lands cannot diverge. Verify both are real, monitored mailboxes:

```bash
ssh -i ~/.ssh/id_jawab24_deploy root@91.99.95.196 \
  'docker exec jawab24-backend-green sh -c "printenv RESEND_REPLY_TO; printenv RESEND_FROM_EMAIL" \
     || echo "(unset → info@jawab24.com)"'
```

⚠️ Container names flip **blue/green** on deploy — always `docker ps` first, never hardcode.

If it resolves to a `no-reply` address, either drop the reply-to-email CTA and use WhatsApp only, or have the founder send from their own mailbox. Inviting a reply to a black hole is worse than not asking.

And state it in the email so the merchant knows it isn't a robot:

> ويمكنكم الردّ على هذه الرسالة مباشرةً — فهي تصل إلى صندوق `info@jawab24.com` ونقرأها بأنفسنا، وليست رسالة آلية لا تُستقبل ردودها.

## Step 6 — Write TWO files, never one

⚠️ **Keep the sendable copy in its own file.** Internal notes sitting directly beneath the email body is how internal notes get pasted to a merchant — and one of those notes is usually "don't tell him we changed X", which is precisely the sentence that must never reach him. It also makes the founder think the whole document is addressed to them, not the merchant (this happened, 2026-08-12).

1. `<scratchpad>/SEND-TO-MERCHANT-<merchant>-<topic>.md` — **the email and nothing else.** Recipient line, subject, body. No markdown headers, no evidence, no notes, no `---`. Paste-able wholesale into a mail client without reading it first.
2. `<scratchpad>/email-<merchant>-<topic>-<YYYY-MM-DD>.md` — the working document: DRAFT header, the same body, then a `## Notes for the founder` block that is NOT part of the email:

1. **Evidence** — each claim with the query/source that backs it, so the founder can spot-check any number in seconds.
2. **What is deliberately hedged, and why** — e.g. "the menu path is not asserted because the official help page wouldn't render; don't tighten it without checking on a real device."
3. **What would make this email stronger** — e.g. "run the probe first and the ask becomes a name instead of a search."
4. **What was deliberately left out** — the other findings, named, so they are not lost.
5. **⛔ Anything the merchant must not be told** — most importantly, **never mention corrections we made to their data ourselves.** If we fixed a typo in their content, that stays internal unless the founder decides otherwise.

## Sending

**Draft, present, let the founder send.** Not because sending is technically hard — because an email to a real customer over the company's name is theirs to authorise, and it cannot be unsent.

Facts about the options, established 2026-08-12:
- **There is no sanctioned *endpoint*, but the platform send works.** `adminWaitlistService.sendEmail` (`backend/src/controllers/admin.ts`) is waitlist-only, so send by running a script in the prod backend container against `emailService.send`. This was done successfully on 2026-08-12 (`status=sent`, audit row written) — do not tell the founder it is impossible.
- **Use an existing `EmailType`.** `account_notice` fits a formal notice about a problem in the merchant's account; `transactional` is the generic fallback. ⛔ Never invent a value — the union in `backend/src/services/email.ts` is the contract. Pass `userId` so the send is filterable per merchant, and verify the `email_sends` row afterwards (`status` must be `sent`).
- ⛔ **NEVER hand-roll the HTML.** Use the branded template — `accountNoticeEmailTemplate({ name, subject, body })` from `backend/src/utils/emailTemplates.ts`, which returns `{ subject, html }`. It wraps the body in `emailShell`: teal `#0d9488` brand header, white rounded card, `Jawab24 — jawab24.com` footer, hidden preheader, and the Cairo/Tajawal stack with `dir`/`lang`/alignment auto-detected from the content. This was got wrong on 2026-08-12 — a hand-written `<html dir="rtl">` was sent to a merchant with no brand chrome at all. Grep `emailTemplates.ts` for an existing template before writing a single tag.
- **The body is PLAIN TEXT, not HTML.** `accountNoticeEmailTemplate` does `escapeHtml(body).replace(/\n/g,'<br>')`, so any `<p>`, `<ol>` or `<blockquote>` you pass appears literally as tags in the merchant's inbox. Structure with newlines, «أولاً/ثانياً/ثالثاً» headings and «•» / «١.» bullets — not markup.
- ⚠️ **The template prepends its own greeting** — «مرحبًا {name}،» (or «مرحبًا،» when `name` is null), which is *informal* and collides with the formal «حضرة السيد … المحترم» these emails require. Today you must choose: accept «مرحبًا أحمد،» and drop the formal salutation, or pass `name: null` and open the body formally (accepting a redundant «مرحبًا،» above it). **Neither is right** — the real fix is a formal-register option on the template, and it is not built. Flag it to the founder rather than silently picking.
- **`docker exec` is sometimes blocked** by the permission classifier and sometimes not, with no obvious pattern. If it is blocked twice, hand the command over rather than hunting for a third shape.

Never send silently, and never send a draft the founder has not approved in its final form.

---

## Traps, all paid for

- **Don't bundle.** The MES email (2026-08-12) deliberately omitted a dead phone line, two conflicting showroom numbers, and a lead-capture gap — all real, all worth their own email — because bundling them would have cost the one action that mattered.
- **Don't claim a merchant "forgot" something they decided.** MES publishes no prices *on purpose*; he deleted a published price after we flagged it. An email telling him to add prices would have been wrong and insulting. Check whether the "gap" is a policy before naming it a gap — [[project_mes_no_price_policy_deliberate]].
- **Don't quote a stale number.** Re-run the query the same day you draft. A count from a three-day-old audit is a wrong number by the time it's read.
- **Don't translate the merchant's or customer's words** into فصحى or English anywhere in the email or the report.
- **Don't write "as we mentioned before."** Even when true, it makes the merchant defensive and reduces the odds of the action.
