Audit a merchant's ENTIRE configuration from production — settings, pages, plan/trial, Business Info, persona, Post Reply — and report which values will hurt them. Diagnoses "the AI stopped replying" and "why is my page quiet" without touching anything.

Arguments: $ARGUMENTS
- A merchant email, page name (Arabic or English, partial OK), `facebook_page_id`, or page/user UUID.
- Optional `fix` → after reporting, draft the exact message to send the merchant (Arabic, فصحى, 2nd person). Never send it yourself.

Read-only. Everything runs through `./scripts/prod-db-query.sh` (SELECT-only guard). **Never change a merchant's settings** — a toggle is their decision, and several look wrong but are deliberate. Report and recommend; the founder decides.

This is the configuration counterpart to `/reply-quality`. That skill judges the replies customers received; this one judges the inputs that produced them. When a merchant is underperforming, run this first — most "the AI is bad" reports are a settings or Business Info problem.

## The core question

For every value, ask **"does this suppress or degrade replies, and did the merchant mean it?"** Defaults nobody chose are the most common cause of silent damage — flag them separately from deliberate choices, because the conversation with the merchant is different.

## Step 1 — Identity, plan, and trial state

```bash
./scripts/prod-db-query.sh "
SELECT u.id AS user_id, u.email, u.name, u.created_at AS signed_up,
       u.last_seen_at, u.phone_verified, u.topup_balance, u.is_admin,
       s.status AS sub_status, s.trial_ends_at, s.current_period_end,
       s.payment_method, s.canceled_at, s.cancel_reason, s.cancel_at_period_end,
       p.name AS plan, p.slug, p.price, p.max_pages, p.max_ai_replies_per_month,
       p.instagram_enabled, p.whatsapp_enabled, p.ecommerce_enabled
FROM users u
LEFT JOIN subscriptions s ON s.user_id = u.id
LEFT JOIN plans p ON p.id = s.plan_id
WHERE u.email = '<EMAIL>';"
```

Read `last_seen_at` first — **a merchant who hasn't opened the dashboard since signup cannot be working any queue**, which changes what you recommend (don't suggest "review the flagged messages daily" to someone who never logs in). Compare `signed_up` to `trial_ends_at`: a merchant days from trial expiry with a broken configuration is a churn case, not a support ticket.

## Step 2 — Pages: connected, enabled, and why not

```bash
./scripts/prod-db-query.sh "
SELECT p.name, p.facebook_page_id, p.platform, p.instagram_username,
       p.auto_reply_enabled, p.auto_reply_disabled_reason,
       (p.access_token <> '') AS token_present, p.disconnect_reason,
       p.token_last_verified_at, p.created_at
FROM pages p WHERE p.user_id = '<USER_ID>' ORDER BY p.created_at;"
```

- `token_present = f` or `disconnect_reason` set → **the page is disconnected. Lead with this**; every other finding is downstream noise.
- `auto_reply_enabled = f` with reason **`user`** → the merchant switched it off deliberately. Ask why before "fixing" it; some merchants park pages on purpose.
- reason **`trial_block` / `auto_pause` / `plan_limit`** → the *system* disabled it. This is the merchant's problem to hear about, and comments are still ingested (unlike user-disabled pages).
- More connected pages than `plan.max_pages` → over-limit; check whether replies are being refused.

Cross-check page count against the plan, and flag any page with an armed Post Reply while `auto_reply_enabled = f` (Step 5) — the trigger is inert but the dashboard still shows it configured.

**Connected pages > `plan.max_pages`, with the surplus disabled as `user`** — do NOT report this as "the merchant switched pages off". They most likely had to *choose one*, because their plan allows fewer. This is an upgrade conversation, not a misconfiguration: name the pages sitting idle and what they'd gain. Confirm with them before assuming either way (Step 10).

## Step 3 — The settings row, read against defaults

```bash
./scripts/prod-db-query.sh "
SELECT ai_enabled, ai_model, messages_auto_reply, comments_auto_reply, comment_reply_mode,
       hold_low_confidence, business_hours_only, business_hours_start, business_hours_end, timezone,
       greeting_message_enabled, greeting_message, away_message,
       limit_fallback_enabled, new_lead_alerts_enabled, notifications_enabled,
       reply_delay, reply_style, default_reply_language, dashboard_language,
       auto_detect_language, supported_languages,
       comment_escalation_minutes, message_escalation_minutes, handoff_pause_duration_minutes,
       brand_voice_notes, dual_reply_nudge,
       greeting_message_multi, away_message_multi, brand_voice_notes_multi,
       onboarding_completed_at, created_at, updated_at
FROM settings WHERE user_id = '<USER_ID>';"
```

`updated_at ≈ created_at` means the merchant never touched settings — everything below is a default, not a choice.

**Reply-suppressing settings — check every one, each produces silence with no error anywhere:**

| Setting | Default | Why it hurts |
|---|---|---|
| `ai_enabled = false` | `true` | No Smart Replies at all. |
| `messages_auto_reply` / `comments_auto_reply = false` | `true` | That whole channel is silent. |
| `hold_low_confidence = true` | `false` | Low-confidence replies are **generated but never sent** (`messageProcessor.ts:706`), parked for review. If the merchant doesn't work the queue → pure silence. **Interacts catastrophically with a thin Business Info**: no product data ⇒ most real questions are low-confidence ⇒ nearly every substantive reply is held while greetings still go through. A bot that only says hello. Also **suppresses lead capture** (`:718` returns before `maybeCaptureLead` at `:902`). |
| `business_hours_only = true` | `false` | Outside the window: one away message per conversation, then silence, then `sla_no_reply` flags. Verify the window matches when their customers actually write — evening traffic is the norm for retail. |
| `timezone` | `Asia/Riyadh` | **The default nobody chooses** — as of 2026-07-22, 60 of 62 merchants still hold it. Wrong for Libyan (`Africa/Tripoli`, UTC+2), Egyptian, Levantine and Maghreb merchants. Only bites when `business_hours_only` is on, but then hours run silently offset. |
| `limit_fallback_enabled` | `false` | Whether an out-of-quota merchant sends a fallback or nothing. Check alongside usage (Step 6). |

**Quality settings:**
- `brand_voice_notes` — if it still contains `[` … `]` placeholders («Name: [Your Assistant's Name]», «الهدف: [نحو ماذا توجّه العميل…]»), **the merchant never wrote a persona**. It is injected into the system prompt verbatim (`promptBuilder.ts:258-262`), so this is their most direct lever on reply behavior — and the template's last line is the lead-collection hook. Top recommendation whenever it's unfilled.
- `ai_model` — should be `gpt-4.1-mini` unless deliberately overridden.
- `greeting_message_enabled = false` with a `greeting_message` written → they wrote it and never turned it on.
- `*_multi` jsonb — the translated copies. If `away_message` holds English but customers are Arabic, confirm `away_message_multi` has the `ar` key; the base column alone is not what gets sent.
- `comment_reply_mode` — `public` / `private` / `dual`. `dual` also uses `dual_reply_nudge`.
- `reply_delay`, `*_escalation_minutes`, `handoff_pause_duration_minutes` — only report when far from default and causing an observed symptom.

## Step 4 — Business Info + the persona (the real quality inputs)

⛔ **Business Info is FOUR stores. Never judge it from `kb_chunks` alone** (D-088).
`kb_chunks` is only the RAG index over the free text, it is read at reply time
only on the retrieval path, and it drops to zero on its own whenever a
structured write moves `kb_active_version` past the newest ingested set —
**49 of 92 live pages on 2026-08-20**. Query all four, or you will tell a
merchant to fill in what they already filled in:

```bash
./scripts/prod-db-query.sh "
SELECT
  length(coalesce(p.knowledge_base,''))                                        AS kb_chars,
  jsonb_pretty(p.business_profile->'merchant')                                 AS merchant_profile,
  (SELECT count(*) FROM catalog_items  ci WHERE ci.page_id = p.id)             AS catalog_items,
  (SELECT count(*) FROM fact_rows fr JOIN fact_collections fc ON fc.id = fr.collection_id
     WHERE fc.page_id = p.id)                                                  AS fact_rows,
  p.kb_active_version,
  (SELECT max(kb_version) FROM kb_chunks c WHERE c.page_id = p.id)             AS newest_chunk_version
FROM pages p WHERE p.id = '<PID>';"

# The chunk TYPE breakdown — pin MAX(kb_version), never kb_active_version.
./scripts/prod-db-query.sh "
SELECT type, COUNT(*) AS chunks, SUM(LENGTH(content_original)) AS chars
FROM kb_chunks
WHERE page_id = '<PID>'
  AND kb_version = (SELECT MAX(kb_version) FROM kb_chunks WHERE page_id = '<PID>')
GROUP BY 1 ORDER BY chars DESC;"
```

**No `offering` chunks does NOT mean no products and no prices.** Check
`catalog_items` first: it fills the `<product_catalog>` block, which carries
explicit authority OVER the free text, so a merchant whose whole price list
lives there has offerings and no offering chunk. Only when `catalog_items = 0`
**and** the chunk index is current (`newest_chunk_version = kb_active_version`)
does a missing `offering` type mean the page cannot answer buying questions.
That case is still the strongest churn predictor you have — lead with it — but
verify it, do not infer it.

⚠️ **Read the `merchant_profile` keys, don't count them.** The modal live page
carries exactly `name`, `category`, `language_hint` and `website`/`about` (24 of
92 pages) — all page metadata that answers nothing. Only `address`, `phones`,
`hours`, `policies`, `whatsapp` and `email` become BUSINESS_INFO lines; that is
what `countBusinessInfoFacts` counts and it is the only count worth quoting.

Calibration from prod (2026-08-20): well-authored ≈ 196 chunks with products,
prices, a delivery table and an order flow. **"Under 500 characters" is NOT
starved on this fleet** — the median live page holds **148** characters and 71 of
92 are under 500, because content moved into the structured stores. Genuinely
starved = short free text **and** nothing in profile facts, catalog or fact rows
(36 of 92).

## Step 5 — Post Reply configuration

```bash
./scripts/prod-db-query.sh "
SELECT p.name AS page, p.auto_reply_enabled AS page_master,
       po.facebook_post_id, LEFT(COALESCE(po.message,''),80) AS post_preview,
       po.trigger_type, po.trigger_keyword, po.trigger_exclude_keyword,
       po.auto_reply_enabled AS post_enabled, po.like_comment,
       po.trigger_image_url IS NOT NULL AS has_image, po.trigger_button_url
FROM posts po JOIN pages p ON p.id = po.page_id
WHERE p.user_id = '<USER_ID>' AND COALESCE(po.trigger_reply,'') <> '';"
```

Flag: armed trigger on a page with `page_master = f` (inert — the pipeline returns at `commentProcessor.ts:121`, before Post Reply eligibility at `:179`); `trigger_type='keyword'` with an empty `trigger_keyword` (can never match); a trigger whose reply is empty or placeholder text.

## Step 6 — Workspace and team

Settings are **per-user** (`settings.user_id`) while pages, comments and messages are scoped by **workspace**. A merchant with teammates can therefore see behavior driven by a settings row that isn't theirs — always establish who owns the workspace before blaming a toggle.

```bash
./scripts/prod-db-query.sh "
SELECT w.id AS workspace_id, w.name, w.slug, w.created_at,
       ow.email AS owner_email, ow.name AS owner_name
FROM workspaces w JOIN users ow ON ow.id = w.owner_id
WHERE w.id IN (SELECT workspace_id FROM workspace_members WHERE user_id = '<USER_ID>');

SELECT u.email, u.name, wm.role, wm.joined_at, wm.lead_digest_muted_at,
       inv.email AS invited_by, u.last_seen_at
FROM workspace_members wm
JOIN users u ON u.id = wm.user_id
LEFT JOIN users inv ON inv.id = wm.invited_by
WHERE wm.workspace_id = '<WORKSPACE_ID>' ORDER BY wm.joined_at;

SELECT email, phone, role, status, created_at, expires_at, used_at
FROM workspace_invites WHERE workspace_id = '<WORKSPACE_ID>' ORDER BY created_at DESC;"
```

Report and flag:
- **Owner ≠ the person you're talking to** — the effective settings may belong to the owner, and a member can't change plan or billing.
- **Members whose `last_seen_at` is stale** — seats paid for and unused.
- **Pending invites** past `expires_at`, or invites to addresses that never signed up — a common "my colleague can't get in" ticket.
- `lead_digest_muted_at` set — that member stopped receiving lead digests deliberately; don't report it as a bug.
- A workspace name that is still a default or clearly wrong (e.g. copied from a demo seed) — worth renaming, and it appears in merchant-facing copy.

## Step 7 — Account history an admin usually needs

Pull these when the question is billing, abuse, or "why did my trial end":

```bash
./scripts/prod-db-query.sh "
-- Free-trial consumption per channel (anti-abuse ledger: a page/number can only trial once, ever)
SELECT ct.channel_type, ct.channel_id, ct.first_trialed_at, u.email AS first_claimed_by
FROM channel_trials ct LEFT JOIN users u ON u.id = ct.first_user_id
WHERE ct.first_user_id = '<USER_ID>' OR ct.first_workspace_id = '<WORKSPACE_ID>';

-- Top-ups and manual grants
SELECT pack, replies_added, price_cents, currency, source, status, created_at, succeeded_at, refunded_at
FROM topup_purchases WHERE user_id = '<USER_ID>' ORDER BY created_at DESC;

-- Admin-created collect-payment links (money side only — never touches balance)
SELECT amount_cents, currency, description, status, created_at, paid_at
FROM payment_requests WHERE user_id = '<USER_ID>' ORDER BY created_at DESC;

-- Connected stores (Salla / Shopify / Zid)
SELECT platform, store_name, store_domain, store_currency, store_timezone,
       product_count, is_active, last_sync_at, installed_at, uninstalled_at
FROM ecommerce_stores WHERE user_id = '<USER_ID>';

-- Can we even reach them on mobile?
SELECT platform, COUNT(*) AS devices, MAX(last_used_at) AS last_used
FROM device_tokens WHERE user_id = '<USER_ID>' GROUP BY 1;"
```

Interpretation notes:
- `channel_trials` is the **anti-abuse ledger**: a Facebook page or WhatsApp number can consume its free trial exactly once across all accounts. A page showing `auto_reply_disabled_reason = 'trial_block'` (Step 2) will have a row here claimed by a *different* user — that is the explanation to give, and it is deliberate, not a bug.
- `topup_purchases.source = 'manual'` are founder-issued grants; `status='refunded'` rows were reversed. Manual grants have **no service-level reversal** — never attempt one from a skill.
- `ecommerce_stores.is_active = false` or an old `last_sync_at` means catalog answers are running on stale data. Note that native-catalog replies currently bypass the reply validator entirely (known gap) — relevant if the merchant reports wrong prices.
- No `device_tokens` → push notifications cannot reach them; combined with a stale `last_seen_at`, nothing you flag in-app will be seen. Recommend email or WhatsApp contact instead.

## Step 8 — Usage, and the result that matters: leads

```bash
./scripts/prod-db-query.sh "
SELECT to_char(date_trunc('month', created_at),'YYYY-MM') AS month, COUNT(*) AS ai_replies
FROM messages
WHERE page_id IN (SELECT id FROM pages WHERE user_id='<USER_ID>')
  AND direction='outgoing' AND reply_method='ai'
GROUP BY 1 ORDER BY 1 DESC LIMIT 4;"
```

Compare with `plan.max_ai_replies_per_month` and `users.topup_balance`. Near or over the cap explains sudden silence far better than any toggle.

**Leads — always report the count.** This is the number the merchant actually cares about: replies are the mechanism, leads are the outcome. Report it per page and by status, alongside how many customers were talked to, so the figure has a denominator.

```bash
./scripts/prod-db-query.sh "
-- Leads per page, with status split
SELECT p.name AS page, COUNT(*) AS leads,
       COUNT(l.phone) AS with_phone,
       COUNT(*) FILTER (WHERE l.status = 'new') AS new,
       COUNT(*) FILTER (WHERE l.status = 'contacted') AS contacted,
       COUNT(*) FILTER (WHERE l.status = 'converted') AS converted,
       MIN(l.created_at) AS first_lead, MAX(l.created_at) AS last_lead
FROM leads l JOIN pages p ON p.id = l.page_id
WHERE p.user_id = '<USER_ID>' GROUP BY 1 ORDER BY leads DESC;

-- Denominator: unique customers spoken to, and monthly lead trend
SELECT COUNT(DISTINCT sender_id) AS unique_customers
FROM messages WHERE page_id IN (SELECT id FROM pages WHERE user_id='<USER_ID>') AND direction='incoming';

SELECT to_char(date_trunc('month', created_at),'YYYY-MM') AS month, COUNT(*) AS leads
FROM leads WHERE page_id IN (SELECT id FROM pages WHERE user_id='<USER_ID>')
GROUP BY 1 ORDER BY 1 DESC LIMIT 4;"
```

Interpret, don't just count:
- **Leads ≪ unique customers** → the assistant answers but never asks for a contact. Usually a placeholder persona (Step 3) with no collection goal. Cross-check with `/reply-quality` Step 7.
- **`extracted_data` showing `"fields": []`** → extraction ran but harvested nothing structured; the lead was captured passively because the customer volunteered a number, not because the assistant asked.
- **`hold_low_confidence = true`** → leads are being *lost*, not merely un-asked: the hold returns before `maybeCaptureLead`, so any contact details inside a held message never become a lead. Quantify it when you can — find phone-shaped strings in held messages that have no matching `leads` row, and report that as a concrete number of missed leads.
- **All leads `status='new'`, none `contacted`** → the merchant isn't working the leads list; combine with a stale `last_seen_at` before recommending anything that assumes they log in.
- **Zero leads with real traffic** → lead this section; it is the clearest evidence the account isn't delivering value, and the most persuasive thing to show the merchant.

Put the lead count in the merchant message when it helps them act — either as proof of value («وصلك N عميل محتمل») or as the cost of the current configuration («فقدنا رقم عميل بسبب هذا الإعداد»). Never present a lead count without saying what it means for them.

## Step 8b — Customer photos: is Jawab actually reading them?

Customers send product screenshots constantly, and reading them is one of the most convincing things the assistant does («هذا عطر غرام ذهب… سعرها 249 دينار» off a bare photo). It is also capped per plan per UTC day, and **the merchant is never told the cap exists until they hit it**. Run this whenever the page receives images at all:

```bash
./scripts/prod-db-query.sh "
SELECT created_at::date AS day, COUNT(*) AS images,
       COUNT(*) FILTER (WHERE message NOT IN ('[صورة]','[Image]')) AS read_ok,
       COUNT(*) FILTER (WHERE message IN ('[صورة]','[Image]')) AS went_blind
FROM messages
WHERE page_id IN (SELECT id FROM pages WHERE user_id='<USER_ID>')
  AND attachment_type='image' AND direction='incoming'
GROUP BY 1 ORDER BY 1 DESC LIMIT 14;"
```

Daily caps (`IMAGE_DAILY_LIMITS`, `services/imageUnderstanding.ts`) — **doubled when the merchant holds a top-up balance**:

| free | starter | business | pro | scale-20k | scale-30k |
|---|---|---|---|---|---|
| 3 | 15 | 40 | 75 | 150 | 200 |

**Trials read their limits from the plan row they point at — almost always `starter`.** Do not assume a trial gets its own allowance.

How to read it:
- **`read_ok` stops at exactly the plan limit, then every later image that day is blind** → the cap, not a bug. The customer got silence (correct since 2026-07-26); the merchant got one `image_limit_reached` notification. Report it as *"you are outgrowing this tier"*, with the day and counts.
- **Blind images scattered below the limit** → NOT the cap. Technical: kill switch, missing subscription, Redis (`cap_check_failed` fails closed), or download/format failures. Investigate rather than explaining it away.
- **Blind on days before the feature existed (pre-July 2026)** → expected, ignore. Do not include those in any percentage you quote, or the number is meaningless.

**Watch for the merchant working around it in their Business Info**, and understand that the workaround does nothing. Grep the KB for image rules whenever this step shows repeated cap hits:

```bash
./scripts/prod-db-query.sh "
SELECT p.name, LEFT(regexp_replace(l, '^\s+', ''), 120) AS rule_line
FROM pages p, unnest(string_to_array(p.knowledge_base, E'\n')) AS l
WHERE p.user_id = '<USER_ID>'
  AND (l LIKE '%صورة%' OR l LIKE '%صور %')
  AND (l LIKE '%لا ترد%' OR l LIKE '%ما ترد%' OR l LIKE '%تجاهل%');"
```

Two separate facts to report, and the merchant needs **both** — reporting either alone leaves them with a wrong model of their own account:

1. **The rule has never taken effect and never will.** Business Info is *knowledge the assistant answers from* — it cannot decide whether the assistant answers. Nothing in the pipeline reads the KB to gate a reply: the silent-skip paths (spam, emoji-only, debounce, hold) are all system-owned (`services/reply/messageProcessor.ts`, `commentProcessor.ts`). A merchant writing «لا ترد على الصورة» gets exactly the same behaviour as a merchant who wrote nothing. This applies to **every** instruction of the form "do / don't do X" — status changes, handing to a human, sending later, taking payment. Say it plainly; a merchant who believes an inert rule is protecting them will keep writing more of them.
2. **The photos were unread because of the daily cap, not because of their rule.** Give them the day and the counts from the query above, and the limit for their plan. This is what they were actually reacting to.

Real case: «لما زبون يرسلك صورة لا ترد عليه», written 11 minutes after the nudge reached his customer. The rule did nothing for four days; the images kept being read whenever the cap allowed. He was managing a limit he could not see, with a lever that was not connected.

It is the merchant's own text — tell them it can come out, **never edit or delete it yourself**.

## Step 9 — Report

Lead with a one-sentence verdict naming the single highest-impact problem. Then, in this order:

1. **Blocking** — disconnected page, expired trial, over quota, AI disabled. Nothing else matters until these are fixed.
2. **Actively hurting** — settings suppressing replies, empty Business Info, placeholder persona. For each: the value, what it causes, and whether it was **chosen or a default**.
3. **Worth changing** — timezone, escalation windows, greeting off.
4. **Fine** — say so briefly, so the founder knows it was checked.

Quote real values, never paraphrase. Say plainly when a setting is a default nobody chose — that is a product problem, not a merchant mistake, and it belongs in your notes to the founder as much as in the merchant's message.

**Diagnostic combinations that matter more than any single value:**
- `hold_low_confidence = true` **+** thin Business Info → the bot greets and nothing else. The most damaging pair in the product.
- `business_hours_only = true` **+** default `Asia/Riyadh` for a non-Gulf merchant → hours silently offset.
- Armed Post Reply **+** page master off → dashboard says configured, nothing can fire.
- Persona placeholders **+** low lead count → the AI never asks for a contact; see `/reply-quality` Step 7.

With `fix`: draft the merchant message in Arabic **فصحى**, 2nd person, ordered by impact, each item as "change X to Y, so that Z". Show it to the founder for approval — never send.

**Always close the draft with the support contact**, so the merchant can reply on the channel they actually use:
- WhatsApp: **+46 700 224 720** (`wa.me/46700224720`) — the canonical support number, `DEFAULT_SUPPORT_WHATSAPP_NUMBER` in `frontend/src/lib/whatsapp.ts:13`. Read it from there rather than hardcoding it here, in case it changes.
- Email: `info@jawab24.com` (the sender/reply-to Jawab24 uses in production).

Offer the WhatsApp link first for merchants in WhatsApp-first markets (Libya, Egypt, the Levant, the Gulf). A merchant with a stale `last_seen_at` and no `device_tokens` (Step 7) will not act on an in-app prompt; WhatsApp is the only channel likely to reach them.

**Disclose that the message was AI-drafted.** Open (or close) the draft with a short, plain line saying the review was produced automatically by Jawab24's AI after inspecting the account settings, and that a human checked it before sending — e.g. «أُعدّت هذه المراجعة آلياً بواسطة الذكاء الاصطناعي في جواب24 بعد فحص إعدادات حسابك، وقد راجعها فريقنا قبل إرسالها إليك.» Keep it truthful: only claim human review if the founder actually reviews it (which the `fix` flow requires). This is Jawab24 writing to its own customer about their account — the opposite of the reply pipeline, where the assistant must never identify itself as automated to a *merchant's* customers (`stripSelfIdentification`). Do not carry that rule across.

**Never offer to do the work for them.** We do not author Business Info, personas, or product lists on a merchant's behalf — that content is theirs, and only they know their prices and stock. Offer **guidance**, not substitution: name the exact screen, give the shortest possible steps, and offer to walk them through it live («نرشدك خطوة بخطوة»). The same restraint applies to settings — recommend the change and tell them where the toggle is; do not imply we will flip it for them.

## Step 10 — Questions to ask the merchant

Close every run with a short list of questions **only the merchant can answer**, derived from what you actually found — never a generic questionnaire. The data tells you *what* is configured; only they can tell you *why*, and the answer changes the recommendation. Ask at most 3–5, ordered by impact, each tied to the finding that raised it.

Map findings to questions:

| Finding | Ask |
|---|---|
| Page `auto_reply_disabled_reason = 'user'` | Did you switch this page off deliberately, or by accident? Do you want it answering? |
| `hold_low_confidence = true` + unreviewed queue | Do you check the flagged-messages list? Would you rather the AI answer directly and you correct it after? |
| `business_hours_only = true` | When do your customers actually message you? Should the AI answer in the evening too? |
| Non-Gulf merchant on default `Asia/Riyadh` | Which country/city are you in, so the schedule matches your clock? |
| No `offering` chunks | Can you add your product list with prices, so the assistant can answer buying questions? **Never offer to enter it for them** — Business Info is merchant-authored and we do not write it on their behalf. Point them at the exact screen (`/pages` → pick the page → «معلومات نشاطك التجاري», deep link `/pages?openKb=true`) and offer to walk them through it live on WhatsApp instead. |
| Placeholder persona | How do you want the AI to talk — dialect, tone — and what should it collect before closing an order? |
| Armed Post Reply on a disabled page | Do you want Post Reply running on this page? It cannot fire while the page is switched off. |
| Owner ≠ contact, or stale members | Who should own the account and who still needs access? |
| Store `is_active = false` / stale sync | Are you still selling through this store? |
| Trial ending, low usage | What has stopped you getting value so far? |
| Daily image cap hit on multiple days (Step 8b) | Your customers send more photos than your plan reads in a day — do you want the assistant answering all of them? (Upgrade conversation, not a defect.) Ask before recommending: some merchants prefer to answer photos personally. |
| A Business Info rule telling the assistant not to reply to images | Did you add this because the assistant said something wrong about a photo? Tell them **both** facts: the rule never took effect (Business Info cannot gate replies), and the photos went unread because of the daily limit. Then the line can come out — **never delete it yourself**. |
| **Any** Business Info line instructing an ACTION rather than stating a fact | «حوّله إلى تم التحويل», «لا ترد», «حوّله لموظف», «أرسل له رابط دفع», «تابع معه بعد ساعة» — all inert. The assistant answers *from* Business Info; it cannot be commanded *by* it. Ask what they were trying to achieve — this is the single best source of feature demand we have, and every one found so far was a real request with nowhere else to go. |
| `trial_block` on a page | Was this page connected under another account before? |

Two rules: ask about **intent**, never about data you can read yourself (never ask "what's your plan?"), and pair every question with what you'll do with the answer, so it reads as support rather than interrogation.

---

Prereqs: `~/.ssh/id_jawab24_deploy`, run from the repo root. Companion: `/reply-quality` (what customers actually received), `/growth-report` (proving impact to the merchant).
