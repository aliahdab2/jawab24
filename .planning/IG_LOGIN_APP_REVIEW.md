# Meta App Review draft — Instagram API with Instagram Login (Jawab24)

> Owner submits from developers.facebook.com → App 774211662298446 → App Review.
> Prerequisites before submitting: (1) add the **"Instagram API with Instagram Login"** product to the app, (2) have a TEST Instagram **professional** (Business) account NOT linked to any Facebook Page, (3) record the screencast below with that account.

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
