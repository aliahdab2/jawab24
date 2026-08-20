Audit the real reply quality a merchant's customers are receiving — both Post Reply (per-post triggers) and Smart Replies (AI) — from production data, and separate genuine problems from by-design behavior.

Arguments: $ARGUMENTS
- A merchant email, a page name (Arabic or English, partial OK), a `facebook_page_id`, or an internal page UUID. Use it to resolve the page in Step 1.
- Optional `days=N` → limit the window (default: all activity, which is usually right for new merchants).
- Optional `deep` → read full conversation transcripts turn-by-turn (Step 4b), not just samples. Slower, but this is where the real findings come from.

Read-only. Every query goes through `./scripts/prod-db-query.sh`, which refuses anything but SELECT/WITH. Never mutate a merchant's data from this skill — findings go to the founder, who decides.

## Output contract — three buckets, never one blob

The whole point of this audit is that **most "problems" in the data are correct behavior**. A report that lists `dm_failed` next to a real hallucination is worse than useless — it burns the founder's trust in the flags. Always sort findings into:

1. **Working** — with concrete evidence (quote a real exchange, ideally one that closed an order).
2. **Merchant action** — gaps in their Business Info the merchant must fix (missing hours, stale prices, missing delivery table).
3. **Product action** — defects in Jawab24 itself. Rare. Requires a code trace before you claim it, not just a flag count.

Anything that lands in the "by design" catalog below belongs in **none** of these buckets — mention it only to say it was checked and is fine.

---

## Step 1 — Resolve the merchant + page

```bash
./scripts/prod-db-query.sh "
SELECT u.id AS user_id, u.email, u.name, u.created_at,
       p.id AS page_uuid, p.facebook_page_id, p.name AS page_name,
       p.auto_reply_enabled, p.auto_reply_disabled_reason,
       (p.access_token <> '') AS token_present, p.disconnect_reason,
       p.instagram_username, p.workspace_id
FROM users u
LEFT JOIN pages p ON p.user_id = u.id
WHERE u.email = '<EMAIL>' OR p.name ILIKE '%<SEARCH>%'
   OR p.facebook_page_id = '<SEARCH>' OR p.id::text = '<SEARCH>';"
```

Carry `page_uuid` forward as `<PID>`. If `token_present = f` or `disconnect_reason` is set, stop and report that first — a disconnected page explains every downstream silence, and no reply-quality analysis is meaningful.

Schema traps (all cost time on 2026-07-22 — do not rediscover them):
- `pages.facebook_page_id`, **not** `page_id`. `posts.facebook_post_id`, **not** `post_id`.
- **`comments.created_time` and `messages.created_time` are NULL in production.** Always order and window on `created_at`. Ordering by `created_time` silently returns rows in arbitrary order and makes conversations unreadable.
- `messages.reply_method` is populated on **incoming** rows too — always filter `direction = 'outgoing'` before counting reply methods.
- `flag_reason` is a comma-joined string (`'info_not_in_kb,low_confidence'`), not a single enum. Match with `ILIKE '%...%'` or group on the raw value; `IN (...)` misses the combined rows.
- `kb_chunks` is keyed by **`page_id`** (not workspace), and the text columns are `content_original` / `content_normalized`. There is no `content` column.
- Drizzle writes jsonb as a **string** — `flag_meta ->> 'x'` returns NULL. Use `(flag_meta #>> '{}')::jsonb -> ...`.

## Step 2 — Post Reply: which posts are armed, and are they firing

Merchants routinely ask "I see Post Reply is on — on which post?". Answer with the post text, not just the ID.

```bash
./scripts/prod-db-query.sh "
SELECT id, facebook_post_id, LEFT(COALESCE(message,''), 120) AS post_preview,
       trigger_type, trigger_keyword, trigger_exclude_keyword,
       LEFT(COALESCE(trigger_reply,''), 160) AS reply_preview,
       trigger_image_url IS NOT NULL AS has_image,
       trigger_button_label, trigger_button_url, like_comment, auto_reply_enabled
FROM posts
WHERE page_id = '<PID>' AND COALESCE(trigger_reply,'') <> ''
ORDER BY id;"
```

Report each armed post as: what the post sells, `trigger_type` (`all` = every comment fires; `keyword` = only listed keywords, everything else falls through to AI), and whether image / button / like-comment are on. Give the founder a clickable `facebook.com/<facebook_post_id>`.

Then the fire counts and failures per post:

```bash
./scripts/prod-db-query.sh "
SELECT p.facebook_post_id, c.reply_method, c.replied, c.flag_reason, COUNT(*) AS n,
       MIN(c.created_at) AS first_seen, MAX(c.created_at) AS last_seen
FROM comments c JOIN posts p ON p.id = c.post_id
WHERE p.page_id = '<PID>'
GROUP BY 1,2,3,4 ORDER BY 1, n DESC;"
```

For every unreplied comment, get the reason before judging it:

```bash
./scripts/prod-db-query.sh "
SELECT c.from_name, LEFT(c.message, 80) AS comment, c.flag_reason,
       c.flag_meta, c.resolved, c.created_at, p.facebook_post_id
FROM comments c JOIN posts p ON p.id = c.post_id
WHERE p.page_id = '<PID>' AND c.replied = false
ORDER BY c.created_at DESC;"
```

`flag_meta` carries the Facebook error for `dm_failed` (`bucket` / `code` / `subcode`). A comment with `replied=false, flag_reason=NULL, resolved=true` is almost always a **debounce** skip — verify by checking whether the same `from_name` got a reply within 60s (Step 5).

## Step 3 — Smart Replies: the volume and health shape

```bash
./scripts/prod-db-query.sh "
SELECT reply_method, COUNT(*) AS n, MIN(created_at) AS first, MAX(created_at) AS last
FROM messages
WHERE page_id = '<PID>' AND direction = 'outgoing'
GROUP BY 1 ORDER BY n DESC;

SELECT flag_reason, COUNT(*) AS n
FROM messages
WHERE page_id = '<PID>' AND flag_reason IS NOT NULL
GROUP BY 1 ORDER BY n DESC;"
```

A healthy page is dominated by `ai`, with `manual` present (the merchant engaging on flagged threads is a good sign, not a bad one). `template` spikes mean away/greeting/unsupported-media, not AI failure.

Then pull what actually triggered each flag class — the customer question is the diagnosis:

```bash
./scripts/prod-db-query.sh "
SELECT LEFT(message, 100) AS customer_msg, flag_reason, created_at
FROM messages
WHERE page_id = '<PID>' AND flag_reason IS NOT NULL
ORDER BY created_at DESC LIMIT 25;"
```

## Step 4 — Read the actual replies (this is the audit; the counts are not)

Sample the recent stream first:

```bash
./scripts/prod-db-query.sh "
SELECT direction, reply_method, sender_name, LEFT(message, 150) AS msg, flag_reason, created_at
FROM messages WHERE page_id = '<PID>'
ORDER BY created_at DESC LIMIT 40;"
```

**4b — full transcripts (`deep`, and always around any flag cluster).** Pick a window and read every turn in order. This is how you find the things aggregates hide — a completed sale, a wrong price, a promise the system can't keep:

```bash
./scripts/prod-db-query.sh "
SELECT direction, LEFT(message, 200) AS msg, flag_reason, created_at
FROM messages WHERE page_id = '<PID>'
  AND created_at BETWEEN '<FROM>' AND '<TO>'
ORDER BY created_at;"
```

Judge each AI reply on:
- **Factual grounding** — every price, size, address, phone must exist in the Business Info (verify in Step 5, don't eyeball).
- **Sales progression** — does it move toward city + phone + quantity, or dead-end? A thread that ends in a confirmed order is the strongest evidence the product works; quote it.
- **Dialect** — mirroring the customer is correct and intentional. Do **not** flag dialect as a defect, and never "fix" the reply pipeline to فصحى (that rule governs Jawab24's own copy only).
- **Promises it can't keep** — e.g. «أرسل لي الكمية باش أحسب لك السعر» followed by a price-guard deflection. Real finding.

**4c — always include real transcripts in the report.** The founder wants to *read* what customers received, not a summary of it. Quote 2–4 exchanges verbatim (Arabic as-is), chosen to show the range: one that went well (ideally a closed order), one that hit a flag or dead-ended, and one that shows the persona/tone. Label each with what it demonstrates. Pick them by conversation, not by isolated message — a reply only makes sense next to the question that produced it.

## Step 5 — Persona + Business Info (the inputs that determine reply quality)

Reply quality is mostly a function of these two inputs. **Read them before judging any reply** — a "bad" reply is usually a starved one.

```bash
./scripts/prod-db-query.sh "
SELECT brand_voice_notes, away_message, greeting_message,
       hold_low_confidence, business_hours_only, business_hours_start, business_hours_end,
       timezone, messages_auto_reply, comments_auto_reply, comment_reply_mode
FROM settings WHERE user_id = '<USER_ID>';"
```

**Persona check — the highest-yield single check in this audit.** `brand_voice_notes` ships as a placeholder template («Name: [Your Assistant's Name]», «النبرة واللهجة: [كيف يتكلم — مثلاً ودود، لهجة ليبية]»). If the stored value still contains `[` … `]` placeholders, **the merchant never wrote a persona** and the AI is being handed template scaffolding as its brand voice. Report it as merchant action — it is a top cause of generic, characterless replies. A filled persona reads like Waleed's: «ارجو التحدث باللهجة الليبية مع الزباين» plus an explicit order-taking flow.

**Settings that silently suppress replies** — check each, because each produces "the AI stopped answering" with no error anywhere:
- `hold_low_confidence = true` → low-confidence AI replies are **generated but never sent**, parked for merchant review (`messageProcessor.ts:706`). If the merchant isn't working that queue, customers get silence. Cross-check the `held_low_confidence` count from Step 3 against whether those threads were ever answered manually.
- `business_hours_only = true` → outside the window, one away message per conversation, then silence. Verify `timezone` matches the merchant's actual country (a Libyan merchant on `Asia/Riyadh` runs an hour off).
- `messages_auto_reply` / `comments_auto_reply` false → whole channel off.

Then the Business Info itself:

```bash
./scripts/prod-db-query.sh "
SELECT type, COUNT(*) AS chunks, SUM(LENGTH(content_original)) AS chars
FROM kb_chunks
WHERE page_id = '<PID>'
  AND kb_version = (SELECT MAX(kb_version) FROM kb_chunks WHERE page_id = '<PID>')
GROUP BY 1 ORDER BY chars DESC;"
```

⛔ **The chunk breakdown above is ONE of four stores — never read it as the whole
Business Info** (D-088). Also query the other three, or a fully-configured page
reads as starved:

```bash
./scripts/prod-db-query.sh "
SELECT
  length(coalesce(p.knowledge_base,''))                            AS kb_chars,
  jsonb_pretty(p.business_profile->'merchant')                     AS merchant_profile,
  (SELECT count(*) FROM catalog_items ci WHERE ci.page_id = p.id)  AS catalog_items,
  (SELECT count(*) FROM fact_rows fr JOIN fact_collections fc ON fc.id = fr.collection_id
     WHERE fc.page_id = p.id)                                      AS fact_rows
FROM pages p WHERE p.id = '<PID>';"
```

**Read the `type` breakdown, then check `catalog_items` before concluding
anything.** A KB with `contact` / `hours` / `location` and **no `offering`
chunks** has no product or price data *in the free text* — but
`catalog_items` fills the `<product_catalog>` block, which carries authority
OVER the free text, so a page with 40 catalog items and zero offering chunks
answers buying questions fine. Only `offering = 0` **and** `catalog_items = 0`
is the empty-KB churn pattern; when it holds, it is the finding, so lead with
it.

For calibration (re-measured 2026-08-20): well-authored ≈ 196 chunks with
products, prices, delivery table and order flow. **"Under 500 characters" is not
starved on this fleet** — the median live page holds **148** characters and 71 of
92 are under 500, because content moved into the structured stores. Starved =
short free text **and** empty profile facts, catalog and fact rows (36 of 92).
⚠️ And a zero chunk count at `kb_active_version` usually means the RAG index was
outrun by a structured write, not that anything is missing — 49 of 92 live pages
were in that state. That is why every query here pins `MAX(kb_version)`.

## Step 6 — Verify prices against the Business Info (never trust your reading)

A reply that looks hallucinated is often verbatim from the merchant's KB, and vice versa. Check before you claim (this exact check reversed a false "hallucination" call on 2026-07-22):

```bash
./scripts/prod-db-query.sh "
SELECT DISTINCT type, content_original
FROM kb_chunks
WHERE page_id = '<PID>'
  AND kb_version = (SELECT MAX(kb_version) FROM kb_chunks WHERE page_id = '<PID>')
ORDER BY type;"
```

`kb_chunks` holds many near-duplicate rows across versions — always pin `MAX(kb_version)` and `DISTINCT`. Previews truncate long Arabic offering docs; if the product list is cut off, re-select the full `content_original` and grep the specific product rather than assuming it's absent.

Cross-check every quoted number, and also check the **reverse** direction: numbers the merchant states manually that contradict their own KB (found on 2026-07-22 — merchant typed «سرت 20» while the KB says «سرت 30»). That's a merchant-action finding worth surfacing.

Recorded KB gaps:

```bash
./scripts/prod-db-query.sh "
SELECT query_text, detected_intent, occurrence_count, last_seen_at, source_type
FROM kb_gaps WHERE page_id = '<PID>' AND resolved = false
ORDER BY occurrence_count DESC, last_seen_at DESC LIMIT 20;"
```

## Step 7 — Lead capture: is the AI *asking*, and is the answer being kept?

Replies that read well but never collect a contact are a silent business failure — the merchant sees "the AI is chatting" and no leads. Audit both halves: does the AI **ask**, and does the system **keep** the answer.

```bash
./scripts/prod-db-query.sh "
SELECT sender_name, phone, status, source_type, extraction_status, extracted_data, created_at
FROM leads WHERE page_id = '<PID>' ORDER BY created_at DESC LIMIT 20;

-- Contact details customers volunteered, vs leads actually captured
SELECT COUNT(*) FILTER (WHERE message ~ '[0-9٠-٩]{7,}') AS msgs_with_a_number,
       COUNT(*) FILTER (WHERE message ~ '[0-9٠-٩]{7,}' AND flag_reason IS NOT NULL) AS of_those_flagged
FROM messages WHERE page_id = '<PID>' AND direction = 'incoming';"
```

Compare `msgs_with_a_number` against the lead count. A large gap means phones arrived and weren't kept. Two distinct causes, and you must say which:
- **Not asked** — the AI never requests name/city/phone, so numbers only arrive when the customer volunteers them. This is a *persona* problem (below).
- **Asked, then dropped** — a known defect: `hold_low_confidence` early-returns at `messageProcessor.ts:718`, while `maybeCaptureLead` runs at `:902`, so **held messages never produce a lead**. Check whether any phone appearing in a `held_low_confidence` message is missing from `leads`. Also inspect `extracted_data` — `"fields": []` with only a summary means extraction ran but harvested nothing structured.

**Should the merchant add a lead hint to the persona? — answer this explicitly, every run.**

`brand_voice_notes` is injected into the system prompt verbatim (`promptBuilder.ts:258-262`), so it is the merchant's most direct lever on reply behavior — and the shipped template's last line is literally the lead hook: «الهدف: [نحو ماذا توجّه العميل — مثلاً أخذ الاسم والجوال لإتمام الطلب أو الحجز]». Decide with this rule:

- Persona still holds `[...]` placeholders → **yes, and it's the top recommendation.** Nothing is guiding the AI toward a close; it will answer questions politely and never ask for anything.
- Persona is written but the Goal line has no explicit "collect name + city + phone" instruction, and the lead count is low relative to buying conversations → **yes.**
- Persona already names the collection flow and leads are being captured → **no** — look at extraction quality or the hold defect instead.

Recommend concrete wording drawn from the merchant's own vertical rather than a generic sentence, and mirror the pattern that demonstrably works in prod: an explicit sequence («لما العميل يقول نبي نحجز… قوله كم طرف تبي؟ بعد يقولك الكمية قوله ارسلي اسم المدينة ورقم اتصال باش نكملك الطلب»). A page with that written down closes orders and produces leads; a page with placeholders does neither. For B2B merchants (wholesale, pharma, importers) the ask should include the business name, not just a personal name.

## Step 8 — Score the answering quality

Give an explicit verdict, not just observations. Score each dimension **Good / Weak / Failing** with a one-line reason and a quoted example. Always attribute the cause to *input* (persona, Business Info, settings) or *product* — merchants can act on the first, only you can act on the second.

| Dimension | What "Good" looks like |
|---|---|
| **Grounding** | Every price/size/address/phone traceable to the Business Info (Step 6). No invented specifics. |
| **Answer rate** | Real questions get real answers. Count silences: `held_low_confidence` never reviewed, `sla_no_reply` clusters, deflections to "call us". A high send count with low *answer* quality is not success. |
| **Sales progression** | Moves toward quantity → city → phone → confirmation. Best evidence is a thread that closed. |
| **Persona fidelity** | Sounds like the merchant's brand voice, mirrors the customer's dialect. Placeholder persona ⇒ automatically Weak. |
| **Honest limits** | Says «ما عندي المعلومة» / routes to phone instead of inventing. Refusing out-of-scope requests is Good, not a defect. |
| **Escalation** | Complaints and angry customers reach Needs Attention, and the merchant is visibly engaging (`manual` replies present). |
| **Lead capture** | The AI asks for name/city/phone at purchase intent, and volunteered contacts become `leads` rows (Step 7). |

State the headline verdict in one sentence — e.g. "the AI answers accurately but is starved of product data, so two-thirds of buying questions end in silence."

## Step 8 — Classify, then report

Sort every observation into the three buckets. For anything you want to call **product action**, trace the code first (`ai-worker/src/services/reply/replyValidator.ts`, `backend/src/services/reply/{commentProcessor,messageProcessor,generator}.ts`, `postReplyRule.ts`) and cite `file:line`. A flag count alone is not a defect.

Report in prose, leading with the verdict. Include, in this order: the one-sentence verdict; **the quoted transcripts from 4c** (the founder reads these first); the persona + Business Info state; which posts have Post Reply and in which mode; the volume split; the merchant-action list; the product-action list (usually empty). Keep Arabic quotes verbatim — never translate the merchant's or customer's words into English.

**Multi-page merchants:** run Steps 2–7 per page, but resolve settings once (they are per-user, not per-page). Report page-by-page — a merchant with three disabled pages and one active page has a very different story per page, and averaging them hides it. Flag any page with an armed Post Reply trigger but `auto_reply_enabled = false`: the trigger is inert (the pipeline returns at `commentProcessor.ts:121`, before Post Reply eligibility at line 179) while the dashboard still shows the post as configured. Comments on a user-disabled page are not even stored, so the evidence is an *absence* of rows — `0 comments` on an armed post is the signal.

---

## By design — check, then say "fine". Never report these as bugs.

| Signal | Why it is correct |
|---|---|
| `dm_failed` with `bucket=customer_refused` (codes 100/1893060, 10903/1893049) | The commenter's privacy settings block private replies from Pages. Facebook refuses the send; nothing we can do. It IS flagged for the merchant to answer publicly. |
| Unreplied comment, no flag, `resolved=true`, same commenter replied to seconds earlier | Per-(page, post, sender) debounce, 60s window (`COMMENT_DEBOUNCE_WINDOW_SECONDS`). Suppresses double-comments. |
| «شكراً لاهتمامك! للتأكد من السعر بدقة…» + `price_not_in_kb` | The price guard refusing to quote an ungrounded number. Safe by design — but see the known gap below. |
| Replies mirroring خليجي/ليبي/مصري dialect | Deliberate dialect mirroring in the reply pipeline. The فصحى-only rule covers Jawab24's own copy, not customer replies. |
| Refusing currency conversion, general trivia, or arbitrary math | Correct scope refusal. Stress-testers probe this; it is not a defect. |
| `complaint` / `angry_customer` flags | Working as intended — routing a human-needed thread to Needs Attention. |
| `template` replies on **audio**-only messages | Transcription failed → unsupported-media template. Expected. |
| **Silence** on a customer **image** (stored `[صورة]`, no reply, `sla_no_reply`) | The merchant's daily photo cap is spent, so we deliberately say nothing rather than tell their customer we cannot read images (2026-07-26). Correct behaviour — but confirm the *merchant* got the `image_limit_reached` notification, and see the image step in `/merchant-settings` for whether the cap is biting them repeatedly. |
| A single `send_failed_retries_exhausted` | Transient delivery failure. Only a finding if it clusters. |
| `held_low_confidence` on messages | The merchant enabled "hold low-confidence replies for review". The hold itself is correct — the *finding* is if the merchant never reviews the queue, which leaves the customer in silence. |
| Post Reply inert on a page the merchant switched off | Deliberate: page-level off means "leave this page alone" (`commentProcessor.ts:121`). D-027 exempts Post Reply from the **workspace** comments toggle only, never the page master switch. Report as merchant confusion, not a bug. |

**A text-only nudge on an IMAGE is now a real finding, not "expected".** Since 2026-07-26 the cap path stays silent, so «حالياً نستطيع الرد على الرسائل النصية والصوتية» sent after a customer photo can only mean a *technical* denial — `env_disabled` (kill switch off), `no_subscription`, `cap_check_failed` (Redis), or a download/format failure. Chase it; do not wave it through.

## Known product gaps — recognize, don't re-diagnose

- **Computed totals are blocked** (multi-item sums, item + delivery fee) even when every input number is in the Business Info. `flagHallucinatedPrice` grounds against numbers appearing *literally* in the KB text, so any arithmetic result is unreachable. Symptom: `price_not_in_kb` on «الحساب كم بالتوصيل». Fix in progress as prompt **v56** — model emits a `price_math` structured claim, validator verifies components against the KB and checks the sum. If you see this, note it and move on.
- **`generateWithTools` never calls `validateReply`** — native-catalog merchants (Salla/Shopify/Zid) get **no** price/language/length guard; their `flags` are the model's self-report. Symptom: fabricated low anchor prices with `flags=[]`. Separate open item from v56.
- Quantity math («كيسين») is a known weak spot; classify under the same v56 work rather than filing fresh.
- **`hold_low_confidence` suppresses lead capture** — the hold returns at `messageProcessor.ts:718`, before `maybeCaptureLead` at `:902`, so a held message's phone/name is lost. Confirmed in prod 2026-07-22 (a pharmacy's name + number vanished). Fix not built; note it and move on.

Prereqs: `~/.ssh/id_jawab24_deploy`, and `./scripts/prod-db-query.sh` from the repo root.
