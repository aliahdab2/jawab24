# Instagram-Direct Connect (Instagram Login, no Facebook Page) — Plan

> Status: **Phase A in progress** (demand measurement + App Review prep). Build (Phase B) is
> gated — see the gate at the bottom. Owner improves/edits this doc directly; it is the
> single source of truth for this track. Created 2026-08-16.

## Why (and why not yet)

Meta's "Instagram API with Instagram Login" lets a professional (Business/Creator) IG
account connect **directly** — no linked Facebook Page. Today Jawab24 only reaches
Instagram *through* a Facebook Page (`/me/accounts` → `page.instagram_business_account`),
so an Instagram-only merchant bounces silently. The MES thread-ownership incident showed a
competing tool connected exactly this way.

Counter-signal: Instagram is ~4.5% of all messages ever processed (≈9.5k vs ≈203k
Facebook), and the funnel's constraint is post-signup conversion, not the front door. So
the build is gated on **measured demand**, not intuition.

## Phase A — measurement + review (no build commitment)

### A1. Demand instrumentation (this PR)
Two one-row-per-user signals in the existing `activation_events` store (NOT funnel steps):

| Signal | Fires when | Where |
|---|---|---|
| `no_fb_pages` | Facebook login completed but `/me/accounts` returned nothing AND the workspace has no pages (revoked-permission re-syncs of established workspaces are excluded) | `POST /pages/sync` zero-branch, `backend/src/controllers/pages.ts` |
| `ig_direct_interest` | Merchant clicks the new empty-state CTA «أرغب بربط إنستغرام مباشرة» on /pages | `POST /pages/instagram-direct-interest` |

Read-out (any time, read-only):
```sql
SELECT event, count(*) FROM activation_events
WHERE event IN ('no_fb_pages','ig_direct_interest') GROUP BY 1;
```

### A2. Baseline (prod, 2026-08-16, pre-instrumentation)
- 22/82 users (27%) signed up and connected **zero** channels; 5 of them in the last 30 days.
- Real business names among them: «أم أنس بربيش للحلويات», «Al Muktar Villas», «عرش الدراما».
- ⚠️ `has_instagram_permission` = false for all 22 is a **blind proxy**: a merchant with no
  FB Page cannot grant `instagram_basic` on the FB-Login dialog at all. Hence this PR's
  direct signals.

### A3. Meta App Review (longest pole — submit in parallel)
Request `instagram_business_basic` + `instagram_business_manage_messages` +
`instagram_business_manage_comments` (NOT `content_publish` — we don't publish) on the
"Instagram API with Instagram Login" product. Our approved `instagram_manage_*` scopes are
the Facebook-Login variants; this is a separate track (already listed "not yet submitted"
in `.planning/codebase/INTEGRATIONS.md`).

Prereqs: add the product to app 774211662298446 · a TEST IG professional account with no
linked FB Page · screencast (connect → DM auto-reply + inbox reply → Post Reply keyword
comment → hide comment → automation-off switch) · reviewer credentials.
Approval does not commit us to building — it removes the calendar bottleneck.

## Phase B — build (≈1–2 weeks) — ⛔ GATED

1. **Schema**: `pages.instagram_access_token` (encrypted `enc:v1:`) +
   `instagram_token_expires_at` — mirror the WhatsApp per-channel block
   (`backend/src/db/schema.ts:222-230`). One shared `pages.access_token` today serves both
   FB and IG; IG-direct needs its own token + 60-day refresh.
2. **Connect flow (Rule 17b)**: `Browser.open()` straight to the Instagram OAuth dialog
   (tab STARTS at the third party); return via a PAGE that navigates the `/auth/app-sync`
   App Link — never a 302; single-use state via `lib/singleUseKey`.
3. **Tokens**: short→long-lived exchange, refresh job mirroring the WhatsApp token
   refresh; page row without an FB page (WhatsApp-only card precedent).
4. **Send path**: `graph.instagram.com` client for IG-direct accounts (DMs + comment
   replies); linked-via-FB accounts keep `graph.facebook.com` + Page token. One adapter
   decision point — no forked reply logic (Rule 19: eval mirrors any reply-touching change).
5. **Webhooks**: ingestion already keys on the IG account id
   (`pagesService.getPageByInstagramId`); verify app-level subscription coverage for
   Instagram-Login accounts during build.
6. **Tests**: unit + integration for the token path; E2E connect mock; Android release
   after (bundled frontend lags web).

## Gate for Phase B (all three)
1. **Demand signal**: meaningful `no_fb_pages` / `ig_direct_interest` counts after 2–3
   weeks of signups (owner judges the threshold against the effort).
2. **App Review approved.**
3. **Owner go** — after Phase-0 billing fixes land (see the study plan).

## Open questions (owner input welcome — edit here)
- Threshold: how many interest clicks justify the build?
- Should the Libya ad test (still unlaunched) run BEFORE judging demand, so the signal
  reflects paid traffic too?
- Pricing: does an IG-direct-only merchant land on the same plans? (Pricing decisions are
  deferred overall.)
