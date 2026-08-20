# External Integrations

## Social Media APIs

### Facebook / Instagram (Meta)
- **Purpose**: Primary platform for auto-reply automation
- **API Version**: Graph API v18.0 (configurable in environment)
- **App Status**: **Live mode** (approved 2026-03-21, App ID: 774211662298446)

- **OAuth Flow**:
  - User connects via Facebook Login
  - Access token stored encrypted (AES-256-GCM) in database
  - Token refresh: automatic background cron job every 6 hours (`/backend/src/services/tokenRefresh.ts`) — verifies tokens via Facebook debug_token API, re-fetches fresh page tokens if valid
  - **Live recovery (2026-08-14, `/backend/src/services/pageTokenRecovery.ts`)**: the cron alone left a window of up to 6h — a page token dies the moment the merchant changes their Facebook password (Graph `190/460`), and every call in between fails while the DB row still looks healthy. So the FIRST Graph call that hits a token-revoked code now re-mints that page's token from `/me/accounts` in-request and the caller retries once. When the user session is dead too (the password case, where re-minting cannot work), the page is marked disconnected and the merchant is told **which of the five causes** it was — in-app to the workspace and push **per page**, email to the page owner **at most once per owner per day**. The email is owner-scoped, not page-scoped, because the cause is: one revoked session kills every page token minted from it at the same instant, so a page-scoped dedup would mail an agency owner one identical notice per dead page. Guards: 5-min per-page Redis cooldown on FAILED attempts (released on success), in-process single-flight, a 24h per-page alert dedup, and a 24h per-owner email dedup — one dead token produced 36+ failing calls in 11 minutes in production. Both dedup claims are **released the moment a working token is written back** (`clearReconnectAlertClaims`, called from every restore path: page sync/reclaim, the 6h sweep's re-mint, recovery's own re-mint, and the ops recovery script), so a page that dies again after a reconnect alerts on every channel — the claims collapse repeats of ONE incident, never the next one. Both destructive writes (the clear and the re-mint) are compare-and-set on the ciphertext read at recovery entry, so a reconnect completing during the `/me/accounts` round trip can never be overwritten by the stale verdict. Every Redis claim falls back to a per-process ledger when Redis is unreachable, rather than failing fully open (both guards failing open at once is that same storm). Wired at the picker read path (`posts.listPublishedPosts` — both the fail-soft Facebook reads and the THROWING Instagram read, which shares the same page token) and the reply send path, where `messageProcessor` re-mints and **retries the send once** before booking a lost reply, with `pageAutoPause.recordSendFailure` as the fallback trigger. NOT covered: comment/message ingestion reads.
    - ⛔ **WhatsApp is structurally excluded, not merely uncovered.** It sits on the same `pages` row but carries `whatsapp_access_token`, a separate credential on Meta's forced 60-day clock with its own health cron (`whatsappTokenHealth.ts`) and its own reconnect notice (`whatsappAdapter` → `markWhatsAppNeedsReconnect`). Meta answers an expired WABA token with code **190 too**, so the exclusion is enforced by `pageAutoPause.ownsFacebookCredential(platform)` at the choke point rather than left to callers: without it, a WhatsApp expiry would run Facebook page-token recovery, and — when the user session is also gone — clear `pages.access_token` and mail the merchant "reconnect your Facebook page" to explain a WhatsApp outage. Page-linked Instagram is the opposite case and IS included: it is columns on the page row, not a separate credential, so one revoked session kills both. **Instagram-DIRECT (Instagram Login) is excluded for the same reason as WhatsApp** — see the section below.

- **Meta App Review — Permission Status**:
  - ✅ `pages_messaging` — Approved (2026-03-21) — send/receive Messenger DMs
  - ✅ `pages_manage_metadata` — Approved (2026-03-21) — webhook subscription for pages
  - ✅ `pages_show_list` — Approved (2026-03-21) — list user's pages in dashboard
  - ✅ `public_profile`, `email` — Always approved
  - ✅ `pages_read_user_content` — Approved (2026-04-07) — read page posts and comments
  - ✅ `pages_read_engagement` — Approved (2026-04-07) — read comments (feed webhooks)
  - ✅ `pages_manage_engagement` — Approved (2026-04-07) — reply to comments; also covers the Post Reply like-the-comment option (`POST /{comment-id}/likes`, `facebookService.likeComment`)
  - ✅ `instagram_basic` — Approved (2026-04-07) — Instagram account access
  - ✅ `instagram_manage_comments` — Approved (2026-04-07) — reply to Instagram comments
  - ✅ `instagram_manage_messages` — Approved (2026-04-07) — Instagram DMs
  - ⏳ `instagram_business_basic` — Standard Access only; not yet submitted (Instagram-direct; text ready at `.planning/IG_LOGIN_APP_REVIEW.md`)
  - ⏳ `instagram_business_manage_messages` — Standard Access only; not yet submitted (Instagram-direct)
  - ⏳ `instagram_business_manage_comments` — Standard Access only; not yet submitted (Instagram-direct)
  - ⚠️ The dashboard shows the first two as **"App Review rejected"**. That verdict is
    dated **6 March 2026**, predates the Instagram-direct feature, and rejected almost
    every scope in that submission — the rest were resubmitted and approved (21 Mar,
    7 Apr, 26 Jul) and serve production today. Its stated cause was the SCREENCAST
    ("does not show a message being sent from your app UI and the same message
    appearing in the native client"); Meta added that the "use case is allowed".
    ⛔ Never press **"Request again"** on that page — it resubmits the whole old
    bundle including the Facebook scopes already approved and in production.

### Instagram-direct — "Instagram API with Instagram Login" (no Facebook Page)

A professional (Business/Creator) Instagram account can connect with its OWN
credentials, no Facebook Page involved. **Separate Meta app credentials**
(`INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` / `INSTAGRAM_APP_REDIRECT_URI`,
`config.instagram`) — never the Facebook app's. The whole feature is dark unless
all three are set (`instagramLoginService.isConfigured`), and Standard Access
covers our own test accounts, so App Review gates external merchants only.

✅ **LIVE IN PRODUCTION since 2026-08-17.** Backend credentials configured, the
frontend flag (`NEXT_PUBLIC_INSTAGRAM_DIRECT_ENABLED`) built into the image, and
the first real account — `@jawab24app` — connected end to end with
`subscribeToWebhooks` reporting `ok`. ⚠️ Still Standard Access: only Instagram
accounts holding a ROLE on app `774211662298446` (admin / developer / **Instagram
Tester**) can complete the connect, so it is not yet usable by merchants. App
Review for the three `instagram_business_*` scopes is the only remaining gate —
draft and screencast plan in `.planning/IG_LOGIN_APP_REVIEW.md`.

⭐⭐ **The two environment traps this feature hit, both costing hours:**
1. `NEXT_PUBLIC_INSTAGRAM_DIRECT_ENABLED` belongs in **`env/frontend.env`** on the
   server, not the root `.env`: `deploy-on-server.sh build_images()` exports that
   file into the shell before `docker-compose build`, and shell env WINS over the
   root `.env` in compose interpolation. A full deploy with the var missing there
   ships a correct-looking image whose flag is constant-folded to `false`.
2. A **truncated `INSTAGRAM_APP_SECRET`** (20 chars instead of Meta's 32) makes
   `POST api.instagram.com/oauth/access_token` answer with the canned message
   *"Error validating verification code. Please make sure your redirect_uri is
   identical to the one you used in the OAuth dialog request"*. The redirect URI
   is a RED HERRING — Meta returns that text for a bad client secret too. Compare
   the secret's length and hash against the dashboard value before touching any
   redirect configuration.

- **The row**: `facebook_page_id NULL`, `access_token ''`, and the credential in
  the encrypted `instagram_access_token` (+ `instagram_token_expires_at`,
  migration 0169). A row is Instagram-direct when it has that token AND no
  Facebook Page — both halves, so an existing Page-linked page is never silently
  moved onto the new host. Connect refuses to create the hybrid at all
  (`connectInstagramDirect` → `alreadyLinked`).
- **OAuth**: instagram.com dialog → code → short-lived (1h) → long-lived (60d) at
  graph.instagram.com. Follows Rule 17b: the app opens the instagram.com URL as
  the tab's FIRST document, the return leg SERVES A PAGE that navigates to the
  `/auth/app-sync` App Link (never a 302), and replay defence is single-use state
  in Redis (cookie jars don't cross app↔browser).
- **Host and token travel together.** Every Instagram Graph call takes an
  `InstagramCredential` (`services/instagramCredential.ts`) — `{accessToken,
  baseUrl, direct}` — rather than a bare token string, so a call site cannot hand
  an Instagram User token to graph.facebook.com. `resolveInstagramCredential` is
  the single decision point (Rule 19: no forked reply logic; adapters only).
  Endpoints are path-identical across the two hosts EXCEPT the messages edge:
  Instagram Login uses `POST /{ig-id}/messages`, page-linked keeps `/me/messages`
  (`instagramMessagesEndpoint`; verified against Meta's docs 2026-08-16).
- **Webhooks need a PER-ACCOUNT subscription.** The app-level `instagram`
  subscription only declares which fields the app may receive; each professional
  account must additionally install the app on itself —
  `POST graph.instagram.com/{ig-id}/subscribed_apps?subscribed_fields=messages,comments`,
  called at connect (`instagramLoginService.subscribeToWebhooks`). Without it the
  connect looks healthy and not one message arrives. A failed subscription is
  REPORTED, not assumed (the return page carries `igWarn=webhooks`) AND
  self-heals: the daily cron's `runWebhookResubscribeSweep` re-issues the
  idempotent install for every live Instagram-direct row, so a missed toast —
  or a Meta-side subscription drop — recovers within 24h without the merchant.
- **Token lifecycle**: 60-day clock like WhatsApp's, refreshed daily by
  `startInstagramTokenRefreshCron` → `runRefreshSweep` (10-day window, per-row
  failure isolation).
- ⛔ **Excluded from Facebook page-token recovery**, for the same reason WhatsApp
  is: there is no Facebook Page to re-mint from. Enforced at the choke point —
  `recoverPageToken` requires a `facebook_page_id` — and at
  `pageAutoPause.ownsFacebookCredential(platform, page)` on the DM send path.
  Without it an Instagram-direct send failure would run `/me/accounts` and mail
  the merchant "reconnect your Facebook page" to explain an Instagram outage.

- **Webhook Setup** (for incoming messages/comments):
  - Endpoint: `/webhook` (POST)
  - Verification: X-Hub-Signature-256 header (HMAC-SHA256)
  - Signature Key: `FACEBOOK_WEBHOOK_VERIFY_TOKEN` + `FACEBOOK_APP_SECRET`
  - Events Subscribed:
    - `messages` - incoming DMs to pages/Instagram
    - `messaging_postbacks` - button clicks
    - `feed` - post/comment activity — **active in Live mode** (was blocked in dev mode)
    - `message_deliveries` - delivery confirmation
    - `message_reads` - read receipts

- **Key Endpoints Used**:
  - `/me/accounts` - list connected pages (primary page discovery path)
  - `/debug_token` - verify token + extract `granular_scopes.target_ids` (the authorization truth; reconciled against `/me/accounts` on EVERY sync, not only when it comes back empty)
  - `/{page-id}?fields=id,name,access_token,category,about,phone,single_line_address,hours,website` - fetch individual page data for pages `/me/accounts` omitted (the `tasks` field is NOT requestable here — only on `/me/accounts`)
  - `/me/instagram_accounts` - list connected Instagram accounts
  - `/me/messages` with `recipient.comment_id` - send private reply to a comment (DM linked to the comment)
  - `/me/messages` with `recipient.id` - send DM to a user (requires prior conversation)
  - `/me/messages` with `message.attachment` (Generic Template) - send product card carousel as follow-up to text reply
  - `/{comment_id}/comments` - post a public reply to a comment
  - `/{post_id}?fields=message,story` - fetch post content (used for shared post context enrichment)

- **Rich Product Cards**: When an ecommerce tool returns a product reference (e.g. `check_inventory`), the reply pipeline sends a follow-up Generic Template carousel with the product image, price, and a `View product` button. Payload building (truncation, Meta limits, messaging_type) lives in `backend/src/services/metaMessaging.ts` and is shared by Messenger and Instagram. The card build/lookup lives in `backend/src/services/reply/productCardBuilder.ts`. Card send failures are logged but don't invalidate the text reply already delivered.

- **Page discovery is a UNION, not a fallback (2026-04-15, corrected 2026-08-09)**: Facebook's `/me/accounts` is NOT authoritative for what a user authorized. For Pages owned by a Meta Business Portfolio or on the New Pages Experience it can omit granted Pages — returning an empty array, or a **partial** list (the 2026-08-09 case: `granular_scopes` carried two page IDs while `/me/accounts` returned one, so the newly granted Page was invisible to every sync). `facebookService.getUserPages` therefore always diffs `/me/accounts` against `/debug_token` `granular_scopes` and fetches each omitted Page via `GET /{page-id}`, returning the union of both. The original "fall back only when `/me/accounts` is EMPTY" shape is what hid the partial case. Degradation is deliberate: a `/debug_token` failure with a non-empty primary list returns that list unchanged rather than throwing (the sync's revoke step reads a failed sync as "everything was revoked"). See `backend/src/services/facebook.ts:getUserPages` and the `getUserPages — Business Portfolio fallback` describe block in `backend/test/services/facebook.test.ts` (partial-omission union, no-op, both degradation paths, tokenless-page skip).

- **Reply Modes (Comments)**:
  - `public` - reply as a public comment
  - `private` - send DM via `recipient.comment_id` (fallback: public comment if DM fails)
  - `dual` - DM with full reply + public comment with short nudge. If DM fails, full reply posted as public comment

- **Per-Post Keyword Triggers** (ManyChat-style):
  - Merchants set trigger keywords + reply text per post (e.g. "comment . to get details")
  - When a comment matches a keyword, the trigger reply is sent immediately via `recipient.comment_id`, bypassing the AI pipeline
  - Keywords stored as comma-separated text in `posts.trigger_keyword` / `instagram_media.trigger_keyword`
  - Matching uses `matchesKeyword()` from `@jawab24/shared` with Arabic normalization
  - Sub-comments (`parent_id` set) skip the trigger path

- **Arming a Post Reply on a SCHEDULED post (Facebook only)** — see D-060:
  - The picker lists a page's pending posts from `GET /{page-id}/scheduled_posts` (`facebookService.getScheduledPosts`, fields `id,message,full_picture,scheduled_publish_time`) alongside the published `/posts` page, so a trigger can be configured before the post goes live. Scheduled items sort soonest-first at the top and carry `createdTime`/`commentsCount` as null; they are fetched only on the first picker page (a `nextCursor` "load more" pages the published edge only)
  - **Opt-in:** the scheduled edge is read only when the client sends `?includeScheduled=1` on `GET /pages/:id/published-posts`. The mobile app ships its own frontend bundle, so an older installed version would render a pending post as published-with-no-date and let the merchant arm it unaware
  - `PublishedPost.isScheduled` — not the presence of `scheduledPublishTime` — is what marks a post as pending: Graph can return a pending post with no `scheduled_publish_time`, and inferring "published" from the missing field would render it as live with no warning
  - `scheduled_publish_time` is a UNIX timestamp in SECONDS (Graph types it `float`); the service converts to ISO at the boundary. `getScheduledPosts` reports `failed` (Graph errored) and `truncated` (edge filled `SCHEDULED_POSTS_MAX` = 25); `listPublishedPosts` folds both into `partial` on the response and the picker states that the list is incomplete
  - On arm, `postsService.ensureContent` verifies the state server-side via `GET /{post-id}?fields=is_published,scheduled_publish_time` (`facebookService.getPostSchedule`, issued in parallel with the find-or-create) and records `posts.scheduled_publish_time`. The client is never trusted for this; Graph failing to answer means "unknown" and leaves the stored marker untouched (clearing it would disarm the tripwire below). Post ids reaching a Graph URL path are `encodeURIComponent`-ed, and `POST /posts/ensure` rejects an implausible `platformPostId` (`isPlausiblePlatformPostId`) at the boundary
  - The feed webhook (`item=post`, `verb=add`) reconciles markers via `postsService.onPostPublished`, run AFTER the batch's comments are enqueued so diagnostic work never sits in front of a reply. Instagram has no scheduled-media edge, so this is FB-only
  - **Known platform limitation (detection, not prevention)**: Facebook owns the post id, and a scheduled post is not guaranteed to publish under the id the picker armed. A marker still set `SCHEDULED_MARKER_GRACE_MS` (30 min) past its time is **re-checked against Graph** (bounded by `SCHEDULED_MARKER_RECHECK_MAX` = 5) before anything is claimed: published → the marker is healed (our publish webhook was missed), unknown → silence, still pending past its time → drift. Only that last case raises the Sentry warning (`post-reply-scheduled-id-drift`, fingerprinted per page) **and** sends the merchant a `post_reply_orphaned` notification — an orphaned trigger is indistinguishable from a working one in the UI, and only the merchant can re-arm it
  - **Unverified:** whether Facebook fires `item=post`/`verb=add` when a *scheduled* post publishes has not been confirmed against a live page. The Graph re-check makes a missed webhook self-healing, so this is not load-bearing for correctness — but the drift alarm's rate can't be read as a signal until the live run happens

- **Shared Post Handling (Messages)**:
  - When a customer DMs a shared post with no text → smart nudge acknowledging the post
  - When a customer DMs a shared post + text → post content fetched via Graph API and prepended to message for AI context
  - **Note**: shared-post handling reads only the CAPTION (`message,story`), not the post IMAGE — describing shared/own post images (cache-by-post-id) is a parked follow-up (see plan). Customers who *screenshot* a post and send it as a plain image ARE covered by image understanding below.

- **Customer Image Handling (Messages, FB/IG)**:
  - Customer sends a plain image → AI vision description (`imageUnderstanding.describeFromUrl`, gpt-4.1-mini) → fed into the normal reply pipeline (describe-then-enqueue, like voice transcription). Reads Arabic text / product / screenshot content so the bot can answer.
  - Gated by `IMAGE_UNDERSTANDING_ENABLED` env kill switch + per-plan daily cap (shared `lib/dailyCap`); default-on with no per-merchant toggle. Image bytes never stored (only the text description). On denial/failure → placeholder + text-only nudge.

- **Catalog Posts Scan (admin canary, reads page content)**:
  - `facebookService.getPagePosts(..., { fullImages: true })` extends the `/posts` Graph fields with `attachments{media_type,media{image{src}},subattachments.limit(20){media_type,media{image{src}}}}` — full-resolution album images (the `full_picture` preview alone garbles Arabic in Vision OCR; 07-11 smoke-test lesson)
  - Image downloads are restricted to Meta CDN hosts (`*.fbcdn.net`, `*.cdninstagram.com`), 5MB cap, 15s timeout; OCR'd via `extractFromImage` under the `catalog_extraction` cost pipeline
  - Bounded per scan: 25 newest posts, ≤10 Vision calls total, ≤4 images/post; 2/min route rate-limit + 10/day per-user cap (fail-closed)
  - Re-scan idempotence via `pages.catalog_scan_last_post_time` (bookmark only advances when extraction succeeded)

- **Configuration**:
  - `FACEBOOK_APP_ID` - App identifier (public)
  - `FACEBOOK_APP_SECRET` - OAuth secret (private)
  - `FACEBOOK_REDIRECT_URI` - OAuth callback URL
  - `FACEBOOK_WEBHOOK_VERIFY_TOKEN` - Webhook signature verification
  - `FACEBOOK_TOKEN_ENCRYPTION_KEY` - Token storage encryption
  - `FACEBOOK_GRAPH_API_VERSION` - API version (v18.0 default)

- **Implementation Location**:
  - Service: `/backend/src/services/facebook.ts`
  - Controller: `/backend/src/controllers/webhook.ts`
  - Routes: `/backend/src/routes/webhook.ts`

- **Data Deletion (GDPR, Platform Terms 3(d)(i))**:
  - Real-time callback: `POST /webhook/data-deletion` (signed_request, HMAC-verified). Handles BOTH
    requester types: end-customer rows purged via `services/gdprCustomerDeletion.ts`
    (`sender_id`/`from_id` across conversations→cascade messages, pauses, leads, FB/IG comments) and
    merchant login accounts via `authService.deleteUser` (users.facebook_id). Returns status URL
    (`/gdpr/deletion-status?code=…`) + confirmation code per Meta spec.
  - Callback URL must be registered in App Dashboard (Facebook Login settings) — registered 2026-07-11;
    while unregistered, Meta instead emails batch ID files, processed manually with
    `backend/src/scripts/gdpr-batch-delete.ts` (dry-run by default, same shared purge service; kept as fallback).
    Runs in prod as `node dist/scripts/gdpr-batch-delete.js` — it lived in `backend/scripts/` until
    2026-07-28, where `tsconfig` (rootDir `./src`) never compiled it, so it could not run there at all.

---

### WhatsApp Business (Meta Cloud API)
- **Purpose**: Auto-reply automation for WhatsApp DMs
- **Status**: LIVE (GA) — channel shipped #392 + follow-ups (#418/#420/#423/#424); Meta App Review cleared 2026-07-26, GA per `docs/WHATSAPP_LAUNCH_RUNBOOK.md` Phase 5. **Packaging: included on Business+ plans** (`whatsappEnabled` on business/pro/scale-20k/scale-30k; Starter excluded — enforced server-side at connect/toggle via 403 `WHATSAPP_PLAN_REQUIRED`, `controllers/whatsapp.ts`)
- **Business Model**: Tech Provider (ManyChat model) — merchant connects their own WhatsApp Business Account; Meta bills merchant directly for per-message costs (service-window replies are free; Jawab24 adds no markup)

- **Connection Flow (implemented — Embedded Signup, TWO transports behind a flag)**:
  - **Redirect flow (2026-07-30, flag `WHATSAPP_CONNECT_REDIRECT` + `NEXT_PUBLIC_WHATSAPP_CONNECT_REDIRECT`)**: full-page navigation, no popup — built because `fb.login`'s popup cannot run in the Capacitor WebView and never painted in mobile Chrome. Path answer → `POST /auth/whatsapp/start` (owner-only; runs allowlist/plan gates, mints an HMAC-signed state `utils/whatsappConnectState.ts` + nonce cookie, returns the `dialog/oauth?config_id&extras` URL) → whole page navigates to Meta's wizard (in the app: an in-app Custom Tab) → Meta 302s to public `GET /auth/whatsapp/callback` (`controllers/whatsappRedirect.ts`: verify state+nonce, re-verify ownership, exchange code WITH redirect_uri, discover assets from the token — `debugToken().wabaIds` → `listWabaPhoneNumbers()`, coexistence read from `platform_type` `SMB_APP`/`CLOUD_API`) → 302 back to `/pages?whatsappConnected=1&waPageId=…` or `?whatsappError=<code>`. Ambiguous multi-number discovery errors out (`WHATSAPP_AMBIGUOUS`) — never guessed, since `phone_number_id` is the webhook routing key. **In-app session bridge (OAuth-code shape)**: the native app's JWT lives under a different origin than jawab24.com, so before opening the browser the app calls `POST /auth/browser-handoff` (authenticated, rate-limited 10/min) to mint an **opaque single-use code** (256-bit, Redis `handoff:browser:{code}`, TTL 60 s) and opens `/auth/sync?code=…&redirect=/pages?connectWhatsApp=…`. The sync page trades the code at public `POST /auth/browser-handoff/exchange` (atomic MULTI GET+DEL — replay dead; rate-limited 20/min) for a **first-class login**: full-TTL access token + refresh cookie + auth cookies, so the browser session outlives Meta's wizard instead of expiring mid-flow. ⚠️ **Only for an UNSCOPED code.** A code minted by a restricted embedded session carries that session's `TokenScope`, and the exchange re-mints it scoped: `EMBEDDED_BREAKOUT_TOKEN_EXPIRY` (1 h), workspace-pinned, admin-stripped, **no refresh cookie** — and it CLEARS any refresh cookie already in the jar, since `/auth/refresh` rotates into an unscoped token and would launder the restriction away one step later. `/auth/whatsapp/app-start` refuses scoped codes outright (it signs in a full session and hands over workspace-level WABA credential material). Ruling **D-067**. Only the already-worthless-once-logged code ever rides a URL (browser history, nginx access logs) — never a session credential. The old `/login` wall (which hung on-device with Custom-Tab FB login, 2026-07-30) remains only as the fallback if minting fails. The exchange route is in `CSRF_EXEMPT_ROUTES`: `/auth/sync` calls it with raw axios (no `X-CSRF-Token`), so once the FIRST handoff has set auth cookies every later one 403'd — the single-use code is itself the anti-forgery credential, exactly like the OAuth-code/OTP routes. **The NATIVE leg mirrors the shipped Facebook page-connect flow, and must keep mirroring it (v2.0.20).** The app asks the onboarding-path question IN-APP (`WhatsAppPathModal`), mints via authenticated `POST /auth/whatsapp/start` with `nativeApp: true`, then `Browser.open()`s the returned dialog URL so **the browser tab's FIRST document is facebook.com** — exactly what `handleReconnectFacebook` in `pages.tsx` has always done. Meta returns to `GET /auth/whatsapp/callback`, which finishes the connect and 302s to the **`/auth/app-sync` App Link**; Android verifies it (assetlinks.json), reopens Jawab24 and closes the tab — again the Facebook flow's own return leg. No session token rides that link (the app never lost its session), so `_app.tsx` navigates a token-less bridge URL straight to its `redirect` intent.

> ⛔ **Never route the native tab through a jawab24.com page first.** Three variants that did — page-side `location.assign` in a Custom Tab (2026-07-30), the same in an intent-opened Chrome tab (2026-07-31), and a server 302 from `app-start` (2026-07-31) — all died silently on a real device while Facebook page connect kept working. The failing property was never the tab type, package visibility, or JS: **the tab must START at facebook.com**.

Two seams the native leg needs, both keyed off the `app` flag *inside the signed state* (a web state can never claim them): the nonce cookie cannot be paired (it lands in the app WebView's jar while the callback arrives in the browser's), so an app state is **single-use** instead — registered at mint, consumed at callback via the shared `lib/singleUseKey` helpers; and the callback returns via the App Link rather than a web page. Dropping the nonce *without* the single-use replacement would leave a state replayable for its full 30-minute TTL, and a replay attaches the **replayer's** WhatsApp number to the victim's workspace (the callback re-verifies the state's user, not the caller's) — a regression test pins that a WEB state with no cookie still fails.

Android manifest: `<queries>` must declare a `VIEW`+`https` intent (Android 11+ package visibility) or `AppLauncher.openUrl` sees no browser and `openInSystemBrowser` degrades to a Custom Tab; the fallback appends **`launchDegraded=1`** to the URL (a Custom Tab is otherwise indistinguishable from Chrome in server logs — same UA, same cookies) plus a Sentry `captureError`, and `release-android.sh` hard-gates the **merged** release manifest before any upload.

**Legacy (v2.0.19 clients only):** public `GET /auth/whatsapp/app-start?code=…` consumes a single-use browser-handoff code, signs the browser in, and serves a handoff page whose anchor carries the merchant to Meta. Kept only until v2.0.19 falls out of the install base; it shares its gate/mint core with `start` via `prepareStartUrls`.
  - **Popup flow (legacy, flag off)**: Owner clicks "Connect" on the WhatsApp row of a page card (`pages.tsx`) → FB JS SDK loaded on demand → Embedded Signup popup (`frontend/src/lib/whatsappSignup.ts`)
  - Popup resolves the one-time auth `code` (FB.login) + `phone_number_id`/`waba_id` (WA_EMBEDDED_SIGNUP message event, sessionInfoVersion 3)
  - `POST /pages/:id/connect-whatsapp` (owner-only): exchanges code → business token, subscribes app to the WABA, registers the phone for Cloud API (deterministic HMAC PIN), fetches display number, stores fields
  - **Plan gate (Business+)**: WhatsApp is a plan entitlement (`plans.whatsapp_enabled` — true on business/pro/scale, false on starter; trial rides on starter → excluded). Enforced in `controllers/whatsapp.ts` (`hasWhatsAppPlanAccess`, keyed on the workspace OWNER's subscription like `canEnablePage`) on `connect`, `connectNew` and the toggle's enable branch → 403 `{ code: 'WHATSAPP_PLAN_REQUIRED', requiredPlan: 'business' }`, after the canary allowlist and before any Meta call. Disconnect/disable are never gated; no retroactive disable on downgrade (matches the maxPages model). Frontend reads the entitlement via the shared `useSubscriptionUsage` hook (`['subscription-usage']` key, SSE-invalidated): non-entitled owners get an `UpgradeCTA` instead of Connect, the channel picker collapses to the FB dialog, and the dashboard nudge banner is suppressed
  - **Readiness gate (all channels)**: enabling auto-reply on a page the AI cannot ground a single answer from is refused → 409 `{ code: 'BUSINESS_INFO_REQUIRED' }`. `services/businessReadiness.ts` `businessInfoGate()` (returns the refusal or null, shaped like `pageGateError` so every toggle reads the same; a null/absent page skips the gate so the handler's own 404 owns it) passes the page if ANY source reaches the prompt — Business Info text, confirmed structured facts (BUSINESS_INFO block), descriptive FB fields (narrative block), a live store whose `getStoreContextForAI` returns content, or ≥1 catalog item — and each is tested by calling that source's own formatter rather than re-deriving "is this set?". Wired into all three toggles (`controllers/whatsapp.ts` after the plan gate, `controllers/pages.ts` and `controllers/instagram.ts` before the billing gates); DISABLE is never gated. Exists because a WhatsApp-only card is created with `knowledge_base = NULL` / `business_profile = NULL` (no FB page to seed from) and the client enabled auto-reply immediately after connect — the GA happy path put an ungrounded AI in front of real customers. ⚠️ NOT `isBusinessInfoProvided` (the `kb_filled` activation milestone, ≥80 chars AND ≠ the FB snapshot): measured on prod 2026-07-29, that predicate would refuse 14 of the 39 pages with auto-reply enabled, this one refuses 0. Client shows the reason and opens the Business Info editor; the predicate is deliberately NOT duplicated frontend-side (the server owns the verdict)
  - `DELETE /pages/:id/whatsapp` disconnects (local-only — no WABA unsubscribe, a WABA can serve multiple numbers); UI: owner-only unlink icon on the connected row → ConfirmationModal. `PATCH /pages/:id/whatsapp-auto-reply` toggles (admin+, plan gate + readiness gate + same billing/trial gates as FB/IG)
  - Mobile: the Capacitor WebView can't host the ES popup — Connect hands off to the system browser at the web dashboard (`openExternalUrl` + `buildWebUrl`); Meta's wizard works in mobile browsers
  - Discoverability: dismissible dashboard announcement nudge (env-gated on the same config vars, owner-only, hidden once any page has WhatsApp connected; `useTimedDismiss` key `whatsappNudgeDismissedAt`)
  - Requires env: `NEXT_PUBLIC_FB_APP_ID` + `NEXT_PUBLIC_WHATSAPP_CONFIG_ID` (ES configuration ID) — the Connect button only renders when both are set AND the plan includes WhatsApp (see plan gate above). Marketing surfaces (pricing plan cards, scale page, checkout summary) list WhatsApp — crossed-out on Starter — behind `isWhatsAppMarketable()` (env set AND `NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY` not 'true'), so they stay hidden during the founder canary and auto-appear at public launch
  - **WhatsApp-only cards** (shipped): `POST /pages/connect-whatsapp` (no :id, owner-only) CREATES a pages row with `facebookPageId=null` — card named after the WABA verified name, own Business Info + stats. Serves (a) merchants with no Facebook page (Shopify/Salla/Zid sellers — they still need a Facebook *personal* login for Meta's ES wizard) and (b) **multi-number**: one card per number. An enabled card consumes a page slot (existing `canEnablePage` gate). Removing a WA-only card = `DELETE /pages/:id`. After connect, the UI auto-attempts enable (billing gates keep authority; fails silently to OFF)
  - **Connect entry points** (one rule: global → new card, card → attach here): the Channels header has a single "Connect channel"/«ربط قناة» button opening `ChannelPickerModal` (Facebook Page vs "WhatsApp only"; WhatsApp option env-gated — without config the button collapses to the FB dialog directly). Options are **situation-framed** ("No Facebook Page? …") not channel-named, and the WhatsApp option sets expectations: the merchant chooses whether to keep the number on their phone or dedicate it to Jawab24, and a Facebook *sign-in* (not Page) is still required for Embedded Signup. Attaching WhatsApp to an existing page's Business Info stays contextual via that card's WhatsApp row
  - **Coexistence** (WhatsApp Business app user onboarding — merchant KEEPS the number on their phone): requested via `extras.featureType='whatsapp_business_app_onboarding'` (read verbatim from Meta's Embedded Signup Builder 2026-07-26; the Builder emits the snake_case URL param `feature_type`, the JS SDK extras key is camelCase). Completion arrives as its own event, `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`, alongside `FINISH`/`FINISH_ONLY_WABA`. The connect path **skips Cloud-API `registerPhoneNumber`** for these numbers — registering one would take it off the merchant's phone, the exact thing Coexistence prevents. Persisted as `pages.whatsapp_coexistence` (migration `0140`), set from the event Meta actually sent rather than what was requested (a merchant can switch paths inside the wizard). App-level webhook subscription is `messages,smb_message_echoes,history,smb_app_state_sync` — Meta requires all four for the flow to be valid. Only `smb_message_echoes` is acted on: each echo (a reply the merchant sent from their phone) becomes an `outgoing` + `replyMethod='manual'` row, which the already-shipped handoff pause reads to stand the AI down; `history` and `smb_app_state_sync` are accepted and DISCARDED (Meta pushes up to 180 days / thousands of messages — see D-045). Idempotency and the defensive self-send guard are a single lookup on the UNIQUE `messages.platform_message_id`, which carries the real `wamid` since #510. Meta documents that echoes exclude Cloud API messages, so our own replies are never echoed back. Requires WhatsApp Business app ≥ 2.24.17 on the merchant's device. **Which path to take is the merchant's answer to one plain question** — `WhatsAppPathModal` ("I already use this number on WhatsApp Business" vs "This number is only for Jawab24"), asked before Embedded Signup because Meta needs `featureType` at popup launch. Asked on a FIRST connect only: `requestConnectWhatsApp` routes a **reconnect** (`page.whatsappConnected === true`, i.e. the expired-token banner) straight through with the number's STORED `whatsappCoexistence`, since re-asking would let a different answer migrate a live coexistence number off the merchant's phone — pinned by two regression tests in `src/__tests__/pages/pages.test.tsx`
  - ⚠️ **Sanctions**: Meta bars businesses in Cuba, Iran, North Korea, **Syria** and three sanctioned Ukrainian regions from the WhatsApp Business Platform, AND bars users there from RECEIVING messages sent via it. Syrian merchants cannot connect WhatsApp at all, and Syrian customers of any merchant cannot receive AI replies. Libya is unrestricted
  - **Manual inbox replies** route per-platform: whatsapp branch in `controllers/messages.ts` `sendAndStoreManualReply` (WABA token, per-channel disconnect guard, Meta 131047 → `DM_WINDOW_EXPIRED`). `getPage`/`getPages` decrypt `whatsappAccessToken` alongside the FB token
  - **UI terminology**: the Pages screen + nav item are now "Channels" / «قنوات التواصل» (user-facing copy only; `/pages` route, i18n namespace, and code names unchanged — same precedent as Business Info vs `knowledgeBase`). Inbox rows render a solid brand-color channel badge (FB/IG/WA) on the avatar corner — only when the workspace has >1 channel connected (same rule as the comments page's `showPlatformIcon`) — plus a wa.me link for whatsapp conversations
  - Fully Facebook-free sign-in (no Meta account at all) deferred — phone auth is disabled; parked on WhatsApp-OTP (needs our live WABA) / Salla OAuth

- **Access Token**:
  - Embedded Signup business integration system-user token, stored in `pages.whatsapp_access_token` — separate from the Facebook page token
  - Encrypted at rest (AES-256-GCM `enc:v1:` scheme, same key as Facebook tokens)
  - The WhatsApp adapter carries this token in `PlatformPage.accessToken`; a missing token surfaces as `''` so sends fail instead of silently using the FB token

- **Incoming Media (implemented)**:
  - Voice notes: media ID → `GET /{media-id}` (bearer) → authorized download → Whisper `transcribeFromBuffer` → normal AI pipeline (`handleWhatsAppNonTextMessage` in `nonTextHandler.ts`)
  - Media captions, quick-reply buttons, interactive list/button replies → routed to the AI pipeline as text
  - Caption-less images: media ID → authorized download → AI vision description (`imageUnderstanding.describeFromBuffer`, gpt-4.1-mini) → normal AI pipeline, gated by env kill switch + per-plan daily cap. On denial/failure → placeholder + text-only nudge. (Captioned WhatsApp images still take the caption-as-text path — enriching those with vision is a noted follow-up.)
  - Caption-less video/document → stored placeholder + text-only nudge (1h cooldown); stickers stored silently
  - location/contacts/reaction/order → skipped (no reply path yet)

- **Webhook Setup**:
  - Same `/webhook` endpoint as Facebook/Instagram
  - `object: "whatsapp_business_account"` distinguishes WhatsApp payloads
  - Verification: X-Hub-Signature-256 HMAC-SHA256 (same as Facebook)
  - Events: `messages` field on WABA object

- **Key API Endpoints Used**:
  - `POST /{version}/{phone_number_id}/messages` — send text message (with `messaging_product: "whatsapp"`)
  - `POST /{version}/{phone_number_id}/messages` — mark as read + typing indicator (`status: "read"`, `message_id: wamid`, `typing_indicator: {type: "text"}` — one call does both; indicator clears on reply or after 25s)

- **Read receipts + typing**: sent fire-and-forget at **webhook receipt** (`processWhatsAppWebhookAsync`), not via the adapter's typing hook (which lacks the wamid). Blue ticks + "typing…" appear instantly while the reply-delay + AI window (~8s) runs. Gated on the page having `whatsappAutoReplyEnabled` + a token; typing suppressed for stickers (stored silently, no reply follows).

- **Constraints**:
  - 24h messaging window: free-form replies only allowed within 24h of last customer message
  - Template messages required outside window (Phase 4 — not yet implemented)
  - No sender profile API — display name comes from webhook `contacts[].profile.name` only (cached in DB)
  - Adapter `sendTypingIndicator` is a deliberate no-op (read+typing happen at webhook receipt, which has the wamid)

- **Message ID Format**: `wamid.xxx` (e.g., `wamid.HBgLMTkxMzExMTExMTEVAgASGBI...`)

- **Implementation Location**:
  - Cloud API client: `backend/src/services/whatsapp.ts`
  - Reply service: `backend/src/services/whatsappReply.ts`
  - Platform adapter: `backend/src/services/reply/adapters/whatsappAdapter.ts`
  - Webhook handler: `backend/src/controllers/webhook.ts` (WhatsApp branch)
  - Page lookup: `backend/src/services/pages.ts` (`getPageByWhatsAppPhoneNumberId`)

- **Schema**:
  - `pages.whatsapp_phone_number_id` — Cloud API phone number ID
  - `pages.whatsapp_business_account_id` — WABA ID
  - `pages.whatsapp_display_phone_number` — human-readable "+966 55..."
  - `pages.whatsapp_auto_reply_enabled` — per-channel toggle
  - `pages.whatsapp_access_token` — encrypted ES business token (migration 0125)
  - `messages.platform_message_id` — generic dedup column (wamid for WhatsApp, message ID for Facebook/Instagram)

- **Meta Submission Status**:
  - Must request Embedded Signup access (App Dashboard → WhatsApp → Embedded Signup) — ~3-5 business days
  - No App Review needed — only business verification + Standard Access required
  - After approval: create an ES configuration in the App Dashboard (Facebook Login for Business → Configurations) and set its ID as `NEXT_PUBLIC_WHATSAPP_CONFIG_ID`

---

## E-Commerce Platforms

### Cross-platform: webhook hardening (Shopify + Salla + Zid)

> Lifted to a shared, platform-agnostic layer in PR #27 (2026-05-07). Every
> e-commerce integration goes through the same code path for webhook
> registration, retry, exhaustion, and manual recovery. Adding a new
> platform = implementing the adapter contract; everything below applies for free.

- **Adapter contract** (`backend/src/integrations/registry.ts`):
  - `registerWebhooks(store): Promise<WebhookRegistrationResult>` — returns `{registered[], failed[], lastAttempt, exhausted?}`. Each adapter (`integrations/{shopify,salla,zid}.ts`) implements by delegating to its service module.
  - `getWebhookTopics(): readonly string[]` — source-of-truth topic list, asserted equal to the service constant by `backend/test/integrations/webhookTopicDrift.test.ts`.
  - `integrationRegistry.get(platform)` — lookup used by the worker + the shared reregister handler.

- **Shared install-path helper** (`backend/src/services/ecommerce.ts:registerWebhooksWithPersist`):
  - Awaits `adapter.registerWebhooks(store)`, persists the status JSONB, enqueues a retry job on partial or total failure.
  - Install never fails because of webhook hiccups — total failures persist a `{registered:[], failed:[{topic:'all',error}]}` marker so the integrations card can surface a Re-register CTA.
  - Save and queue failures emit Sentry events tagged `webhook-status-persist-failed` / `webhook-retry-enqueue-failed`.

- **Retry queue** (`backend/src/lib/webhookRetryQueue.ts`):
  - BullMQ queue `ecommerce-webhook-retry`, 3 attempts, exponential backoff (~30s, ~2min, ~8min).
  - Worker (`backend/src/workers/webhookRetryWorker.ts`) dispatches via `integrationRegistry.get(platform).registerWebhooks(store)` — no platform branching.
  - On exhaustion: persists `webhookStatus.exhausted = true`, emits Sentry event tagged `service: <platform>, stage: webhook-retry-exhausted`. Frontend integrations card renders a "Re-register webhooks" CTA.

- **Manual recovery endpoint**: `POST /:platform/store/webhooks/reregister`
  - Mounted under each platform's prefix; one shared handler in `backend/src/controllers/ecommerceWebhooks.ts:createReregisterHandler(platform)`.
  - Auth: `authenticate + resolveWorkspace + requireRole('admin')`.
  - Returns `{ ok, webhookStatus }` with the latest registration result. Frontend `ecommerceApi.reregisterWebhooks(platform)` wraps it.

- **Frontend recovery UI**:
  - `frontend/src/pages/integrations.tsx` — banner + "Try again" button driven entirely off `store.webhookHealth`. Renders for any platform whose `PlatformConfig.reregisterWebhooks` is set (all three today).
  - i18n keys `webhookHealth.{pendingTitle,pendingBody,failedTitle,failedBody,reregisterBtn,reregistering,reregisterSuccess,reregisterError}` are platform-neutral. EN + AR translations live in `frontend/src/i18n/{en,ar}/integrations.json`.

- **Tests**:
  - `backend/test/services/registerWebhooksWithPersist.test.ts` — 15 tests, table-driven over `[shopify, salla, zid]`: success, partial-failure, total-throw, queue-down, db-down resilience.
  - `backend/test/controllers/ecommerceWebhooks.test.ts` — 18 tests for the reregister handler.
  - `backend/test/workers/webhookRetryWorker.test.ts` — 12 tests for registry dispatch.
  - `backend/test/integrations/webhookTopicDrift.test.ts` — adapter topics match service constants.
  - `frontend/e2e/integrations.spec.ts` — 6 tests (`[shopify, salla, zid] × [en, ar]`) for the recovery UI banner + reregister round-trip.

---

### Shopify
- **Purpose**: Sync product catalog, enrich AI knowledge base with product details; App Store installs are BILLED through Shopify App Pricing (D-054)
- **Integration Type**: OAuth 2.0 + GraphQL Admin API
- **Billing (App Pricing, D-054)**: Shopify owns the money; no webhook exists for enrollments, so `services/shopifyBilling.ts → syncShopifyBilling(shopDomain)` mirrors `currentAppInstallation.activeSubscriptions` onto the workspace owner's `subscriptions` row (`payment_method='shopify'`, AppSubscription GID, `shopify_shop_domain`, migration 0147). Triggers: `GET /shopify/billing/return` (untrusted redirect → server-side verify), post-claim hook, 6-hourly `ShopifyBillingReconcile` cron (the sweep skips demo-seeded stores via `isDemoStore` — their placeholder tokens are not decryptable). Plan handles = plan slugs (`config/shopifyBilling.ts`, unknown → fail-loud Sentry). Uninstall webhook cancels the local mirror. Shopify-billed accounts are hard-blocked from Stripe surfaces (400 `SHOPIFY_BILLED`; top-up CTA hidden; deep link `admin.shopify.com/store/{store}/charges/{SHOPIFY_APP_HANDLE}/pricing_plans`). ⚠️ V3 caveat: whether `activeSubscriptions` reflects App Pricing is unverified until the dev-store dogfood (TEST_PLAN §O-0); the fork is isolated in `fetchShopifyActiveSubscription`.
- **OAuth Flow**:
  - User enters store domain (e.g., `shop.myshopify.com`)
  - Redirect to Shopify authorization endpoint
  - Request scopes: `read_products`, `read_content`, `read_orders`, `read_fulfillments`, `read_inventory`
  - Access token received (no expiration for offline tokens)
  - Token encrypted (AES-256-GCM) and stored in database

- **API**: GraphQL Admin API, `POST /admin/api/<version>/graphql.json`. Version pinned in `SHOPIFY_API_VERSION` (`services/shopify.ts`, currently **`2026-04`**; guarded by `test/services/shopifyApiVersion.test.ts` which fails ~60 days before sunset). Handles cost-based `THROTTLED` (HTTP 200 + `errors[].extensions.code`) with backoff, in addition to HTTP 429/5xx retries. Product fetch uses cursor pagination up to `PRODUCT_SAFETY_CAP`.

- **Webhook Integration**:
  - Endpoint: dedicated `/shopify/webhooks/{uninstall,products-update,orders,fulfillments}` per-event handlers
  - Events (8): `app/uninstalled`, `products/{create,update,delete}`, `orders/{create,fulfilled,cancelled}`, `fulfillments/update`. Delivery is detected via `fulfillments/update` (`fulfillment.shipment_status === 'delivered'`) — NOT `orders/updated`, whose order-level `fulfillment_status` never becomes `'delivered'`.
  - Verification: HMAC-SHA256 base64 signature in `X-Shopify-Hmac-SHA256` header
  - Signature Key: Shopify API secret
  - GDPR endpoints: `/gdpr/customers/{data_request,redact}`, `/gdpr/shop/redact` (mandatory for App Store)
  - Registration: Admin GraphQL API (`webhookSubscriptions` query + `webhookSubscriptionCreate`/`webhookSubscriptionUpdate`), list-then-upsert — a subscription whose callback URL drifted is updated in place. `webhookStatus`/`X-Shopify-Topic` keep REST-style topic names.
  - Source-of-truth topic list: `SHOPIFY_WEBHOOK_TOPIC_DEFS`/`SHOPIFY_WEBHOOK_EVENTS` in `services/shopify.ts` + `SHOPIFY_WEBHOOK_TOPICS` in `integrations/shopify.ts`; pinned in `test/integrations/webhookTopicDrift.test.ts`. New topics need `scripts/reregister-webhooks.ts shopify` for already-connected stores.

- **Background Worker**:
  - `ecommerceSyncWorker` - syncs products on interval
  - Triggers KB enrichment when changes detected
  - Location: `/backend/src/workers/ecommerceSyncWorker.ts`

- **Knowledge Base Enrichment**:
  - Fetches product list for page's linked store
  - Formats products as markdown (name, description, price, variants)
  - Appended to system prompt for reply generation
  - Caching: Cached in Redis to avoid repeated API calls

- **Configuration**:
  - `SHOPIFY_API_KEY` - OAuth app key
  - `SHOPIFY_API_SECRET` - OAuth secret
  - `SHOPIFY_HOST_NAME` - Redirect URL (production: jawab24.com, local: ngrok URL)
  - `SHOPIFY_TOKEN_ENCRYPTION_KEY` - Token encryption (AES-256-GCM)

- **Implementation Location**:
  - Integration: `/backend/src/integrations/shopify.ts`
  - Service: `/backend/src/services/shopify.ts`
  - Routes: `/backend/src/routes/shopify.ts`
  - Crypto (shared, all platforms): `/backend/src/services/ecommerceCrypto.ts`

- **DB Tables**:
  - `ecommerce_stores` - store info + encrypted tokens
  - `ecommerce_products` - product cache
  - Page ↔ store linking is the `pages.ecommerce_store_id` FK (there is no `ecommerce_store_pages` table)

---

### Salla
- **Purpose**: Sync product catalog, enrich AI knowledge base (Middle East e-commerce platform)
- **Integration Type**: OAuth 2.0 + REST API
- **OAuth Flow**:
  - No domain input (Salla authenticates the merchant directly)
  - Redirect to Salla authorization
  - Request scopes: `offline_access`, `products.read_write`, `settings.read` (verify against `config.salla.scopes`)
  - Access token (14 days) + refresh token (single-use; Redis distributed lock prevents concurrent-refresh races)

- **Authorization Modes** (Salla supports two; we implement BOTH):
  - **Custom Mode** (dev/testing): the standard OAuth redirect → `/salla/auth/callback` exchanges the code for tokens. Used locally.
  - **Easy Mode** (REQUIRED for published App Store apps): the callback is never hit. Salla pushes tokens server-to-server via the **`app.store.authorize`** webhook (`data: {access_token, refresh_token, expires (unix seconds), scope}`), and re-fires the same event to deliver refreshed tokens.
    - Handler: `controllers/salla.ts:handleStoreAuthorize` (HMAC-verified). Existing store (re-fire) → `updateStoreTokens` (idempotent). Fresh install → `fetchStoreInfo` for domain/name → `createPendingInstall` keyed by `merchantId` (7-day TTL) — no browser cookie exists.
    - **Easy Mode kills the OAuth authorize redirect** (proven live 2026-07-18, D-031): Salla drops the app's registered redirect URIs (no callback field in the portal), so `accounts.salla.sa/oauth2/auth` fails with `invalid_request … redirect_uri` for the published app. The Custom-Mode flow keeps working only for apps left in Custom Mode (dev).
    - **Claim**: the install is claimed after the merchant logs into Jawab24, via `GET /salla/store/pending?merchantId=` (scoped, non-secret summary) + `POST /salla/store/claim {pendingId|merchantId}` → `claimPendingInstall(ByMerchantId)` with an **owner-email ownership verifier** (D-031): the store's registered email is fetched live (`fetchStoreInfo` with the webhook-pushed token) and must equal the logged-in user's email (Facebook-OAuth-verified; normalized compare). `pendingId`/`merchantId` only select the row — never proof. Mismatch → 403 `email_mismatch` (store email never echoed); Salla-API failure → 502 `store_info_unavailable` (merchant remedy: "Reauthorize App" re-push); email-less (phone-OTP) account → 403 `no_email`. Frontend landing: `frontend/src/pages/salla/connected.tsx` (the portal "App URL") maps these codes to guidance toasts.
    - **Claim endpoints are FLAG-GATED** by `SALLA_EASY_MODE_CLAIM_ENABLED` (`config.salla.easyModeClaimEnabled`, default OFF → both return 404). Flip ON on submission day together with the portal Easy-Mode switch. Webhook ingestion (`handleStoreAuthorize`) is not gated (staging tokens is harmless without the claim path).
    - **Connect action is mode-aware**: `POST /salla/store/connect` returns the public App Store listing URL (`SALLA_APP_STORE_URL`, set at approval) instead of the OAuth authorize URL when the Easy-Mode flag is on — otherwise merchants would land on Salla's `invalid_request` error page. **Before the listing exists there is no third answer**: the portal app is already in Easy Mode (read 2026-08-20) while `SALLA_APP_STORE_URL` is still empty, so both destinations are dead. One predicate — `controllers/salla.ts:isConnectAvailable` — answers this for every entry point: `POST /store/connect` → **404 `SALLA_CONNECT_UNAVAILABLE`**, the PUBLIC `GET /salla/auth` redirect (which the UI's *reconnect* action targets) → bounced back to `/integrations?salla_error=connect_unavailable`, and `GET /salla/capabilities` → `{ connectAvailable: false }`, which is what the integrations page renders from. `SALLA_OAUTH_CONNECT_ENABLED=true` opts a Custom-Mode dev app back in. All of it reverts when the listing goes live.
    - Schema: `pending_ecommerce_installs.merchant_id` + `store_name` (migration `0123`).

- **API Endpoints Used** (base `https://api.salla.dev/admin/v2`):
  - `/products` - list products
  - `/orders` - order data (list shape differs from detail — see `mapSallaOrderToOrderInfo`)
  - `/store/info` - store info (used by `fetchStoreInfo`, incl. the Easy-Mode ownership check)

- **Billing — Article 5 (Salla-managed billing is MANDATORY for paid apps)**:
  - Salla apps-policy Article 5 requires paid-app payment to run "عبر منصة سلة". Steering a Salla-sourced merchant to Stripe risks delisting, and unpublishing a live Salla app is **not self-serve** (it needs a booked meeting with Salla), so the downside is unrecoverable.
  - Jawab24 launches on Salla **free-tier-only**, which is compliant — but the product's normal upgrade CTAs led to Stripe. That leak is closed by the **Article-5 guard**.
  - Rule (`services/sallaBilling.ts:mustBillThroughSalla`, ruling **D-065**): an account must bill through Salla when it has an **active Salla store** *and* no established live Stripe relationship. The exemption predicate is `config/sallaBilling.ts:hasLiveStripeBilling` (`payment_method='stripe'` AND status ∈ `LIVE_SUBSCRIPTION_STATUSES`) — a merchant who paid us through Stripe before connecting Salla was never a Salla-sourced sale and keeps their rail.
  - ⚠️ The payment-method half of that predicate is load-bearing: a fresh signup is `status='trialing'` with `payment_method` NULL, so exempting on status alone would exempt **every** user and the guard would never fire.
  - Store presence is resolved against the **billing subject** — the workspace owner (the D-E rule Shopify already follows) — by `services/ecommerce.ts:hasActiveStoreForBillingSubject`, deliberately NOT per-viewed-workspace, so the UI cannot offer an upgrade the API then refuses.
  - Enforcement: all six **merchant-facing** Stripe entry points via `rejectIfMarketplaceBilled` in `controllers/payment.ts` → **400 `SALLA_BILLED`** (logged at `info` with `rail: 'salla'`). Shopify's `SHOPIFY_BILLED` is evaluated first and unchanged; when both rails apply, Shopify wins (it has a manage-plan deep link, Salla has nowhere to send them yet).
  - ⚠️ **NOT covered:** `services/admin/billing.ts:createPaymentRequest` mints a hosted Stripe Checkout link and consults neither marketplace rule (pre-existing; Shopify/D-G is equally unguarded there). Admin-only and deliberate, so documented rather than blocked — owner decision owed.
  - UI suppression is driven from the single choke point `getUsageSummary` → `subscription.marketplaceBilling` (D-073; the Salla-only `subscription.sallaBilled` is still emitted for older bundled app builds but is no longer read by the web frontend): plan select (`useSelectPlan`), pricing banner, top-up CTA, all via `frontend/src/lib/marketplaceBilling.ts`. The `/pricing` bounce in `checkout.tsx` is code-based rather than field-based — it tests the refusal code with `isMarketplaceBilledCode` from `@jawab24/shared`, because that surface can be reached with a stale link before any summary is consulted.
  - ❌ **Salla billing itself is NOT IMPLEMENTED.** When it lands (a `'salla'` subscription source driven by `app.subscription.*` webhooks), the suppression becomes a redirect to Salla's plan management and `hasLiveStripeBilling` is replaced by an `isSallaBilled(row)` that reads the subscription, exactly like Shopify's.

- **Webhook Integration**:
  - Endpoint: `/salla/webhooks` (POST) — single endpoint, dispatched by `event` field in body
  - Events (11): `product.{created,deleted,price.updated,status.updated,quantity.low}`, `app.uninstalled`, `order.{created,updated,status.updated,shipment.created}`, `abandoned.cart`. Salla has NO `order.completed` and NO `order.shipping.update`: completion/delivery is a status VALUE inside `order.status.updated` (`data.customized.slug` ∈ {shipped,delivered,completed}); tracking arrives via `order.shipment.created` (payload `data` is the shipment: `ship_to.phone` + top-level `tracking_number`).
  - Verification: HMAC-SHA256 hex signature in `X-Salla-Signature` header (timing-safe compare)
  - Source-of-truth topic list: `SALLA_WEBHOOK_EVENTS` in `services/salla.ts`
  - No GDPR endpoints required (Salla policy)

- **Configuration**:
  - `SALLA_CLIENT_ID` - OAuth app ID
  - `SALLA_CLIENT_SECRET` - OAuth secret
  - `SALLA_HOST_NAME` - Redirect URL
  - `SALLA_WEBHOOK_SECRET` - Webhook signature key

- **Implementation Location**:
  - Integration: `/backend/src/integrations/salla.ts`
  - Service: `/backend/src/services/salla.ts`
  - Routes: `/backend/src/routes/salla.ts`

---

### Zid
- **Status**: 🔧 **Rebuilt against the verified API contract (2026-08-01) — pending live dev-store validation, NOT user-facing.** The original implementation was built on an assumed contract and never round-tripped a real store (D-020); the rebuild replaced the auth/endpoint/webhook layer with the contract verified from docs.zid.sa. It ships dark (`ZID_CLIENT_ID` unset in prod; `coming_soon` badge on the integrations page) until a real dev-store round-trip passes — D-020's gate stands. Contract, provisional parsers, and the validation checklist: [`docs/integrations/zid.md`](../../docs/integrations/zid.md). Rulings: D-020 (gate), D-053 (rebuild).
- **Purpose**: Saudi Arabia e-commerce platform — product sync + KB enrichment + AI agent tools
- **Auth Flow**: OAuth2 redirect (same shape as Salla), but the token response carries **two credentials**: `access_token` (sent as `X-Manager-Token`) + `Authorization` (sent as `Authorization: Bearer`) — both required on every Merchant API call, both AES-256-GCM encrypted (`ecommerce_stores.authorization_token`/`_iv`, migration `0146`). Token lifetime ~1 year; shared refresher (`ecommerceTokenRefresh.ts`) parses a rotated `Authorization` field when present.
- **Webhooks**: registered per store via `POST /v1/managers/webhooks` (body carries `original_id` = `ZID_APP_ID` + a Basic-auth username/password pair); deliveries are verified by **timing-safe HTTP Basic auth** (`utils/basicAuthVerify.ts`) — Zid sends no HMAC signature. Events: `product.create/update/publish/delete`, `order.create`, `order.status.update` (`indelivery`→shipped, `delivered`→delivered). Uninstall arrives as the Partner-Dashboard-configured `app.market.application.uninstall`.
- **Direct merchant access (Embedded Apps)** — added 2026-08-11 after Zid rejected app 7367 for *"OAuth does not yet meet our required standards … Direct merchant access (no sign-in prompt)"*. A platform-initiated install used to create a pending install and redirect to `/login`, so the reviewer met a login wall. Now: the callback **auto-provisions the merchant account** from the Zid store profile (refused when the email already exists — a store email is attacker-settable, so it is not identity proof; a workspace is **guaranteed** for the new account, since the merchant has no login to self-heal one later), registers a UUID with `POST /v1/managers/embedded-apps-token` (only its SHA-256 is stored, `ecommerce_stores.embedded_token_hash`, migration `0159`; idle-expiring via `embedded_token_last_used_at`, migration `0160`), and hands the merchant to `dashboard.zid.sa/…/embedded`. Zid then frames `https://jawab24.com/zid/embedded?token=<uuid>`, which trades the UUID at `POST /zid/embedded/session` (`backend/src/services/embeddedSession.ts`, platform-agnostic) for a **workspace-scoped, admin-stripped** short-lived access token (`TokenScope`; enforced by `resolveWorkspace` + `requireAdmin`). The entry page strips the credential from the URL immediately; nginx logs the path-only for `/zid/embedded` and Sentry redacts `?token=`. Inside the frame the session rides a **Bearer token in `sessionStorage`**, with an in-memory fallback when a partitioned frame blocks storage (`frontend/src/lib/embeddedSession.ts`) — `SameSite=strict` cookies never reach a third-party frame, so cookie auth and `/auth/refresh` cannot work there. Revoked at Zid and locally on uninstall AND on merchant disconnect (and `embeddedTokenHash` is blanked whenever a store goes inactive). ⚠️ **Shared-infra**: `nginx.conf` drops `X-Frame-Options` in favour of CSP `frame-ancestors 'self' dashboard.zid.sa web.zid.sa` (the `*.zid.dev` sandbox is NOT allowed in the production config), asserted by `npm run check:nginx-routing`. **Breaking OUT of the frame** (connecting a Facebook page — facebook.com refuses framing) keeps the restriction: `lib/embeddedBreakout.ts` mints a handoff code and lands the new tab on `/auth/sync`, so it arrives signed in rather than on a login wall an auto-provisioned merchant cannot pass. The scope is preserved at EVERY re-mint site reachable from that tab, not just the exchange — `middleware/auth.ts#callerScope` is the single reader, and `/auth/facebook/link` (the break-out's own destination) re-mints scoped, syncs pages into the PINNED workspace rather than `workspaces[0]`, and returns only that workspace. `GET /workspaces` is filtered to the pinned one. The Zid post-install browser fallback (`controllers/zid.ts`, used when no in-dashboard entry is available) mints a SCOPED code for the same reason the frame's session is scoped: an install proves the store, never the person. Rulings: **D-066**, **D-067**.
- **Scopes**: the authorize URL sends only `embedded_apps_tokens_write` (the sole scope Zid documents for that parameter); data permissions come from the app's dashboard scope matrix. The previous four names were invented and never existed. `Subscription.read` is enabled in the matrix for the billing rail below.
- **Billing (App Market subscriptions)** — added 2026-08-11, **D-070**. Zid owns the money: a merchant who installs from the App Market picks one of our plans inside Zid and pays there. **Verify-first, like Shopify D-054 and unlike this section's earlier plan**: Zid documents `GET /v1/market/app/subscription` (dual-header auth + `app_id`, gated on `Subscription.read`), so that API is the authority and `app.market.subscription.*` deliveries are only TRIGGERS — they carry no state into the database, they call the one idempotent choke point `syncZidBilling(storeId)`. Three triggers: the subscription webhook, the uninstall webhook (cancels the mirror — no paid local sub outlives the app), and the 6-hourly `ZidBillingReconcile` cron, which is the authority of last resort and makes a missed delivery a ≤6h delay rather than a lost subscription. The mirror lands on `subscriptions` with `payment_method='zid'` and `zid_store_id` (migration `0161`: partial unique index over live rows + CHECK), keyed on OUR store UUID because every trigger already holds it; the billing subject is the **workspace owner** (shared `resolveBillingSubjectUserId`, also used by the Shopify rail). A `zid` entry in `LAZY_EXPIRY_CANARIES` fires when both the webhook AND the sweep missed. **Two fail-loud gates**: an unmapped plan (`unknown_plan`) and an unrecognised `subscription_status` (`unknown_status`) both write NOTHING and raise Sentry — an unfamiliar status is explicitly NOT read as "inactive", because pausing a merchant Zid is actively billing would be a self-inflicted outage. `plan_name` returns in **Arabic**, so the map keys on the dashboard plan id first (3740 «الأعمال» → `business`, 3741 «الاحترافي» → `pro`) and falls back to the Arabic name folded through the shared `normalizeArabic`; Starter is unsellable on marketplaces (**D-071**, `ecommerceEnabled=false`) and pricing is grossed up for Zid's commission + VAT (**D-072**, provisional). ⚠️ **Nothing on this rail has been round-tripped against a live store** — `EC3` (a Rejected app cannot be installed) blocks it until app 7367 is resubmitted, so the envelope is inferred from docs, read tolerantly, and marked `[provisional]`. Coverage: `backend/test/services/zidBilling.test.ts` (40 cases over `ZID_TEST_PLAN` §H) + webhook wiring in `backend/test/controllers/zid.test.ts`.
- **Configuration**:
  - `ZID_CLIENT_ID` - OAuth app ID
  - `ZID_CLIENT_SECRET` - OAuth secret
  - `ZID_APP_ID` - Partner Application ID (webhook subscriptions' `original_id`; also the `app_id` on the subscription read; prod-required with the client id)
  - `ZID_HOST_NAME` - App hostname for redirect URI
  - `ZID_WEBHOOK_SECRET` - Basic-auth password for webhook deliveries (username fixed in code)
  - `ZID_APP_MARKET_URL` - where a Zid merchant manages their subscription. **Deliberately unset**: the URL shape is undocumented and unobserved, and a guessed link would send payers to a 404. Unset = suppress Stripe but show no link (never "do not suppress").
- **Implementation**:
  - Integration: `/backend/src/integrations/zid.ts`
  - Service: `/backend/src/services/zid.ts`
  - Controller: `/backend/src/controllers/zid.ts`
  - Routes: `/backend/src/routes/zid.ts`
  - Basic-auth verify: `/backend/src/utils/basicAuthVerify.ts`
  - Billing rail: `/backend/src/services/zidBilling.ts` + `/backend/src/config/zidBilling.ts`
  - Marketplace guard (all three rails): `/backend/src/services/marketplaceBilling.ts`
- **AI Agent Tools** (shared, platform-agnostic — same 5 as Shopify/Salla): `lookup_order`, `track_shipment`, `check_inventory`, `verify_and_get_order`, `verify_and_get_shipment` (whitelist in `packages/shared/src/ecommerce-tools.ts`, executed via `ecommerceActions.ts`)

---

### E-Commerce Analytics (merchant-facing)

Read-only aggregator that surfaces merchant ROI for a connected store across all e-commerce platforms (Shopify, Salla, Zid). No new tables — reads from `customerNotificationsLog` + `messages`.

- **Endpoint**: `GET /api/ecommerce-analytics/:storeId?range=30d|90d` (auth + workspace-scoped via `resolveWorkspace`)
- **Implementation**:
  - Service: `/backend/src/services/ecommerceAnalytics.ts`
  - Controller: `/backend/src/controllers/ecommerceAnalytics.ts`
  - Routes: `/backend/src/routes/ecommerceAnalytics.ts` (registered with prefix `/api/ecommerce-analytics`)
- **Frontend**:
  - Page: `/frontend/src/pages/ecommerce-analytics.tsx`
  - Reusable primitives + sections: `/frontend/src/components/analytics/`
  - Embedded widget: `StoreAnalyticsSummary` slot inside `ConnectedStoreCard` on the integrations page
- **Returns**: notification funnel `{ total, byChannel }` (channel-keyed for WhatsApp/DM future), per-type breakdown, recovery stats (approximate phone-window match), reply method breakdown
- **Attribution caveat**: cart-recovery revenue uses an EXISTS subquery matching `abandoned_cart` notifications to `order_confirmed` notifications by phone within a 72h window. Over-credits when a customer would have ordered anyway. Phase 6 (URL wrapping) tightens this with click-through telemetry — see `ECOMMERCE_POWER_FEATURES_PLAN.md`.

---

### KB File Upload

Text extraction from documents and images for KB content:

- **Endpoint**: `POST /kb/extract-text` (`backend/src/routes/kb-upload.ts`)
- **Extractor**: `backend/src/services/kb/file-extractor.ts`
- **Formats**: PDF (pdf-parse v2), Word/docx (mammoth), images (GPT-4o-mini Vision)
- **Limits**: 5MB file, 5 PDF pages, 16K char output
- **Plan gating**: PDF/Word free for all; images/scanned PDFs require Business+ plan
- **Daily quota**: Business 10/day, Pro 25/day (Redis counter `vision_extract:{userId}:{date}`)
- **Frontend**: `FileUploadButton.tsx` (paperclip icon next to mic in KB sections + onboarding)

### KB Voice Input

Voice-to-text for KB content via microphone:

- **Endpoint**: `POST /voice/transcribe` (`backend/src/routes/voice.ts`)
- **Service**: `backend/src/services/transcription.ts`
- **Model**: gpt-4o-mini-transcribe (89% fewer hallucinations vs whisper-1)
- **Frontend**: `VoiceRecordButton.tsx` (mic icon in KB sections + onboarding)

---

## AI/LLM Services

### OpenAI (Primary LLM)
- **Purpose**: Generate smart replies to customer messages
- **Model**: gpt-4.1-mini (fixed for cost efficiency, not user-configurable)
- **SDK**: OpenAI SDK 6.27.0 (pinned exact version)
- **API Key**: `OPENAI_API_KEY`
- **Usage Pattern**:
  - System prompt with reply style, e-commerce context, and KB
  - User message from customer
  - Structured JSON response: `{ confidence, intent, reply, flags }`
  - Temperature: 0.3 (consistent, less random)
  - Max tokens: 300

- **Response Format**: Strict JSON schema (GPT enforced)
  ```json
  {
    "confidence": "high|medium|low",
    "intent": "QUESTION|COMPLIMENT|COMPLAINT|PURCHASE_INTENT|GREETING|BUSINESS_INQUIRY|OFFENSIVE|SPAM_OR_IRRELEVANT",
    "reply": "...",
    "flags": { "angry_customer": false, "needs_escalation": false }
  }
  ```
  Source of truth: `ai-worker/src/services/openai.ts` (enum) + `ai-worker/src/services/providers/types.ts`

- **Caching**:
  - Semantic cache: Skip generation for similar requests
  - Exact cache: Full response memoization for identical requests
  - Cache key includes: KB version, reply style, customer context
  - Scoped by workspace + page

- **Error Handling**:
  - Circuit breaker: Stop calls after 5 consecutive failures (30s cool-off) — Redis-backed (`lib/circuitBreaker.ts`)
  - **Fallback chain** (3 tiers):
    1. **Tier 1 (normal)**: OpenAI via ai-worker
    2. **Tier 2 (circuit open)**: Claude Haiku via ai-worker `/generate?model=claude-haiku-*` — bypasses circuit, different API key
    3. **Tier 3 (both fail)**: Static "Thank you for your comment!" reply + lightweight keyword classifier (`classifyFallback()`) for intent/confidence
  - Fallback model configurable via `AI_FALLBACK_MODEL` env (default: `claude-haiku-4-5-20251001`)
  - Timeout: 30 seconds per request

- **Configuration**:
  - Shared between backend (embeddings) and ai-worker (replies)
  - Both must use same version (sync checked by `npm run check:openai-sync`)

- **Implementation Location**:
  - AI Worker: `/ai-worker/src/services/providers/openai-adapter.ts`
  - Backend KB: `/backend/src/services/kb/embedding.ts`

---

### OpenAI Organization Costs API (billing observability)
- **Purpose**: Reconcile what OpenAI actually bills the org against our per-call `ai_usage_log`, and power the admin AI Cost & Quota panel (`/admin/ai-cost`)
- **Endpoint**: `GET https://api.openai.com/v1/organization/costs` — `bucket_width=1d`, `group_by` project_id/line_item/api_key_id. Gotchas: `amount.value` is a high-precision **string** (parseFloat + NaN-guard); paginate `has_more`/`next_page`; unix timestamps → **UTC** day
- **API Key**: `OPENAI_ADMIN_API_KEY` — an **admin** key (`sk-admin-…`, read-only org scope; a project key cannot read `/v1/organization/*`). Never sent to the frontend; `Authorization` stripped from any captured error. `OPENAI_PROD_KEY_ID` / `OPENAI_EVAL_KEY_ID` label the prod-vs-eval spend split (both keys drain one wallet, so runway uses the **org total**, never prod-only)
- **Sync**: daily backend cron `runOpenAiCostSync(trailingDays=3)` (re-fetches a trailing window so late OpenAI adjustments overwrite; no-ops if the admin key is absent) → idempotent upsert into `ai_cost_snapshots`. A single-row `ai_credit_balance` holds the admin-entered balance anchor
- **Alerts**: `aiCostMonitor.ts` fires throttled admin email + Sentry on credit-low (`alert:openai_credit_low`) and spend-spike (`alert:openai_spend_spike`); OpenAI auto-recharge is the primary protection, these are the backstop
- **Implementation**: `backend/src/services/openaiCosts.ts` (fetch/paginate/parse), `aiCostSnapshots.ts` (upsert + `getBilling` + `getReconciliation`), `aiCostMonitor.ts` (runway + alerts), `aiCostSync.ts` (cron entry), shared helpers in `aiCostShared.ts`

---

### Anthropic (Claude - Tier-2 Failover / Playground)
- **Purpose**: Tier-2 failover LLM when OpenAI circuit breaker opens, plus playground testing
- **SDK**: Anthropic SDK 0.78.0
- **Models Available**: `claude-haiku-4-5-20251001` (default failover), `claude-sonnet-4-20250514` (configurable)
- **API Key**: `ANTHROPIC_API_KEY` (required for failover; optional for playground-only use)
- **Usage Pattern**:
  - **Failover (production)**: When `aiWorkerCircuit` opens (5 consecutive OpenAI failures), backend calls ai-worker `/generate?model=claude-haiku-*` directly (bypassing circuit). Uses `AI_FALLBACK_MODEL` env to select model.
  - **Playground**: Admins can compare model outputs side-by-side
  - Same JSON schema response format as OpenAI; `provider_failover` flag added to response

- **Configuration**:
  - `ANTHROPIC_API_KEY` - Claude API key (optional)

- **Implementation Location**:
  - Adapter: `/ai-worker/src/services/providers/claude-adapter.ts`
  - Provider Registry: `/ai-worker/src/services/providers/index.ts`

---

## Payment Processing

### Stripe
- **Purpose**: Subscription billing, checkout, invoicing
- **Integration Type**: REST API + Webhooks
- **SDK**: Stripe 14.11.0
- **API Key**: `STRIPE_SECRET_KEY` (private), `STRIPE_PUBLISHABLE_KEY` (frontend)

- **Checkout Flows** (two paths):
  1. **Embedded Checkout** (primary for new subscriptions):
     - Backend creates checkout session via `POST /payment/create-checkout-session`
     - Returns `clientSecret` for Stripe Embedded Checkout component in frontend
     - Frontend renders inline Stripe Embedded Checkout (no redirect to Stripe-hosted page)
     - Supports monthly billing; yearly only per plan where `plans.stripe_yearly_price_id` is set — the resolver (`backend/src/utils/stripePrice.ts`) refuses `billingInterval=year` with 400 `YEARLY_NOT_AVAILABLE` instead of falling back to the monthly price, and the frontend offers the yearly toggle only when a plan reports `yearlyAvailable`. Yearly Stripe prices are created by `backend/src/scripts/create-yearly-prices.ts` (dry-run by default)
     - After completion, frontend polls `GET /payment/checkout-session/:sessionId` for status
  2. **PaymentElement** (subscription creation path):
     - `POST /payment/create-subscription` → returns `clientSecret` for PaymentElement
  3. **In-app plan change** (proration):
     - `POST /payment/change-plan` → calls `stripe.subscriptions.update` with `proration_behavior: 'create_prorations'`. Used when the customer already has an active Stripe-backed subscription. Customers without an externalSubscriptionId fall through to the checkout flow.
  4. **In-app cancellation**:
     - `POST /payment/cancel-subscription` → `stripe.subscriptions.update(id, { cancel_at_period_end: true })`. Subscription stays active until period end.
  5. **Billing Portal** (locked-down: invoice history + payment methods):
     - `POST /payment/billing-portal` opens the portal. When `STRIPE_BILLING_PORTAL_CONFIG_ID` is set, plan changes and cancellations are disabled in the portal — those flows go through the app so DB stays in sync.
     - Sanctions check applied before portal creation
  6. Webhook at `POST /payment/webhook` receives `checkout.session.completed` → subscription record created

  6b. **Hidden high-volume plans** (`plans.is_public = false`):
     - `getActivePlans()` (the public `GET /plans` grid) filters `is_active AND is_public`, so plans flagged `is_public: false` never appear on `/pricing`. The single-plan lookup (`GET /plans/:slug`) and `changePlan`/checkout do NOT filter, so a hidden plan stays purchasable by slug/ID via a direct link.
     - Used for the **Scale** plans (`scale-20k` $149/mo·20k replies, `scale-30k` $199/mo·30k replies, seeded from `config/plans.ts`). Surfaced only to Pro/Scale customers at their reply limit via the `AiUsageWarningBanner` nudge and the discreet `/pricing` link, both pointing to the hidden `/pricing/scale` page. Existing Pro subscribers upgrade in place via `POST /payment/change-plan` (proration); the higher quota applies immediately since it's read live from the plan. Stripe recurring Price IDs for the Scale plans must be set manually per env (the seed never touches `stripe_price_id`).

  7. **Admin "collect payment" link** (hidden, admin-only — `feat/admin-collect-payment`):
     - `POST /admin/users/:userId/payment-request` (behind `requireAdmin`) creates a HOSTED Stripe Checkout Session (`mode: 'payment'`, custom inline `price_data` amount, metadata `type: 'manual_payment'`) and returns its `url` for the admin to send to the customer. Backed by `paymentRequestService` + the `payment_requests` table.
     - **Collect-only**: paying it marks the `payment_requests` row `paid` (via the same `checkout.session.completed` webhook, routed by `metadata.type` BEFORE the subscription path) and **never** touches `users.topup_balance` — it bills for replies credited separately by hand. Optional `topupPurchaseId` links a request to the grant it collects for ("granted but unpaid" reporting).
     - Reconciliation backstop: a 15-min sweep (`paymentRequestService.reconcilePending`, wired in `index.ts`) re-queries Stripe for aged `pending` rows so a missed webhook still settles the ledger. Independent of the self-service top-up engine.

- **Webhook Events**:
  - `checkout.session.completed` - subscription started, OR (when `metadata.type === 'manual_payment'`) marks an admin collect-payment request `paid`
  - `customer.subscription.created` - safety net for race with checkout
  - `customer.subscription.updated` - plan changed (also writes new `planId` resolved from `priceId`)
  - `customer.subscription.deleted` - canceled
  - `invoice.payment_succeeded` - payment confirmed (resets quota, invalidates status cache)
  - `invoice.payment_failed` - payment failed
  - `charge.refunded` - logs refund and notifies the customer (does not cancel the subscription)
  - All handlers invalidate the Redis `sub:active:<userId>` cache so a status change is visible to the reply pipeline immediately, not after the 60s TTL.

- **API-version resilience** (fixed #334): the SDK is pinned to `apiVersion: '2023-10-16'` (governs only *outbound* calls), but the webhook endpoint renders payloads at the Dashboard-configured version (`2025-12-15.clover`), where two fields moved: `invoice.subscription` → `invoice.parent.subscription_details.subscription`, and `subscription.current_period_*` → `subscription.items.data[].current_period_*`. `backend/src/utils/stripeCompat.ts` (`getInvoiceSubscriptionId` / `getSubscriptionPeriod`) reads BOTH paths (`legacy ?? new`), so renewals sync regardless of which version serializes. Reading only the legacy path silently null'd on renewal → the period never advanced and paid subs flipped to `past_due`. If the SDK `apiVersion` is ever bumped, align it with the endpoint version and re-test (the compat layer keeps that from being urgent).

- **Stripe's payload is TRANSLATED, never mirrored verbatim** (`backend/src/config/stripeBilling.ts`, 2026-08-18). Two rules, both enforced in `handleSubscriptionUpdated`:
  - **`current_period_*` is mirrored only when the status is PAID** (`active` / `trialing` — `isPaidStripeStatus`). Our column means **paid through**; that is how the entitlement gate, its 3-day grace and the dunning emails all read it. Stripe's means "the period being invoiced", and a `past_due` subscription "continues to create invoices" — so mirroring it advances the boundary into a month nobody paid for. That handed one merchant a free month AND a fresh monthly quota (`getCurrentUsage` matches a usage row only while `periodStart <= now <= periodEnd`, so an advanced period reopens the counter at zero).
  - **The status is mapped into our five-value union** (`mapStripeSubscriptionStatus`). Stripe has eight; `unpaid`, `incomplete` and `incomplete_expired` are not among ours, and `checkSubscriptionStatus` blocks only `canceled`/`paused` — so an unmapped value falls through to `allowed: true` **permanently**, with no CHECK constraint on the column to stop it landing. `unpaid → past_due` (blocked by the expired grace, and still selected by the `service_suspended` sweep, which keys on `past_due`); `incomplete_expired → canceled`; `incomplete` and any unrecognised future status write **no** status at all and log (unknown also reports to Sentry).
  - Recovery is unaffected — `handlePaymentSucceeded` re-reads the subscription from Stripe, mirrors the then-current period and resets the usage window.
  - ⚠️ The Dashboard's failed-payment setting still matters: at retry exhaustion, **`cancel` is the safe choice**. `unpaid` is now handled correctly, but *"leave as `past_due`"* means Stripe keeps advancing its own period forever — harmless to entitlement since we no longer mirror it, but the invoices accumulate.

- **Verification**:
  - Signature via `X-Stripe-Signature` header
  - HMAC-SHA256 with `STRIPE_WEBHOOK_SECRET`
  - Endpoint secret: webhook_secret_from_dashboard

- **Sanctions Check**:
  - **CRITICAL**: Before creating checkout session, verify user geolocation
  - Blocked regions: Cuba, Iran, North Korea, Syria, Crimea, etc.
  - Check performed in `/backend/src/controllers/payment.ts` before Stripe API call
  - Returns 403 if sanctioned jurisdiction detected

- **Subscription Management**:
  - Plans stored in DB: `plans` table
  - Subscriptions: `subscriptions` table
  - Trial periods: Configurable per plan (0 for no trial)
  - Renewal: Automatic on Stripe (every 30 days, annually, etc.)
  - Cancellation: Handled via subscription.canceled webhook

- **Configuration**:
  - `STRIPE_SECRET_KEY` - API secret key
  - `STRIPE_PUBLISHABLE_KEY` - Frontend key
  - `STRIPE_WEBHOOK_SECRET` - Webhook endpoint secret

- **Implementation Location**:
  - Service: `/backend/src/services/stripe.ts`
  - Controller: `/backend/src/controllers/payment.ts`
  - Routes: `/backend/src/routes/payment.ts`
  - Webhook entry: `/backend/src/controllers/payment.ts` (`handleWebhook` — signature verification, idempotency, completed/processing status transitions)
  - Webhook event processing: `/backend/src/controllers/paymentWebhookHandlers.ts` (`dispatchStripeEvent` + per-event handlers)

---

## Infrastructure Services

### PostgreSQL Database
- **Purpose**: Primary data store for users, pages, messages, settings, analytics
- **Version**: 15 with pgvector extension
- **Connection**: Native postgres driver (not pg)
- **Connection String**: `postgresql://user:pass@host:5432/jawab24`
- **Configuration**:
  - Migrations auto-run on Docker startup
  - Health check: `pg_isready` command

- **Key Tables**:
  - `users` - user accounts
  - `workspaces` - team workspaces
  - `pages` - Facebook/Instagram pages
  - `messages` - incoming messages
  - `comments` - post comments
  - `templates` - user-created reply templates
  - `subscriptions` - stripe subscriptions
  - `ecommerce_stores` - Shopify/Salla integration
  - `ecommerce_products` - product cache
  - `kb_documents` - knowledge base documents
  - `kb_embeddings` - vector embeddings (pgvector)

- **Backup**: Via Docker volume `postgres-data` (production: managed by DevOps)

---

### Redis Cache
- **Purpose**: Session storage, job queue (BullMQ), rate limiting, caching
- **Version**: 7-alpine
- **Port**: 6379
- **Configuration**:
  - `REDIS_HOST` - hostname
  - `REDIS_PORT` - port
  - `REDIS_PASSWORD` - auth password (required in production)
  - `maxmemory: 256mb` - memory limit
  - `maxmemory-policy: noeviction` - don't evict on overflow
  - `appendonly: yes` - persistence enabled

- **Uses**:
  - **Sessions**: JWT + user context (short-lived TTL)
  - **Job Queue (BullMQ)**:
    - `ai:pending` - AI reply generation jobs
    - `comments:pending` - comment reply jobs
    - `messages:pending` - message reply jobs
  - **Rate Limiting**: Per-IP request counters
  - **Semantic Cache**: AI response caching (by KB + style)
  - **KB Enrichment Cache**: Product data from e-commerce

- **Persistence**: RDB (dump.rdb) via `appendonly yes`
- **Cleanup**: Automatic via worker intervals (expired installs, etc.)

- **Implementation Location**:
  - Client: `/backend/src/lib/redis.ts`
  - Queue Manager: `/backend/src/lib/replyQueue.ts`
  - BullMQ Setup: Throughout `/backend/src/workers/`

---

### Firebase Cloud Messaging
- **Purpose**: Push notifications to mobile app
- **SDK**: Firebase Admin SDK 13.6.1
- **Authentication**: Service account JSON (from Firebase Console)
- **API Key**: Stored securely in environment (path to JSON file)

- **Notification Types**:
  - Angry customer detected
  - Low confidence reply (requires manual review)
  - New message in thread
  - Subscription reminder

- **Configuration**:
  - Service account JSON file (Firebase Console → Service Accounts)
  - Project ID from Firebase config

- **Implementation Location**:
  - Service: `/backend/src/services/notifications.ts`
  - Triggers: Throughout message/comment processing logic

---

## Authentication & Token Management

### JWT (JSON Web Tokens)
- **Purpose**: Stateless authentication for API requests
- **Algorithm**: HMAC-SHA256 (custom implementation, RFC 7519 compliant)
- **Secret**: `JWT_SECRET` (minimum 32 chars)
- **Access token expiry**: 15 minutes
- **Refresh token expiry**: 60 days (database-stored, rotated on use)
- **Payload**: `{ userId, isAdmin, exp }` — exp is Unix timestamp in **seconds** per RFC 7519
- **Storage (Web)**: HttpOnly + Secure + SameSite:strict cookies (no localStorage)
- **Storage (Mobile)**: Bearer token in Capacitor secure storage

- **Implementation Location**:
  - Issuer: `/backend/src/services/auth.ts`
  - Middleware: `/backend/src/middleware/auth.ts`
  - Cookies: `/backend/src/services/cookies.ts`
  - Refresh: `/backend/src/services/refreshToken.ts`

---

### Phone OTP Authentication
- **Purpose**: Primary login method — universal identity not tied to any platform
- **Flow**: Phone (E.164) → 6-digit OTP via SMS → bcrypt verify → JWT + refresh token
- **OTP storage**: `otpCodes` table — bcrypt-hashed, 5-min expiry, max 3 attempts
- **Rate limiting**: 1 OTP per phone per 60s (store-level) + 3 requests/10min (route-level)
- **Timing attack protection**: dummy bcrypt compare when no OTP record exists
- **Feature flag**: `PHONE_AUTH_ENABLED=true` — routes hidden until flag is on
- **SMS delivery**: Vonage SMS API (see Vonage SMS below)
- **Phone linking**: `POST /auth/phone/link` (authenticated) — links phone to existing Facebook users

- **Implementation Location**:
  - OTP lifecycle: `/backend/src/services/otp.ts`
  - Controller: `/backend/src/controllers/auth.ts` (`requestOtp`, `verifyOtp`, `linkPhone`)
  - Routes: `/backend/src/routes/auth.ts`
  - Frontend components: `/frontend/src/components/auth/PhoneInput.tsx`, `OtpInput.tsx`
  - Frontend pages: `/frontend/src/pages/login.tsx`, `/frontend/src/pages/auth/phone-collect.tsx`

---

### Facebook OAuth 2.0
- **Purpose**: User signup/login via Facebook
- **Flow**:
  1. Frontend opens Facebook Login dialog
  2. User approves scopes
  3. Frontend receives code + receives userID via Facebook SDK
  4. Frontend sends code to backend `/auth/facebook`
  5. Backend exchanges code for access token
  6. Backend verifies token authenticity (app_id check)
  7. Backend issues JWT
  8. Frontend stores JWT in secure storage

- **Scopes Requested** (via OAuth):
  - `pages_messaging` - send/read DMs ✅ approved
  - `pages_manage_metadata` - webhook subscription ✅ approved
  - `pages_show_list` - list pages ✅ approved
  - `pages_read_engagement` - read comments 🔄 pending submission
  - `pages_manage_engagement` - reply to comments 🔄 pending submission
  - `instagram_basic` - Instagram access ⏳ deferred
  - `instagram_manage_comments` - reply to IG comments ⏳ deferred
  - `instagram_manage_messages` - Instagram DMs ⏳ deferred

- **Token Verification**:
  - Debug endpoint: `/debug_token` (Graph API)
  - Check `is_valid`, `app_id`, `user_id`, `expires_at`, `scopes`
  - Error if token issued to different app (security check)

- **Encryption**:
  - Access tokens encrypted AES-256-GCM before storage
  - Encryption key: `FACEBOOK_TOKEN_ENCRYPTION_KEY`
  - IV stored alongside ciphertext

- **Implementation Location**:
  - Service: `/backend/src/services/facebook.ts`
  - Controller: `/backend/src/controllers/auth.ts`
  - Routes: `/backend/src/routes/auth.ts`

---

### Vonage SMS
- **Purpose**: OTP delivery for phone authentication + e-commerce order notifications
- **API**: Vonage SMS REST API (`https://rest.nexmo.com/sms/json`)
- **Credentials**: `VONAGE_API_KEY`, `VONAGE_API_SECRET`, `VONAGE_SENDER_ID`
- **Coverage**: 200+ countries including Syria (+963), Saudi Arabia (+966), Turkey (+90), Sweden (+46)
- **Development**: console.log only (no real SMS sent)
- **Production**: live Vonage delivery — keys required

- **Implementation Location**: `/backend/src/services/sms.ts`
- **Env vars**:
  - `VONAGE_API_KEY` — from Vonage API Settings
  - `VONAGE_API_SECRET` — from Vonage API Settings
  - `VONAGE_SENDER_ID` — alphanumeric sender name (default: `Jawab24`)

### E-commerce Order Notifications
- **Purpose**: Automated SMS to customers for order lifecycle events (confirmed, shipped, delivered, abandoned cart, review request)
- **Platforms**: Salla, Shopify, Zid — driven by existing webhook handlers
- **Queue**: BullMQ `customer-notifications` queue, concurrency 10, rate limit 50/min, exponential backoff (3 retries)
- **Deduplication**: `platformEventId` = `${platform}:${type}:${orderId}` — prevents double-sends on webhook retries
- **Language detection**: Arabic country prefixes (+966 SA, +971 AE, +965 KW, etc.) → Arabic template; otherwise English
- **Templates**: Per-store, per-type, opt-in (`is_enabled=false` default) — seeded on store connect
- **Schema**: `customer_notification_templates`, `customer_notifications_log`
- **PII retention**: `customer_notifications_log` holds customer phone + name. `cleanupCustomerNotificationLogs` (`utils/cleanup.ts`, 90-day window) hard-deletes old rows for ACTIVE stores; `purgeStore` cascades on full store deletion. On uninstall/disconnect, `deactivateStore`/`disconnectStore` blank the store's encrypted OAuth tokens immediately (not left until the 30-day purge).
- **Implementation**:
  - `/backend/src/services/customerNotifications.ts` — core service
  - `/backend/src/services/orderNotificationScheduler.ts` — shared dispatcher across platforms
  - `/backend/src/workers/customerNotificationWorker.ts` — BullMQ worker
  - `/backend/src/lib/customerNotificationQueue.ts` — queue definition
  - `/backend/src/controllers/customerNotifications.ts` + `/backend/src/routes/customerNotifications.ts` — REST API

---

## Error Tracking & Monitoring

### Sentry
- **Purpose**: Real-time error tracking, performance monitoring, session replay
- **SDK**: @sentry/node (backend/ai-worker), @sentry/nextjs (frontend)
- **DSN**: Environment-specific (production, staging, development)
- **Performance Monitoring**:
  - Transaction sampling rate (configurable)
  - Traces: AI generation duration, API response time, DB queries
  - Profiling: CPU/memory usage

- **Error Context**:
  - Request ID propagation (X-Request-ID header)
  - User ID (from JWT)
  - Workspace ID
  - Custom tags: page, action, integration

- **Configuration**:
  - `SENTRY_DSN` - Data source name (connection string)
  - Environment: inferred from NODE_ENV
  - Release: Git commit hash (from Docker build)

- **Implementation Location**:
  - Frontend: `/frontend/sentry.client.config.ts`, `/frontend/sentry.server.config.ts`
  - Backend: `/backend/src/lib/sentry.ts`
  - AI Worker: `/ai-worker/src/lib/sentry.ts`
  - Helper: `/backend/src/utils/sentryHelpers.ts` (error capture function)

---

## Analytics & Ad Attribution

### Google Analytics 4 — Measurement Protocol (server-side conversions)
- **Purpose**: report the conversions Google Ads bids on. The browser tag
  (`gtag('config', …)` in `frontend/src/pages/_app.tsx`) fires **page views
  only** — no events. Ads cannot bid on a page view, which is why every
  conversion action in the Ads account read tracking status **Inactive**.
- **What is mirrored**:
  | GA4 event | Source | Notes |
  |-----------|--------|-------|
  | `sign_up` | `recordActivationEvent('signup')` | GA4 *recommended* name — the only milestone renamed |
  | `page_connected` | `recordActivationEvent` | the real activation moment |
  | `kb_filled` | `recordActivationEvent` | |
  | `autoreply_enabled` | `recordActivationEvent` | |
  | `first_autoreply_sent` | `recordActivationEvent` | strongest "became a customer" signal |
  | `no_fb_pages`, `ig_direct_interest` | `recordActivationEvent` | demand signals, not funnel steps |
  | `purchase` (+ `value`, `currency`) | Stripe `checkout.session.completed` **or** `invoice.payment_succeeded` | the money event — see **Two paths to the money** below |
- **⭐ Two paths to the money, and for most merchants it is the second one.**
  Starter is the only plan carrying `trialDays: 30` and it is `isDefault: true`,
  and `controllers/payment.ts` grants that trial to anyone with no prior
  subscription — i.e. every new signup. So:
  - **no trial** → Stripe charges at checkout → `checkout.session.completed`
    reports the purchase.
  - **trialed (the normal case)** → the checkout completes at **$0**, hits the
    amount guard and reports nothing; the first real charge arrives ~30 days
    later as `invoice.payment_succeeded`, which reports it. Every renewal after
    that fires the same event and must NOT report.

  ⛔ Hooking only the checkout — the state until 2026-08-20 — meant an
  ad-acquired merchant could never produce a `purchase` conversion at all
  (measured that day: 79 of 85 production subscriptions carried a
  `trial_ends_at`). A `billing_reason` test would not have separated the first
  post-trial charge from a renewal either: both are `subscription_cycle`.
- **Idempotency**: the activation mirror fires only when
  `INSERT … ON CONFLICT DO NOTHING RETURNING id` returns a row, so GA4 receives
  each milestone exactly once per user — `first_autoreply_sent` re-emits on
  every reply and must not re-convert.

  `purchase` is made exactly-once by **`subscriptions.ga4_purchase_reported_at`**:
  whichever of the two paths sees money first claims it with
  `UPDATE … WHERE external_subscription_id = ? AND ga4_purchase_reported_at IS
  NULL RETURNING user_id`, and every later caller resolves `already_reported`.
  A renewal is not an acquisition and must never be reported as one.
  `transaction_id` (the checkout session id, or the invoice id) remains GA4's own
  dedup key but is now the SECOND line of defence: it absorbs a webhook retried
  minutes later, and nothing documents GA4 de-duplicating against a transaction
  it last saw a month ago.
- **⛔ The ordering that is load-bearing**: the amount guard runs BEFORE the
  claim. A $0 trial checkout must not consume the stamp, or the real payment 30
  days later finds it taken and is suppressed forever — reintroducing the exact
  bug the invoice hook removes. Pinned by
  `test/integration/ga4PurchaseClaim.test.ts` (real Postgres, incl. the
  concurrent-delivery election) and `payment.lifecycle.test.ts` STEP 5b/5c.
- **⚠️ Claim-then-send, stated rather than papered over**: if the MP call fails
  after the claim, that conversion is lost — the stamp is not released. Chosen
  deliberately. A double-reported purchase corrupts bidding; a dropped beacon
  costs one signal, and this module is fire-and-forget by contract.
- **⚠️ Attribution window**: a 30-day trial puts the paid conversion ~30 days
  after the click, at or beyond Google Ads' default click-through window. Report
  it for revenue visibility, but expect `sign_up` — which fires immediately — to
  be the event Smart Bidding can actually use.
- **Attribution**: MP requires a `client_id` — the `_ga` cookie's
  `<random>.<timestamp>` tail — to tie a server event back to the browser session
  that carried the `gclid`. Without it an event still lands in GA4 but Ads cannot
  credit a keyword: it **counts but does not optimise**. Stored on
  `users.ga_client_id`, **first-touch** (written only while NULL, so a later login
  from another browser cannot repoint the conversion).
- **Capture path**: `POST /auth/analytics-client-id` (authenticated), called once
  per session by `useGaClientIdSync` from `DashboardLayout`. A separate call
  rather than a login field because the tag is `strategy="lazyOnload"` (a
  first-paint decision), so the cookie often does not exist yet at login.
- **⛔ The trap**: `/mp/collect` returns **204 for a malformed event** exactly as
  for a good one. A 2xx proves transport, never recording. The only validator is
  `/debug/mp/collect` — run `npm run verify:ga4 -- <ga_client_id>` from
  `backend/`.
- **Failure posture**: fire-and-forget everywhere. Missing credentials or a
  missing client id no-op without a network call; transport failures are Sentry
  **warnings**, never errors. An analytics beacon must never fail a signup, a
  page connect, a reply, or a Stripe webhook.
- **Configuration**:
  - `GA4_MEASUREMENT_ID` — the same `G-XXXXXXXX` the browser uses (`NEXT_PUBLIC_GA_ID`)
  - `GA4_API_SECRET` — GA4 Admin → Data Streams → Measurement Protocol API secrets
    (write-only: sends events, cannot read reports)
  - Both empty ⇒ integration disabled (the correct local-dev setting)
- **Implementation Location**:
  - `/backend/src/services/ga4.ts` (MP client, purchase conversion, first-touch write)
  - `/backend/src/services/activation.ts` (the milestone mirror)
  - `/backend/src/controllers/paymentWebhookHandlers.ts` (`purchase`)
  - `/backend/scripts/verify-ga4.ts` (`npm run verify:ga4`)
  - `/backend/test/integration/ga4PurchaseClaim.test.ts` (the exactly-once claim, real Postgres)
  - `/frontend/src/utils/analytics.ts`, `/frontend/src/hooks/useGaClientIdSync.ts`
- **Still owed after deploy**: mark the events as **key events** in GA4, then
  import them into Google Ads as conversions. Do not switch bidding away from
  Maximize clicks until ~30 conversions/month accumulate.

---

## Integration Map

| Service | Purpose | Config Location | Status |
|---------|---------|-----------------|--------|
| Facebook Graph API | OAuth + webhooks for messages | `FACEBOOK_*` env vars | ✅ Production |
| Instagram API | Comments + DM auto-replies | `FACEBOOK_*` env vars | ⚠️ Code ready, permissions deferred |
| Shopify | Product sync + KB enrichment | `SHOPIFY_*` env vars | ✅ Production |
| Salla | Product sync (Middle East) | `SALLA_*` env vars | ✅ Production |
| Zid | Product sync + KB enrichment (Saudi) | `ZID_*` env vars | 🔧 Rebuilt — pending live dev-store validation, not user-facing (see `docs/integrations/zid.md`, D-020/D-053) |
| OpenAI | Smart reply generation | `OPENAI_API_KEY` | ✅ Production |
| Anthropic Claude | Tier-2 failover LLM + playground | `ANTHROPIC_API_KEY` | ✅ Active (circuit-open failover) |
| Stripe | Subscription payments | `STRIPE_*` env vars | ✅ Production |
| Firebase | Push notifications | Service account JSON | ✅ Production |
| PostgreSQL | Primary database | `DATABASE_URL` | ✅ Production |
| Redis | Cache + job queue | `REDIS_*` env vars | ✅ Production |
| Sentry | Error tracking | `SENTRY_DSN` | ✅ Production |
| GA4 Measurement Protocol | Server-side conversions for Google Ads | `GA4_MEASUREMENT_ID`, `GA4_API_SECRET` | ⚠️ Code ready, credentials not yet set in prod |
| Geoip-lite | User geolocation (fallback when CDN header missing) | (npm package) | ✅ Production (Tier 2 fallback after Cloudflare) |

---

## Webhook Security

### Signature Verification Strategy
All webhooks use HMAC-SHA256 signature verification:

1. **Facebook/Instagram Webhooks**:
   - Header: `X-Hub-Signature-256`
   - Format: `sha256=<hex>`
   - Secret: `FACEBOOK_APP_SECRET`
   - Timing-safe comparison to prevent timing attacks

2. **Shopify Webhooks**:
   - Header: `X-Shopify-Hmac-SHA256`
   - Format: Base64-encoded
   - Secret: `SHOPIFY_API_SECRET`

3. **Salla Webhooks**:
   - Header: `X-Salla-Signature`
   - Format: Hex-encoded
   - Secret: `SALLA_WEBHOOK_SECRET`

4. **Stripe Webhooks**:
   - Header: `X-Stripe-Signature`
   - Format: `t=timestamp,v1=signature`
   - Secret: `STRIPE_WEBHOOK_SECRET`

### Implementation
- Raw body preserved for signature verification (via Fastify custom JSON parser)
- Timing-safe buffer comparison (prevents timing-based attacks)
- Replay attack prevention: Check event timestamps against request time
- Rate limiting: Per-IP + per-event rate limits

---

## Rate Limiting & Throttling

- **Framework**: @fastify/rate-limit
- **Per-IP Limit**: 100 requests per 15 minutes
- **AI Endpoint**: Special tier (higher limit to avoid user throttling)
- **Webhook Endpoints**: No limit (trusted sources with signature verification)
- **Redis Backend**: Rate limit counters stored in Redis

---

## Data Encryption

### In Transit
- **HTTPS**: All external APIs use HTTPS (enforced)
- **TLS 1.3**: Minimum for production

### At Rest
- **Token Storage (Facebook, Shopify)**:
  - Algorithm: AES-256-GCM (Galois/Counter Mode)
  - IV: Random 16 bytes, stored with ciphertext
  - Auth Tag: Appended to ciphertext for integrity verification
  - Key derivation: SHA-256 hash of environment key (32 bytes)

- **Secure Storage (Mobile)**:
  - Capacitor secure storage plugin
  - Uses native keychain (iOS) and KeyStore (Android)
  - Automatic OS-level encryption

---

## API Rate Limiting (External Services)

| Service | Limit | Window | Strategy |
|---------|-------|--------|----------|
| Facebook Graph | 200 calls/hour (per token) | Rolling | Cached requests, batch where possible |
| Shopify REST API | 40 req/sec (leaky bucket) | Sliding | BullMQ job queue with concurrency control |
| Salla | 100 req/min | Rolling | Exponential backoff on 429 |
| OpenAI | 500k tokens/min | Rolling | Handled by SDK, errors trigger fallback |
| Stripe | 100 req/sec | Sliding | Automatic retry with jitter |

---

### Resend Email Service
- **Purpose**: Transactional emails — waitlist notifications, subscription welcome, **trial-ending reminders**, lead digests, account notices, and **team invites**. Email kinds are the `EmailType` union in `email.ts`: `lead_digest | waitlist | transactional | subscription_welcome | trial_ending | invite | account_notice`.
- **Team invites**: `workspaceInviteService.createInvite()` sends the invite via email (for email contacts) or SMS (for phone contacts). The invite email is **bilingual** (Arabic + English in one message, since the recipient's language is unknown) and links to `/invites/accept?token=…`. If the email send fails, the API returns the raw token so the UI can fall back to a copy-and-share link. Template: `inviteEmailTemplate()` in `emailTemplates.ts`.
- **API**: Resend REST API (`https://api.resend.com/emails`) via native `fetch` (no SDK)
- **From**: `info@jawab24.com` (configurable via `RESEND_FROM_EMAIL` / `RESEND_FROM_NAME`)
- **Reply-To**: `RESEND_REPLY_TO` when set, otherwise the key is omitted from the request and Resend defaults to the From address. The same resolved address is printed in the shared footer, so what a merchant reads and where a reply lands cannot diverge.
- **Multipart**: every send carries a `text/plain` alternative alongside the HTML, derived from the HTML by `htmlToPlainText()` unless the caller passes its own `text`. HTML-only mail reads as a bulk signal to spam filters.
- **Graceful degradation**: In development, logs email payload without sending. If `RESEND_API_KEY` is not set, returns error without crashing.

- **Configuration**:
  - `RESEND_API_KEY` — Resend API key
  - `RESEND_FROM_EMAIL` — Sender email (default: `info@jawab24.com`)
  - `RESEND_FROM_NAME` — Sender name (default: `Jawab24`)
  - `RESEND_REPLY_TO` — Optional. Reply-To header and the footer's printed address
  - `EMAIL_ASSET_ORIGIN` — Optional. Origin for images embedded in email (default: `https://jawab24.com`). Deliberately not `FRONTEND_URL`: an email outlives the environment that sent it, so a message opened next month must still resolve its logo.

- **Implementation Location**:
  - Service: `/backend/src/services/email.ts` (singleton `emailService`)
  - Templates: `/backend/src/utils/emailTemplates.ts`
  - Tests: `/backend/test/services/email.test.ts`, `/backend/test/utils/emailTemplates.test.ts`

---

## Search / AI Engine Discovery

### IndexNow (Bing / Copilot / ChatGPT Search / Yandex)
- **Purpose**: Instantly notify IndexNow-participating engines (Bing, Microsoft Copilot, ChatGPT Search, Yandex) of the public URL set after a deploy, so new/updated pages are crawled without waiting for organic discovery. Google does not consume IndexNow (it reads the sitemap), so this complements — not replaces — sitemap submission.
- **API**: `POST https://api.indexnow.org/indexnow` with `{ host, key, keyLocation, urlList }` (native `fetch`, no SDK).
- **Key verification**: The key is served as plain text at `https://jawab24.com/<key>.txt` via a rewrite in `frontend/next.config.js` that routes `/<token>.txt` → API route `/api/indexnow-key`, which validates the token against the **runtime** `INDEXNOW_KEY` env and 404s otherwise. Validating at runtime (not build time) means rotating the key needs no rebuild. The key is public by design but sourced from env (not committed).
- **Trigger**: Non-blocking step at the end of `scripts/deploy-production.sh` (after a successful deploy) submits every `<loc>` URL from the live sitemap. Skipped when `INDEXNOW_KEY` is unset; never fails the deploy.
- **Configuration**:
  - `INDEXNOW_KEY` — required in the frontend **runtime** env (for the key file) and in the deploy env (for the ping). Public value; not a secret.
- **Implementation Location**:
  - Key file route: `/frontend/src/pages/api/indexnow-key.ts` + rewrite in `/frontend/next.config.js`
  - Ping script: `/scripts/indexnow-ping.ts`
  - Tests: `/frontend/test/pages/api/indexnow-key.test.ts`

---

## Integration Testing

- **E2E Test Commands**:
  - Shopify: `npm run test:ecommerce:shopify` (requires running backend + demo store)
  - Salla: `npm run test:ecommerce:salla` (requires running backend + store)
  - Both: `npm run test:ecommerce` (tests both platforms)

- **Location**: `/scripts/ecommerce-integration-test.ts`
- **Coverage**: Store connect, sync, products, KB enrichment, page linking

---

## Environment Validation

- **Function**: `/backend/src/utils/env.ts` - `validateEnv()`
- **Timing**: Runs on backend startup
- **Checks**:
  - Required variables present (JWT_SECRET, DATABASE_URL, etc.)
  - Variable formats valid (URLs, API keys, encryption keys)
  - Mutual dependencies (if using Shopify, must have SHOPIFY_API_KEY + SECRET)
  - Fails hard if validation fails (process.exit(1))

---

## Google Play Publishing (Android Release)

- **Purpose**: Automated upload of signed Android App Bundles (AAB) to Google Play.
- **Tooling**: Gradle Play Publisher (`com.github.triplet.gradle:play-publisher:3.13.0`, pinned for AGP 8.13 — 4.x requires AGP 9). Classpath in `frontend/android/build.gradle`; `play{}` block in `frontend/android/app/build.gradle`.
- **Entry point**: `scripts/release-android.sh` (local-first) / `/release-android` skill. Optional dispatch-only CI: `.github/workflows/android-release.yml`.
- **Play package**: `com.jawab24.android` (differs from the iOS/Capacitor appId `com.jawab24.app`).
- **Auth**: service account `play-publisher@jawab24-play-publisher.iam.gserviceaccount.com` (in a personal `aliahdab@gmail.com` Cloud project — deliberately NOT the telavox.se org). Credential via `ANDROID_PUBLISHER_CREDENTIALS` env (raw JSON) or local key file `frontend/android/play-service-account.json` (untracked). Scoped to **testing tracks only** — production is promoted manually in the Play Console.
- **Signing**: upload keystore `frontend/android/jawab24-upload.jks` (alias `jawab24`) + passwords in `frontend/android/local.properties` (both untracked). Play App Signing holds the real signing key.
- **Versioning**: `versionName` from `--version`/`--bump`; `versionCode = major*10000 + minor*100 + patch` (deterministic, injected via `-PappVersionName/-PappVersionCode`). The `build.gradle` literals are the "last released" fallback.
- **Note**: Play Console's old "API access" page was removed by Google — service accounts are created in Google Cloud Console and invited via Play Console → Users and permissions.


## Object Storage (S3-compatible) — merchant images

- **What**: merchant-uploaded images (today: Post Reply trigger images, delivered on the DM channel as a Meta card). Reply-type-agnostic; a future Smart-Reply-with-image reuses it.
- **Abstraction**: `backend/src/services/imageStorage.ts` — a thin provider-agnostic S3 wrapper (`@aws-sdk/client-s3`; `put`/`remove`/`isConfigured` only). Provider (Backblaze B2 / Cloudflare R2 / AWS S3 / self-hosted MinIO) is chosen entirely by env — swap is env-only, zero code change.
- **Config**: `S3_ENDPOINT` (empty ⇒ real AWS; set ⇒ B2/R2/MinIO path-style), `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`. Feature OFF until all required vars set (`isConfigured()`).
- **Current provider**: Backblaze B2 (reuses the DB-backup account). Public bucket; Meta fetches images from `S3_PUBLIC_BASE_URL/{key}`. No blobs in Postgres (only `trigger_image_url/key/bytes` columns), no bytes on the prod host.
- **Lifecycle**: reference-based (image lives as long as its Post Reply; delete-on-replace/remove + `pagesService.deletePage` cleanup; orphan audit `scripts/audit-trigger-images.ts`). See D-032.
- **Full runbook** (setup, provider switch, backups, key rotation, GDPR): `backend/docs/OBJECT_STORAGE.md`.
