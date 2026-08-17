# Meta App Review draft — Instagram API with Instagram Login (Jawab24)

> Owner submits from developers.facebook.com → App 774211662298446 → App Review.

## Status — verified 2026-08-17

| Prerequisite | State |
|---|---|
| "Instagram API with Instagram Login" product on the app | ✅ Instagram app id `1188581226417011` (a product INSIDE app `774211662298446`, not a standalone app — its own dashboard URL 404s) |
| Backend credentials in prod (`INSTAGRAM_APP_*` in `env/backend.env`) | ✅ callback probe returns 200 |
| Frontend flag built into the image (`env/frontend.env`) | ✅ bundle-verified, connect option renders |
| TEST professional account, no Facebook Page | ✅ `@jawab24app` — ⛔ **never link it to the Jawab24 Facebook Page**, that destroys the prerequisite AND our connect refuses the hybrid row |
| Instagram Tester role accepted | ✅ added on the PARENT app's Roles page, accepted from instagram.com → Settings → Apps and websites → Tester invitations (no phone needed) |
| Real end-to-end connect | ✅ 2026-08-17 — log line `connected @jawab24app (webhooks: ok)`, i.e. `subscribed_apps` installed |
| Public use-case URL | ✅ `https://jawab24.com/en/instagram` (200), privacy 200, data-deletion URL valid (POST-only, so GET 404 is correct) |
| Reviewer demo login | ✅ `DEMO_MODE_ENABLED=true` in prod |
| **Inbound DM test** | ❌ **NOT DONE** — needs a second Instagram account (owner's phone). Do this BEFORE recording: if the auto-reply does not land there is nothing to film |
| **Screencast** | ❌ not recorded — the ONLY thing blocking submission |

⚠️ **Page-limit gotcha when testing.** Enabling auto-reply on the connected
Instagram-direct card consumes a page seat. The founder workspace is on the
**Business** plan (`plans.max_pages = 2`) and both seats are normally taken, so the
toggle answers `403 PAGE_LIMIT_REACHED` until one is freed. It also 409s
(`BUSINESS_INFO_REQUIRED`) until the page has a grounding source — Business Info or
a knowledge base. Both are by design, not defects.

## Public use-case URL

`https://jawab24.com/instagram` (AR default, `/en/instagram` for English) — the standalone
Instagram page: what the integration does, the three permissions with a plain-language
statement of what each is used for, what we explicitly do NOT request (publishing), data
storage/retention, and how a merchant disconnects or deletes. Give this URL to the reviewer
as the use-case link. Its claims are code-verified — keep it in step with what actually ships.

## Permissions requested

### 1. instagram_business_basic
**How we use it:** After a merchant signs in with their Instagram professional account, we retrieve the account's id, username and profile picture to display the connected channel in their Jawab24 dashboard and to route incoming webhook events (messages, comments) to the correct merchant workspace.

### 2. instagram_business_manage_messages
**How we use it:** Jawab24 is a customer-service tool for small businesses. When a customer sends the merchant's Instagram account a Direct Message, we receive it via webhooks and either (a) send an automated reply composed from the merchant's own business information (opening hours, prices, FAQs the merchant wrote), or (b) let the merchant reply manually from our unified inbox. Replies are only sent within Instagram's standard messaging window. Merchants can disable automation at any time; a human-agent takeover is always available.

### 3. instagram_business_manage_comments
**How we use it:** Merchants configure keyword rules on their own posts ("Post Reply"): when a customer comment matches, we reply publicly and/or by direct message with the merchant's pre-written text (e.g. price + ordering link). We also support AI-assisted comment replies from the merchant's business info. Only comments on the authenticated merchant's own media are read.

> ⚠️ Do NOT claim comment hiding/moderation. `InstagramService.hideComment` and
> `deleteComment` (`backend/src/services/instagram.ts:210`, `:240`) have **zero callers** —
> verified 2026-08-16. Describing an unbuilt capability to a reviewer who then tries to
> exercise it is a rejection. Wire it first if we want it in the submission.

**Not requested:** instagram_business_content_publish (we do not publish posts).

## ⭐ What the reviewer actually asked for

The 6 Mar rejection was about the VIDEO, nothing else. Verbatim:

> "the screencast does not show a message being sent from your app UI and the same
> message appearing in the native client… Please re-record showing: (1) asset
> selection (Page, account, or number visible), (2) a live send action from your
> app, and (3) the delivered message in the native client."

So the recording MUST contain all three, and (2) means a **manual reply typed and
sent from the Jawab24 inbox** — an automatic reply alone is what failed last time.
Film Jawab24 and Instagram **side by side in one frame** so the send and the arrival
are visibly the same message. Record with the app in **English** (`/en`) and say what
each button does; an Arabic-only recording is an independent rejection cause.

## Screencast script (one take, ~3 min)
1. Log in to Jawab24 with a demo merchant → dashboard.
2. Click «ربط قناة» → choose Instagram → the Instagram OAuth dialog appears → sign in with the TEST professional account (no Facebook Page involved) → grant the 3 permissions → land back in the dashboard with the account connected (username + avatar visible → shows instagram_business_basic).
3. From a second (customer) Instagram account, DM the test account a question → show the auto-reply arriving in the customer's thread AND the conversation visible in the Jawab24 inbox → reply manually once from the inbox (→ manage_messages). Manual DM reply IS wired (`controllers/messages.ts:155-161`).
4. On a post of the test account, comment a keyword configured in Post Reply → show the public comment reply + the direct message to the commenter (→ manage_comments). ⛔ Do NOT attempt to hide the comment — moderation is not implemented (see the warning above). ⛔ Do NOT demo a manual reply to a COMMENT from the inbox: `POST /comments/:id/reply` only marks the row replied in our DB and never calls the Graph API (`controllers/comments.ts:140-162`), so the reviewer would see a success toast and no reply on Instagram.
5. Show the settings screen where automation can be turned off (per-page toggle + business hours + away message — all wired).

## Reviewer test credentials
Provide: demo Jawab24 login + the test IG professional account credentials (Meta requires working credentials for review).

## Notes for us
- Our approved instagram_manage_messages / instagram_manage_comments are the **Facebook-Login** variants; this is a separate review track for the Instagram-Login product.
- App is Live, Business-verified, Tech Provider — no new business verification expected.
- Timing: submit now; review runs in parallel with Phase-0 work. Approval does NOT commit us to building — it just removes the longest pole.
- ⛔ **Never press "Request again"** on the 6 Mar rejection page: it resubmits that whole
  old bundle, including Facebook scopes already approved and serving production. Open a
  FRESH request for the three `instagram_business_*` scopes only.
- `@jawab24app` is already connected, so filming "asset selection" means running the
  connect again (the consent screen shows «You previously connected…» and returns to the
  dashboard). Do NOT remove the card to get a virgin flow: removing it deletes the page
  row and its Business Info, after which the auto-reply toggle is blocked again by the
  Business-Info gate and the 2-page plan cap.
- Business case for the feature, measured 2026-08-16: **23 of 84 production users (27%)
  have zero pages** — the Instagram-only merchants this unlocks.
