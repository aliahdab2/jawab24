Draft and broadcast a "new feature" announcement email to Jawab24 merchants — human-in-the-loop, previewed to the founder first, then sent to `audience: users` via the existing broadcast engine.

Arguments: $ARGUMENTS
- Optional free text describing what shipped (e.g. "Post Reply image attachments"). If omitted, derive the changelog from git (Step 1).
- Optional `since <ref>` → base the changelog on commits since `<ref>` (a tag, SHA, or date). Default: since the last release tag.
- Optional `en` → draft the primary body in English. Default: فصحى Arabic (the merchant base is Arabic-majority; recipient language fallback is `ar`).
- Optional `send-anyway` → NOT honored. There is always a founder preview + explicit approval gate. Do not skip it.

## What this reuses (do NOT rebuild)

Sending is already solved. This skill only drafts copy, previews, and triggers the existing engine.

- **Engine:** `adminWaitlistService.sendEmail(input, adminUserId, log)` in `backend/src/services/admin/waitlist.ts`. It applies the `email_unsubscribes` suppression list, dedupes/lowercases, caps at 10,000 recipients, renders per-recipient AR/EN (only for custom-HTML templates — see Step 4), and writes a `waitlist_email_sends` audit row.
- **Why reuse it (not a raw Resend loop):** a raw `emailService.send` loop would bypass the unsubscribe suppression list → CAN-SPAM / legal exposure on a mass merchant broadcast. Always go through `adminWaitlistService.sendEmail`.
- **`SendEmailInput` shape** (`backend/src/utils/validation.ts`, `SendEmailSchema`): `{ subject, body, audience: 'waitlist'|'users'|'both'|'extras', feature?, emailIds?, extraEmails?, templateId? }`. `audience: 'users'` = all registered merchants with an email.

There is also an admin UI at `frontend/src/pages/admin/waitlist.tsx` (audience selector + subject/body + template picker + confirm). If the founder prefers a point-and-click send, hand them the drafted subject/body and point them there instead of running Steps 5–6.

---

## Step 1 — Determine what shipped

If `$ARGUMENTS` describes the feature, use that as the spine. Otherwise build the changelog from git:

```bash
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
git log ${LAST_TAG:+$LAST_TAG..}HEAD --no-merges --pretty=format:'%h %s' | grep -Ei '^\w+ (feat|fix)\(' | head -40
```

Pick only the **merchant-visible** changes (new capabilities, UX wins). Drop internal refactors, infra, test-only, and observability commits — merchants don't care about `refactor(...)` or `chore(...)`. If nothing merchant-facing shipped, say so and stop — do not manufacture an announcement.

## Step 2 — Draft the copy (فصحى, correct product terminology)

Follow `AI_INSTRUCTIONS.md` §5 and §6 exactly:

- **Arabic register: فصحى only.** This is OUR copy → Modern Standard Arabic. No dialect («وش، اللي، مو، ليش، هالـ، بدك، شلون»), no English loanwords where native Arabic exists. (The dialect-mirroring rule is for the AI *reply* pipeline, NOT for our marketing copy.)
- **Product terminology (never deviate):** "رد ذكي" / Smart Reply — never "AI reply" / "رد الذكاء الاصطناعي" in UI copy. "رد البوست" for Post Reply. "معلومات نشاطك التجاري" for Business Info — never "قاعدة المعرفة" / "Knowledge Base". "الرد التلقائي" for Auto Reply.
- Keep it short: one-line hook + 1–3 bullets of what's new + one concrete "how to use it" line + a soft CTA to open the app. No changelog dump.
- Subject: concrete and plain (a plainer subject helps deliverability — a promo-looking subject lands in Gmail Promotions). Example spine: «جديد في جواب24: <الميزة>».

> ⚠️ **HTML vs plain text — the trap that bit us (2026-07-18).** The `body` field is **plain text** — `waitlistEmailTemplate` runs `escapeHtml(body)` on it, so any `<h1>`, `<img>`, `<table>` you put there arrives as **literal visible tags**, not rendered HTML (`backend/src/utils/emailTemplates.ts`, the `else` branch). Raw HTML renders **only** through the **custom-HTML template path**: `waitlistEmailTemplate` returns `customHtml` as-is (only substituting `{{UNSUBSCRIBE_URL}}`). So:
> - **Plain-text announcement** (no styling/images) → use the `body` field. Fine as-is.
> - **Any styled / image / "teaching" email** → you MUST use a **custom-HTML template** (Step 3). There is no middle ground — HTML in `body` is always escaped.

Show the drafted **subject + body/HTML** to the user in the chat. Iterate until they approve the wording. Do NOT send anything yet.

## Step 3 — Custom-HTML template (required for HTML/image emails; also gives per-KB-language)

Plain `body` is text-only (Step 2 trap). **Any styled or image email — and any bilingual "send by KB language" email — goes through a custom-HTML template.** This is a code change in `backend/src/utils/waitlistTemplates.ts` + redeploy, but it's the only path that renders HTML *and* the only path that routes language per recipient. Both needs, one mechanism.

**The custom-HTML contract (get this exact or it breaks):**
1. `htmlBodyAr` / `htmlBodyEn` must each be a **complete HTML document** — `<!DOCTYPE html><html dir=…><head>…</head><body>…</body></html>`, with its own brand header + footer. It is returned **as-is** (NOT wrapped by the base shell). Model it on `backend/src/templates/waitlistLaunchAr.ts` / `…En.ts`.
2. Include the literal placeholder **`{{UNSUBSCRIBE_URL}}`** as the unsubscribe link `href` — the renderer substitutes the real per-recipient token. Omit it and merchants get a dead unsubscribe link (CAN-SPAM).
3. **Images MUST be public URLs — never data-URIs.** Gmail and most clients strip `data:` images, so an embedded-image email arrives with broken images for everyone. Host them first (see below) and reference `https://…` URLs.
4. Add the entry to `WAITLIST_TEMPLATES` with `subjectAr`/`subjectEn` + `bodyAr`/`bodyEn` (plain-text fallbacks) + `htmlBodyAr`/`htmlBodyEn` (the two docs). Put the docs in `backend/src/templates/<name>Ar.ts` / `…En.ts`.

**Hosting the images (public, reuses prod infra — no secrets handled):** upload each PNG through the prod `imageStorage` (already wired to the public B2 bucket `jawab24-media`). In-container script: `require('/app/backend/dist/services/imageStorage.js').imageStorage.put(key, buf, 'image/png')` → returns `{ url }`. Key scheme `announcements/<slug>/<name>.png`. Then **verify each is anonymously fetchable** (`curl -o /dev/null -w '%{http_code} %{content_type}'` → `200 image/png`) before using it — a private object silently breaks the email.

**Per-recipient language:** `resolveRecipientLanguages` (`backend/src/utils/recipientLanguage.ts`) picks each merchant's language from their KB chunk languages → `settings.dashboardLanguage` → `ar` fallback. This runs automatically for a custom-HTML template — no list-splitting.

**Preview mechanics:** to preview HTML **without deploying**, send the raw HTML doc directly via `emailService.send({ to, subject, html, type: 'transactional' })` (substitute a placeholder unsubscribe URL) to the founder only. The per-KB-language routing can only be exercised through the deployed `templateId` — so after deploy, send one more templated preview to confirm routing.

## Step 4 — Prod prerequisites (why this must run in prod)

- `RESEND_API_KEY` is **absent from local `backend/.env`** (dev = log-only, no real send). The broadcast MUST run in **production**.
- Sender defaults (prod container has `RESEND_FROM_*` unset): `Jawab24 <info@jawab24.com>` (from `backend/src/config/index.ts`).
- **Explicit authorization required** before touching the prod Resend path. Confirm with the user.
- Prod SSH: `~/.ssh/id_jawab24_deploy` → `root@91.99.95.196`. Active backend container: `jawab24-backend-green` (verify with `docker ps` — the active colour can flip on deploy).

Find an admin user id for the audit trail (`adminWaitlistService.sendEmail` needs `adminUserId`):

```bash
cat <<'SQL' | ssh -i ~/.ssh/id_jawab24_deploy -o StrictHostKeyChecking=no root@91.99.95.196 \
  'docker exec -i jawab24-postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1"'
SELECT id, email FROM users WHERE is_admin = true ORDER BY created_at LIMIT 1;
SQL
```

## Step 5 — PREVIEW to the founder first (mandatory gate)

Never let a merchant see an unreviewed broadcast. Send the exact rendered email to the founder ONLY, using `audience: 'extras'` so it touches nobody else:

```
input = { subject, body, audience: 'extras', extraEmails: ['ali.ahdab@telavox.com'] }
```

Run the send script (Step 6 recipe) with this `input`. The founder opens the real email in their inbox and confirms: wording, RTL rendering, terminology, links, subject-line deliverability. **Wait for explicit "looks good, send it" before Step 6's real broadcast.** If they want edits, go back to Step 2.

## Step 6 — Broadcast to merchants (only after approval)

Flip the audience to `users` and run the same script:

```
input = { subject, body, audience: 'users' }
```

Run it inside the prod backend container. The prod image has **no tsx/ts-node** and `tsconfig` only compiles `src/**`, so a scripts/ file isn't in `dist`. Use the same recipe proven for prod one-shot scripts: transpile with esbuild to CJS, rewrite `../src/*` requires to `../*` to match the image's dist layout, `docker cp` in, run with `node`. The script imports the **compiled** `adminWaitlistService` from `dist` and calls `sendEmail(input, adminUserId, log)`.

Sketch of the in-container script (`announce-send.mjs` / built to CJS):

```js
// resolves against the container's dist layout; confirm the exact path with `docker exec <c> ls dist/services/admin`
const { adminWaitlistService } = require('../services/admin/waitlist');
const input = { subject: '…', body: '…', audience: 'users' }; // or 'extras' for the preview
const adminUserId = '<uuid-from-step-4>';
const log = { info: console.log, warn: console.warn, error: console.error }; // Fastify-logger-shaped
adminWaitlistService.sendEmail(input, adminUserId, log)
  .then(r => console.log('SENT', JSON.stringify(r)))
  .catch(e => { console.error('FAILED', e); process.exit(1); });
```

Ship + run:

```bash
KEY=~/.ssh/id_jawab24_deploy; HOST=root@91.99.95.196
C=$(ssh -i "$KEY" "$HOST" 'docker ps --format "{{.Names}}" | grep jawab24-backend- | head -1')
# esbuild the script to CJS locally, then:
scp -i "$KEY" announce-send.cjs "$HOST:/tmp/"
ssh -i "$KEY" "$HOST" "docker cp /tmp/announce-send.cjs $C:/tmp/ && docker exec $C node /tmp/dist-path/announce-send.cjs"
```

The `sendEmail` result reports `recipientCount`, `successCount`, `failureCount` (also written to `waitlist_email_sends`). Report those numbers back to the user.

## Step 7 — Report + record

- Summarize: audience, recipient count, success/failure, subject line.
- Confirm the batch audit row landed in `waitlist_email_sends`.
- If this announcement type recurs, suggest promoting the copy to a reusable `WAITLIST_TEMPLATES` entry (Step 3 bilingual path).

---

Safety invariants (do not violate):
1. **Founder preview before any merchant send** — always. `audience: 'extras'` to the founder, wait for explicit OK, then `audience: 'users'`.
2. **Never a raw Resend loop** — always `adminWaitlistService.sendEmail` (keeps unsubscribe suppression + audit).
3. **Never print or copy the Resend key** — it stays in the prod container.
4. **فصحى + correct product terminology** in all copy (AI_INSTRUCTIONS §5/§6).
5. A broadcast is not un-sendable — treat the `audience: 'users'` step as irreversible and gate it accordingly.

Prereqs: `~/.ssh/id_jawab24_deploy` (prod SSH), esbuild (`npx esbuild`), prod authorization from the founder.
