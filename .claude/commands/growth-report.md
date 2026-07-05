Generate a merchant growth report (Arabic, RTL) proving the impact of Jawab24 for a connected page, backed by real data — published as an Artifact and exported to PDF.

Arguments: $ARGUMENTS
- A page name (Arabic or English, partial OK), a `facebook_page_id`, or an internal page UUID. Use it to resolve the page in step 1.
- Optional "en" → build the report in English (LTR) instead of Arabic.
- Optional "no-pdf" → skip the PDF export (Artifact only).
- Optional "email" → after building, offer to send it (see Step 6). Always preview to the founder first.

Two CVD-validated reference designs (REUSE palette, layout, RTL structure, chart code, print CSS verbatim — only swap data + narrative):
- `.claude/commands/assets/growth-report-template.html` — **Mode A**, with Facebook Insights (built for الفريق الدمشقي).
- `.claude/commands/assets/growth-report-template-noaccess.html` — **Mode B**, Jawab24 data only (built for Nourva).

## Report modes — pick before building

- **Mode A (with Facebook Insights):** use when the user supplies the page's FB "Professional Dashboard → Insights" PDF exports. Facebook's own before/after (e.g. conversations +1,186%, follower %, reach) is the strongest proof. Hero thesis = a growth %; includes the before/after chart and the reach/audience section.
- **Mode B (Jawab24 data only):** use when **you don't have access to the page's Facebook Insights** (common — the founder rarely has dashboard access to a customer's page). Build entirely from Jawab24 operational logs. NO before/after chart, NO reach/audience section, all KPIs tagged جواب24 only. Hero thesis = a **scale** number (messages handled). Section 1 = scale + automation (e.g. 99.7% automated). The methodology card MUST state plainly that FB Insights weren't available. This is the honest default when page access is absent — don't fabricate FB-side numbers.

Ask/confirm which mode up front based on whether FB Insight PDFs exist.

---

## Step 1 — Resolve the page (prod DB)

Prod Postgres is the `jawab24-postgres` container. Pipe SQL over SSH (never hardcode DB creds —
the container already has `$POSTGRES_USER`/`$POSTGRES_DB`):

```bash
cat <<'SQL' | ssh -i ~/.ssh/id_jawab24_deploy -o StrictHostKeyChecking=no root@91.99.95.196 \
  'docker exec -i jawab24-postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1"'
SELECT p.id, p.name, p.facebook_page_id, p.workspace_id, p.created_at, p.auto_reply_enabled
FROM pages p
WHERE p.name ILIKE '%<SEARCH>%' OR p.facebook_page_id = '<SEARCH>' OR p.id::text = '<SEARCH>';
SQL
```

Confirm the go-live date with the user (the page row `created_at` is often earlier than
real activation — e.g. the reference page was created 2026-03-10 but activated 4 Apr).
Note the first month may be a partial ramp; treat the first FULL month as "month 1".

## Step 2 — Pull operational metrics (Jawab24-sourced)

Run the metrics query with the resolved `:pid` (page UUID). This is the exact query behind the
reference report — monthly DM trends, comments (via posts join), leads, response time, automation:

```bash
cat <<'SQL' | ssh -i ~/.ssh/id_jawab24_deploy root@91.99.95.196 \
  'docker exec -i jawab24-postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1"'
\set pid '<PAGE_UUID>'
-- Overall DM totals + automation split
SELECT count(*) FILTER (WHERE direction='incoming') incoming,
       count(*) FILTER (WHERE direction='outgoing') outgoing,
       count(DISTINCT sender_id) unique_customers,
       count(*) FILTER (WHERE direction='outgoing' AND reply_method='ai') ai_replies,
       count(*) FILTER (WHERE direction='outgoing' AND reply_method='template') template_replies,
       count(*) FILTER (WHERE direction='outgoing' AND reply_method='manual') manual_replies,
       count(*) FILTER (WHERE direction='outgoing' AND reply_method='post_reply') post_replies
FROM messages WHERE page_id = :'pid';
-- Monthly DM trends
SELECT to_char(date_trunc('month', COALESCE(created_time, created_at)),'YYYY-MM') month,
       count(*) FILTER (WHERE direction='incoming') incoming,
       count(DISTINCT sender_id) unique_customers,
       count(*) FILTER (WHERE direction='outgoing') replies_sent,
       count(*) FILTER (WHERE direction='outgoing' AND reply_method IN ('ai','post_reply')) ai_replies
FROM messages WHERE page_id = :'pid' GROUP BY 1 ORDER BY 1;
-- Monthly comments (join posts to scope to this page)
SELECT to_char(date_trunc('month', COALESCE(c.created_time, c.created_at)),'YYYY-MM') month,
       count(*) received, count(*) FILTER (WHERE c.replied) replied,
       count(*) FILTER (WHERE c.reply_method IN ('ai','post_reply')) ai_replied
FROM comments c JOIN posts p ON p.id = c.post_id
WHERE p.page_id = :'pid' GROUP BY 1 ORDER BY 1;
-- Monthly leads
SELECT to_char(date_trunc('month', created_at),'YYYY-MM') month, count(*) leads,
       count(*) FILTER (WHERE status='converted') converted
FROM leads WHERE page_id = :'pid' GROUP BY 1 ORDER BY 1;
-- Median/avg DM response time (AI, within 1h)
SELECT count(*) n,
       round(avg(extract(epoch FROM (replied_at - COALESCE(created_time, created_at)))))::int avg_sec,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (replied_at - COALESCE(created_time, created_at)))))::int median_sec
FROM messages WHERE page_id = :'pid' AND direction='incoming' AND replied AND replied_at IS NOT NULL
  AND replied_at > COALESCE(created_time, created_at)
  AND replied_at < COALESCE(created_time, created_at) + interval '1 hour';
SQL
```

**Instagram / multi-channel:** if the page has a linked Instagram account (`pages.instagram_username` set), DMs from both channels live in `messages` (filter/split on `platform IN ('facebook','instagram')`). Instagram comments are a SEPARATE table — `instagram_comments`, scoped by `workspace_id` (no page_id column; join via `instagram_media.page_id` if the workspace has >1 page). Report FB+IG together and show the channel split (it's a selling point that Jawab24 covers both). Note comment auto-reply is often OFF for a page (replied=0) — if so, lead on DMs + leads, don't feature comments.

**Granularity:** if the tenure is short (≈2 months) or the weekly series is choppy (pauses/maintenance produce near-zero weeks), use **monthly** bars, not a weekly line that surfaces the dips as "instability" to the customer — monthly totals are accurate and standard. Mark partial months (start mid-month; current month with only N days) with the ghost/hatch bar style + a caption. Never let a partial month read as a decline.

## Step 3 — (Optional but strongest) ingest Facebook Insights

If the user provides Facebook "Professional Dashboard → Insights" exports (PDFs, usually in
`~/Downloads`), extract the numbers — they are the most credible proof because they are Facebook's
OWN before/after. Requires poppler (`brew install poppler` if `pdftotext` is missing):

```bash
for f in ~/Downloads/*Facebook*.pdf; do echo "### $f"; pdftotext -layout "$f" - | head -120; done
```

Pull, with the exact period labels shown on each page:
- **Messaging**: conversations started + "±% from previous 90 days" (the before/after), messaging
  contacts, new vs returning, organic %, response rate, response time.
- **Audience**: total followers + "±%", net follows, unfollows, geography, age/gender.
- **Views**: total views + "±%", 3-second video views + "±%", followers vs non-followers split, top posts.

Derive the previous-period baseline transparently: `previous = current / (1 + pct/100)` and footnote it
(e.g. the reference report showed conversations "~460 → 5,942" from Facebook's stated +1,186.1%).

## Step 4 — Build the report

Copy `assets/growth-report-template.html` to the scratchpad and replace ONLY: merchant name +
period (hero), the period-emphasis strip, every KPI/fact figure, the JS data objects at the bottom
(before/after bars, `monthly` small-multiples, top-posts), the narrative sentences, and the
methodology table. Keep palette, layout, chart code, and print CSS as-is.

**Framing rules (rigorous — do not overclaim):**
- Tag every number by source: `فيسبوك` (Facebook dashboard) vs `جواب24` (our operational logs). Keep the two visually distinct (see `.tag-fb` / `.tag-j`).
- **Directly attributable** to Jawab24: response rate, response time, conversation-volume growth (Jawab24 is what answers). Say so plainly.
- **Contributed to** (not solely caused): follower & view growth also depend on the merchant's own content. Frame as "the page's growth in the same period, with Jawab24 as a driver." Include the honesty note in the methodology card.
- Mark partial months (e.g. current month with only N days) with the ghost/hatched bar style and a caption — never let a partial month read as a decline.
- Unique-customer totals ≠ sum of months (same customer recurs) — footnote it.
- Emphasize the SHORT time window — big results in ~90 days is the story (period strip + hero).
- **Word must match the statistic.** `متوسط` = average (mean); `وسيط` = median. The DB response-time query returns both — don't label the median value with the word متوسط. The response-time distribution is right-skewed (median ≈ 4s, mean ≈ 25s), so the cleanest true phrasing for the fast figure is **«نصف الرسائل يُردّ عليها خلال N ثوانٍ»** (median, no jargon). Arabic grammar: use `حسابكم` (singular) not the dual `حسابَيكم`, even across two platforms.

## Step 5 — Publish + export PDF

- Load the `artifact-design` skill, then publish with the **Artifact** tool (it supplies the
  `<!doctype>/<head>/<body>` wrapper; the template is body-content only).
- Unless "no-pdf": export a PDF with headless Chrome (print CSS already forces background colors and
  paginates A4 landscape). Verify the render before delivering — render page 1 to PNG and look at it:

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT="$HOME/Downloads/<merchant>-growth-jawab24.pdf"
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer \
  --user-data-dir="/tmp/pdfprof-$$" --print-to-pdf="$OUT" "file://<TEMPLATE_COPY>"
pdftoppm -png -f 1 -l 1 -r 80 "$OUT" /tmp/pdfcheck   # then Read /tmp/pdfcheck-01.png to eyeball
```

Deliver: the Artifact URL + the PDF path. Summarize the headline growth figures and their sources.

## Step 6 — (Only if asked) email the report to the customer

Jawab24 sends via **Resend** (`backend/src/services/email.ts`). Two hard facts:
- **Local `backend/.env` has no `RESEND_API_KEY`** (dev = log-only) → the real send MUST run in **production**.
- `RESEND_FROM_EMAIL`/`_FROM_NAME` are also unset in the prod container → code default sender = **`info@jawab24.com`** (name "Jawab24", from `backend/src/config/index.ts`). The built-in EmailService does **not** attach files — for a PDF attachment, make a direct Resend API call with `attachments:[{filename, content:<base64>}]`.

Rules (outward-facing action):
1. **Explicit authorization required** to use the Resend key — it lives in prod, not local `.env`. Confirm before touching it.
2. **Always preview to the founder first** (`aliahdab@gmail.com`), get their OK, then flip the recipient to the customer. Never send to a customer unreviewed.
3. Set `reply_to` to a monitored Jawab24 inbox (default `info@jawab24.com`).

Send recipe (key never leaves prod, never printed) — an `.mjs` that reads `process.env.RESEND_API_KEY`, reads `/tmp/report.pdf`, and POSTs to `https://api.resend.com/emails`:
```bash
KEY=~/.ssh/id_jawab24_deploy; HOST=root@91.99.95.196; C=jawab24-backend-green
scp -i "$KEY" send-in-container.mjs report.pdf "$HOST:/tmp/"
ssh -i "$KEY" "$HOST" "docker cp /tmp/send-in-container.mjs $C:/tmp/ && docker cp /tmp/report.pdf $C:/tmp/report.pdf && docker exec $C node /tmp/send-in-container.mjs"
```
The `.mjs`: `from = \`${process.env.RESEND_FROM_NAME||'Jawab24'} <${process.env.RESEND_FROM_EMAIL||'info@jawab24.com'}>\``, `to:[recipient]`, `reply_to`, subject, RTL html body, `attachments:[{filename:'...pdf', content:<base64>}]`. See `.claude/commands/assets/` git history for the exact script used for Nourva. Deliverability: a PDF from a transactional domain can land in Gmail Promotions; a plainer subject helps.

---

Prereqs: `~/.ssh/id_jawab24_deploy` (prod SSH), poppler (`pdftotext`/`pdftoppm`), Google Chrome.
Chrome MCP (`chrome-devtools`) can't attach if a Chrome is already using its profile — use headless
Chrome directly (as above) for screenshots/PDF, with a throwaway `--user-data-dir`.
