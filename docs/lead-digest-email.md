# Lead Digest Email

Daily email that tells workspace owners which customers are still **waiting for contact**. Designed to stay within Resend's free tier (100 emails/day) while protecting sender reputation and respecting the account lifecycle (churned / abandoned users).

## Which leads it reports

**`status = 'new'` and `digest_emailed_at IS NULL`** — the same set the nav badge and the dashboard attention row count, so all three surfaces always agree on "how many are waiting".

A lead the merchant already worked (`contacted` / `converted`) is never reported and never stamped, so it keeps `digest_emailed_at = NULL` indefinitely — correct, since it never needed a digest, and moving it back to `new` makes it eligible again.

> Before Aug 2026 the query had no status filter. That was invisible while the volume trigger kept low-volume workspaces silent; the age trigger below reaches them, so without the filter a merchant who contacted and converted his one lead on day one would be emailed "you have 1 new lead" on day two while the dashboard correctly showed zero waiting.

## Behavior at a glance

- Runs once per day (cron via `setInterval`, registered in [`backend/src/index.ts`](../backend/src/index.ts))
- A user receives **at most one email per day**
- The workspace's digest fires when **either** trigger is met:
  1. **Volume** — **≥ 10 waiting leads** (`DIGEST_THRESHOLD`), or
  2. **Age** — the **oldest** waiting lead is **≥ 48 h** old (`DIGEST_MAX_AGE_HOURS`)
- …and the recipient additionally passes **all** of:
  1. An **email** on file (`users.email`)
  2. An **active or trialing subscription** on the workspace owner (`subscriptions.status ∈ {active, trialing}`)
  3. **Logged in within 30 days** (`users.last_seen_at`, `ENGAGEMENT_WINDOW_DAYS`)
  4. Has **not muted** the digest (`workspace_members.lead_digest_muted_at IS NULL`)
- Email language is picked by **detecting the language of the user's pages' knowledge bases** (`ar` or `en`, defaulting to `en`)
- Subject and intro are **plural-aware** (`tPlural`, CLDR categories via `Intl.PluralRules`) — the age trigger makes counts of 1 and 2 reachable, where "1 customers" / «1 عميل» would be wrong in both languages
- Every send attempt — including skips — is persisted in `lead_digest_sends` for observability

## Why the gates exist

| Gate | Reason |
|---|---|
| ≥10 volume trigger | Batches a busy workspace into one email instead of a daily trickle |
| 48 h age trigger | A lead is time-sensitive. The volume trigger **alone** starved low-volume merchants: found live 2026-08-04, a paying merchant at ~1 lead/day was emailed exactly once ever — the day his first 10 accumulated — while 9 more piled up unworked. The age trigger caps the wait at "two mornings" |
| Active subscription | Churned users shouldn't receive feature-related email |
| 30-day engagement | Protects sender reputation. Mailbox providers (Gmail, Outlook) track domain-level engagement — sending to abandoned inboxes hurts deliverability for **all** users |
| Stamp-on-skip | Operational hygiene: abandoned/churned users' leads are stamped anyway so the daily query doesn't re-process them forever |

> **Send-volume note.** The ≥10 threshold used to be the de-facto cap on daily volume. It is not any more: with the age trigger, *any* workspace holding one waiting lead older than 48 h emails every owner + admin. The practical ceiling is now roughly `active workspaces with a waiting lead × recipients ÷ 2 days`. At current scale that is far below Resend's 100/day, but the threshold is no longer what keeps it there — watch `lead_digest_sends` as workspace count grows.

## Data model

### `leads.digest_emailed_at` (new column)

Set when a lead has been included in a digest or when the user was skipped for a terminal reason (no email, no subscription, abandoned). `NULL` means the lead is still eligible for the next digest.

Index: `idx_leads_digest_emailed_at` on the column.

### `lead_digest_sends` (new table)

Audit log of every send attempt.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | pk |
| `user_id` | uuid | FK `users.id` (cascade) |
| `status` | varchar(32) | One of: `sent`, `failed`, `skipped_no_email`, `skipped_no_subscription`, `skipped_abandoned` |
| `lead_count` | integer | How many leads would have been / were emailed |
| `lang` | varchar(10) | `ar` \| `en` \| `null` when skipped before language pick |
| `resend_email_id` | varchar(255) | Resend API response ID (clickable in Resend dashboard) |
| `error_message` | text | Populated when `status = failed` |
| `created_at` | timestamp | defaults now |

Indexed on `user_id` and `created_at`.

## Files

| File | Role |
|---|---|
| [`backend/src/services/leadDigest.ts`](../backend/src/services/leadDigest.ts) | Core logic: `runDailyLeadDigest()`, gates, stamping, audit write |
| [`backend/src/utils/emailTemplates.ts`](../backend/src/utils/emailTemplates.ts) | `leadDigestEmailTemplate()` — HTML email (branded, RTL-aware, "and N more" truncation at 20 rows) |
| [`backend/src/utils/i18n.ts`](../backend/src/utils/i18n.ts) | `leadDigest*` string keys (ar + en) |
| [`backend/src/db/schema.ts`](../backend/src/db/schema.ts) | `leads.digestEmailedAt`, `leadDigestSends` table |
| [`backend/src/index.ts`](../backend/src/index.ts) | Daily cron registration |
| [`backend/src/routes/admin.ts`](../backend/src/routes/admin.ts) | Admin endpoints (manual run + history) |
| [`backend/src/__tests__/leadDigest.test.ts`](../backend/src/__tests__/leadDigest.test.ts) | 9 unit tests |
| [`backend/migrations/0085_curly_warpath.sql`](../backend/migrations/0085_curly_warpath.sql) | `digest_emailed_at` column |
| [`backend/migrations/0086_lyrical_madrox.sql`](../backend/migrations/0086_lyrical_madrox.sql) | `lead_digest_sends` table |

## Admin endpoints

Both require authenticated admin user.

### `POST /admin/lead-digest/run`

Manually trigger the digest job. Same stamping logic applies, so repeated calls will not re-email already-stamped leads. Returns `{ processed, sent, skipped, errors }`.

### `GET /admin/lead-digest/history?page=1&limit=50&status=sent`

Paginated list of recent sends/skips with user email, Resend ID, and error message. Useful for:
- Customer support ("did we email this user?")
- Debugging deliverability (filter `status=failed`)
- Monitoring skip reasons (filter `status=skipped_abandoned`)

## Scheduling

Cron interval: **24h** (`setInterval` in `backend/src/index.ts`). First run delayed 5 min after boot to avoid blocking startup.

> The job fires on a UTC 24h boundary from the server's first boot, **not** the merchant's local timezone. Timezone-aware send timing is a known follow-up (see "Out of scope").

## Idempotency & retry behavior

| Scenario | Result |
|---|---|
| Successful send | Leads stamped; audit row written (`sent`) |
| Email send fails | Leads **not** stamped (so next day's run retries); audit row written (`failed`) |
| User fails a terminal gate (no email / subscription / engagement) | Leads stamped (so we don't re-process them forever); audit row written (`skipped_*`) |
| Workspace below **both** triggers (< 10 waiting leads AND oldest < 48 h) | No write at all; leads roll over to next day |
| Merchant works a lead before it is digested | Never reported, never stamped — it leaves the waiting set instead |
| Cron runs twice same day | Second run no-ops — the waiting set is now empty because all reported leads were stamped |

## Best practices applied

- ✅ **Idempotent stamping** — atomic "stamp after success" design, safe to retry
- ✅ **Per-user error isolation** — one user's failure can't break others
- ✅ **Engagement gate** — protects Resend sender reputation (IP warm-up / domain reputation)
- ✅ **Subscription gate** — churned users don't get feature mail
- ✅ **XSS-safe template** — all dynamic values go through `escapeHtml`
- ✅ **Observability** — structured logs + Sentry + queryable audit table
- ✅ **Graceful dev mode** — `emailService.send()` short-circuits in development without hitting Resend
- ✅ **No PII in logs** — counts and IDs only, never lead contents
- ✅ **Indexed queries** — `idx_leads_digest_emailed_at`, `idx_lead_digest_sends_user_id`
- ✅ **Startup-safe** — first run delayed 5 min so a crash doesn't block boot

## Out of scope (deferred)

| Item | Why deferred |
|---|---|
| `List-Unsubscribe` header | Low risk at current volume; add before scaling past a few hundred daily sends |
| Per-user "turn off lead emails" toggle | No product demand yet; the three gates already prevent most unwanted sends |
| Timezone-aware send time | Requires per-user timezone + a per-user schedule; noticeable only once volume is higher |
| Resend bounce / complaint webhook → suppression list | Add when the first real bounce appears in `lead_digest_sends.status = failed` |
| Admin UI page for history | API exists; build the UI once it's actively used in ops |

## Manual verification

```bash
# 1. Run migrations
cd backend && npm run db:migrate

# 2. Trigger the digest manually (admin token required)
curl -X POST http://localhost:3000/admin/lead-digest/run \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 3. Inspect the audit log
curl "http://localhost:3000/admin/lead-digest/history?limit=20" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 4. Filter to sent only
curl "http://localhost:3000/admin/lead-digest/history?status=sent" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

In development (`NODE_ENV=development`), `emailService.send()` logs instead of hitting Resend — so you can verify the flow end-to-end without burning real email quota.

## Quota math

Worst case: every active+engaged recipient's workspace fires every day → 1 email/recipient/day. Note this is per **recipient** (owner + admins), not per workspace.

- Resend free tier: 100 emails/day, 3,000/month
- Headroom: ~100 active engaged recipients per day, ~3,000/month
- Thanks to the engagement gate, abandoned users don't eat into this budget
- Since Aug 2026 the ≥10 threshold is **no longer** what bounds this — the 48 h age trigger reaches every workspace with a single waiting lead (see the send-volume note above). The realistic steady state is one email per waiting workspace every other day; re-check against `lead_digest_sends` as the workspace count grows

## Tests

Unit tests in [`backend/src/__tests__/leadDigest.test.ts`](../backend/src/__tests__/leadDigest.test.ts) — `db` is mocked, so these cover trigger logic, gates and stamping:

1. Below **both** triggers → no send, no stamp, no audit
2. All gates pass → sends, stamps, writes `sent` audit row with Resend ID
3. No email → stamps, writes `skipped_no_email`
4. Canceled subscription → stamps, writes `skipped_no_subscription`
5. No subscription row → stamps, writes `skipped_no_subscription`
6. Abandoned (old `last_seen_at`) → stamps, writes `skipped_abandoned`
7. Email send fails → does **not** stamp, writes `failed` with error message
8. Arabic KB → email subject in Arabic
9. Two users, one above/one below threshold → processed independently
10. Age flush: below threshold but oldest ≥ `DIGEST_MAX_AGE_HOURS` → sends; keyed on the **oldest** lead; just under the threshold age → does not send

Plural agreement in [`backend/src/__tests__/leadDigestPlurals.test.ts`](../backend/src/__tests__/leadDigestPlurals.test.ts) — English singular at 1, Arabic one/two unnumbered, few/many/other by CLDR category.

**Which leads are selected** is proven against real Postgres in [`backend/test/integration/leadDigestScope.test.ts`](../backend/test/integration/leadDigestScope.test.ts) — the unit suite mocks `db` and hands the service a fixed row set, so it can never verify the SQL predicate. The integration suite covers contacted/converted leads being excluded, a mixed queue reporting and stamping only the waiting ones, and an already-digested lead never re-sending.
