# Meta App Review Resubmission Guide

**App ID:** 774211662298446

## Submission History

| Date | Action | Result |
|------|--------|--------|
| 2026-03-06 | First submission (all permissions) | Rejected 2026-03-12 |
| 2026-03-12 | Rejection reason (all 4 Facebook permissions) | Screencast Not Aligned with Use Case Details (Developer Policy 1.6) |
| 2026-03-21 | Resubmission (3 Facebook permissions) | **Approved** ✅ |
| Pending | New submission (2 remaining permissions) | Not yet submitted |

**Meta confirmed:** Use case is allowed. Only the videos were rejected in the first submission.

---

## Current Status (as of 2026-03-30)

### ✅ Approved Permissions (March 21 submission)

| Permission | Status |
|-----------|--------|
| `pages_show_list` | Approved |
| `pages_manage_metadata` | Approved |
| `pages_messaging` | Approved |
| `email` | Renewed |
| `public_profile` | Renewed |

### ⏳ Pending Submission (Not yet submitted)

**New requests:**
- `pages_manage_engagement` — needs video + submission text
- `pages_read_engagement` — needs video + submission text (catch-22 issue)

**Existing access for renewal:**
- `email`, `pages_show_list`, `pages_manage_metadata`, `pages_messaging`, `public_profile` — auto-renewed, no action needed

---

## Recording Rules (from Meta Screen Recording Guide)

- No audio — use text captions only
- English UI (`/en/` URLs)
- 1920×1080 resolution
- Large cursor, mouse clicks only (no keyboard shortcuts)
- Start logged out
- Show complete login flow
- Add text captions explaining each step (no API endpoints in captions)
- Pause 2–3 seconds on permission dialog
- Pause 3–4 seconds on dashboard screens
- One video per permission (do NOT combine permissions)
- Record with QuickTime Player (Show Mouse Clicks enabled)
- Add captions in iMovie or CapCut after recording

### What NOT to do in videos

- Do NOT show API endpoints (e.g., `POST /{page-id}/subscribed_apps`) in captions
- Do NOT mention permission dependencies in submission text
- Do NOT show Facebook settings pages (Business Integrations, etc.)
- Do NOT combine multiple permissions in one video

---

## 1. pages_read_engagement

### Status: [ ] Video recorded [ ] Captions added [ ] Ready to submit

### IMPORTANT: Catch-22 Issue

Comment webhooks require `pages_read_engagement` permission to work. But this permission is what we're requesting. In development mode, Facebook does NOT send comment webhooks without this permission being granted.

**Messaging works** (confirmed — Jawab24 replied to a Messenger message).
**Comments do NOT arrive** because the permission hasn't been granted yet.

**Workaround options:**

1. Use the Meta Webhooks Test tool (Developer Dashboard → Webhooks → Page → feed → "Test") to simulate a comment webhook
2. Show existing comments in the dashboard from a previously connected Page
3. Add a note in the submission explaining the app is in development mode

### Submission Text

Jawab24 uses the pages_read_engagement permission to read comments and engagement activity on connected Facebook Pages.

After a Page is connected, Jawab24 receives webhook notifications when customers comment on Page posts. When a new comment is received, Jawab24 reads the comment content and displays it in the Comments section of the dashboard. The app then automatically generates a reply using AI or matches it against user-configured template rules.

This allows Page owners to:

- Monitor customer comments on their Facebook Page posts
- View all comments and replies in a centralized dashboard
- Automatically respond to comments using AI-generated or template-based replies

### Screencast Scenes

| Scene | Action                                                           | Caption                                                               |
| ----- | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1     | Show `jawab24.com/en/login` (logged out)                         | _"User visits Jawab24 login page"_                                    |
| 2     | Click "Login with Facebook"                                      | _"User clicks Login with Facebook"_                                   |
| 3     | Enter credentials on Facebook                                    | _"User authenticates with their Facebook account"_                    |
| 4     | Permission dialog — zoom in (pause 3s)                           | _"Facebook requests permission to read Page engagement"_              |
| 5     | Click Continue/Save                                              | _"User grants permission"_                                            |
| 6     | Show Page connected in Jawab24 (pause 4s)                        | _"The Facebook Page is connected to Jawab24"_                         |
| 7     | Switch to Facebook — post a comment from the tester account      | _"A customer comments on a post on the Facebook Page"_                |
| 8     | Switch to Jawab24 → `/en/comments` — comment appears             | _"Jawab24 receives the new comment and displays it in the dashboard"_ |
| 9     | Show reply generation (pause 4s)                                 | _"Jawab24 reads the comment and generates an automatic reply"_        |

### Key: You MUST show the comment being created on Facebook, then appearing in Jawab24. Without this, reviewers reject.

---

## 2. pages_manage_engagement

### Status: [ ] Video recorded [ ] Captions added [ ] Ready to submit

### Submission Text

Jawab24 uses the pages_manage_engagement permission to reply to comments on connected Facebook Page posts on behalf of the Page.

When a customer comments on a Facebook Page post, Jawab24 receives the comment and generates an automatic reply — either AI-powered or matched against user-configured template rules. The reply is then posted as a response to the original comment directly on the Facebook post.

This allows Page owners to:

- Automatically reply to customer comments on their Page posts
- Maintain fast response times without manual monitoring
- Use AI-generated or template-based replies to engage with customers

The app only responds to customer-initiated engagement. Jawab24 does not post unsolicited comments or promotional content.

### Screencast Scenes

| Scene | Action                                                           | Caption                                                                  |
| ----- | ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1     | Show `jawab24.com/en/login` (logged out)                         | _"User visits Jawab24 login page"_                                       |
| 2     | Click "Login with Facebook"                                      | _"User clicks Login with Facebook"_                                      |
| 3     | Enter credentials on Facebook                                    | _"User authenticates with their Facebook account"_                       |
| 4     | Permission dialog — zoom in (pause 3s)                           | _"Facebook requests permission to manage Page engagement"_               |
| 5     | Click Continue/Allow                                             | _"User grants permission"_                                               |
| 6     | Show Page connected in Jawab24 (pause 4s)                        | _"The Facebook Page is connected to Jawab24"_                            |
| 7     | Switch to Facebook — post a comment from the tester account      | _"A customer comments on a post on the Facebook Page"_                   |
| 8     | Switch to Jawab24 → `/en/comments` — comment appears             | _"Jawab24 receives the comment in the dashboard"_                        |
| 9     | Show reply being generated and sent (pause 4s)                   | _"Jawab24 generates an automatic reply and posts it to the comment"_     |
| 10    | Switch to Facebook — show the reply on the post (pause 4s)       | _"The automatic reply appears on the Facebook post"_                     |

### Key: You MUST show the reply appearing on the Facebook post itself (not just in the dashboard). This proves the app is writing back to the Page.

---

## Previously Approved Permissions (Reference Only)

These were approved in the March 21 submission. No further action needed.

<details>
<summary>pages_show_list — Approved ✅</summary>

### Submission Text

Jawab24 uses the pages_show_list permission during Facebook Login to identify and display the Facebook Pages a user manages.

When a user logs in with Facebook, Meta asks the user to grant permission to "Show a list of the Pages you manage." After the user grants this permission, Jawab24 retrieves the list of Facebook Pages the user manages and displays them in the My Pages section of the Jawab24 dashboard.

This allows the user to:

- View the Facebook Pages associated with their account
- See which Pages are currently connected to Jawab24
- Connect or reconnect a Page through Meta authorization
- Manage automation settings for connected Pages, such as enabling or disabling automatic replies

</details>

<details>
<summary>pages_manage_metadata — Approved ✅</summary>

### Submission Text

Jawab24 uses the pages_manage_metadata permission to allow users to connect and manage their Facebook Pages inside the Jawab24 dashboard.

When a user connects a Facebook Page through Jawab24, the app subscribes the Page to receive real-time events such as comments and messages. The connected Page then appears in the Pages dashboard where the user can manage automation settings.

This enables:

- Connecting a Facebook Page to Jawab24
- Receiving real-time notifications when customers comment on posts or send messages
- Managing the Page connection and automation settings from the dashboard

</details>

<details>
<summary>pages_messaging — Approved ✅</summary>

### Submission Text

Jawab24 uses the pages_messaging permission to send automatic replies to customers who message a connected Facebook Page via Messenger.

When a customer sends a message to a connected Page, the message appears in the Jawab24 dashboard and the system generates an automatic reply based on configured AI or template rules. The reply is sent back to the customer through Messenger.

This permission enables:

- Automatic AI-powered replies to customer messages 24/7
- Greeting messages for first-time customers
- Away messages when auto-reply is inactive (outside business hours)

The app only responds to customer-initiated conversations. Jawab24 does not send unsolicited messages or promotional content.

</details>

---

## Other Permissions (Not Rejected in First Submission)

These were part of the first submission but were not rejected. Instagram permissions are handled separately:

- **instagram_business_basic** — keep as is
- **instagram_business_manage_messages** — keep as is
- **instagram_manage_comments** — keep as is
- **instagram_manage_messages** — keep as is
- **instagram_basic** — keep as is

### email — Usage Description (was blank in original submission, now renewed)

Jawab24 uses the email permission to read the user's primary email address associated with their Facebook profile. This is used to create and authenticate the user's Jawab24 account and for account-related communications such as subscription confirmations and support.

---

## Submission Checklist

### Must do before submitting

- [ ] pages_read_engagement — resolve catch-22 (test with Webhooks Test tool)
- [ ] pages_read_engagement — video recorded
- [ ] pages_read_engagement — captions added in iMovie/CapCut
- [ ] pages_manage_engagement — video recorded
- [ ] pages_manage_engagement — captions added in iMovie/CapCut
- [ ] Review submission text for both permissions before submitting

### Nice to have

- [ ] iOS build — upload proper .app/.zip (NOT .apk) if required for this submission

---

# WhatsApp Embedded Signup Submission (added 2026-07-07)

**Goal:** Advanced Access for `whatsapp_business_messaging` + `whatsapp_business_management` on app **774211662298446**, so Jawab24 can onboard merchants as a **Tech Provider** via Embedded Signup (no Facebook Page required for the merchant — only a Facebook login).

**Why this unblocks launch:** the WhatsApp channel is already deployed dark in production (PR #392). The ONLY remaining blocker is this approval → then create the ES configuration → set `NEXT_PUBLIC_WHATSAPP_CONFIG_ID` → founder pilot.

## Status

| Prerequisite | State |
|---|---|
| Business verification (Business 867483152446840) | ✅ Done |
| Access verification — *business* verified as a Tech Provider | ✅ Done 2026-03-06 (Alert Inbox: "Your business, Jawab24, has been verified as a Tech Provider and no further action is required") |
| **Tech Provider onboarding — *app* level** | ❌ **NOT done. A THIRD, separate thing from the two rows above** — see the warning below |
| WhatsApp product added to the app | ☐ Not yet — Part A below |
| Test number + screencasts | ☐ Not yet — Parts A–B below |

> ⚠️ **THREE different "Tech Provider / verification" things exist. Do not conflate them.**
> This table originally collapsed them into one row reading "verified Meta Tech Provider",
> and that wrong belief cost real time on 2026-07-26:
> 1. **Business verification** of business 867483152446840 — done.
> 2. **Access verification**: the *business* verified as a Tech Provider — done 2026-03-06,
>    and its alert says "no further action is required", which is what made rows 1–2 look
>    like the whole story.
> 3. **Tech Provider onboarding at the APP level** — *not* done, and it is what Embedded
>    Signup actually gates on. With App Review approved, the ES config created, the CSP
>    fixed and the JS-SDK toggle on, the popup still failed with **"Jawab24 can't onboard
>    customers at the moment"** purely because of this.
>
> Where: WhatsApp use case → **Next steps → Become a Partner → Become Tech Provider**.
> Screen 1 is an intro ("Send messages on behalf of your customers" / "Onboard customers
> from your website"). Screen 2 asks **Independent Tech Provider** (correct for us — we
> onboard merchants ourselves) vs *Working with a Solution Partner* (needs a partner app
> ID), and carries the gate: *"By continuing, you agree to [Tech Provider Terms]"*
> → https://www.facebook.com/legal/BM-tech-provider-terms
> Guide: https://developers.facebook.com/docs/whatsapp/solution-providers/get-started-for-tech-providers/
>
> 🕒 **Both options state "App review is required" — so this is NOT instant self-serve.**
> It is a terms acceptance (owner decision, never an assistant's) plus a further App
> Review cycle. Budget for it in any launch date.
>
> Full gate order: Advanced Access → ES configuration → JS-SDK login toggle + allowed
> domain → nginx CSP → **app-level Tech Provider onboarding (terms + App Review)** →
> connect works.
| Review timeline after submitting | 3–5 business days |

**Key fact (verified in Meta docs):** you do NOT need approval to record the evidence. Adding the WhatsApp product gives a free **dev-mode test number** immediately, and Meta explicitly accepts as screencast evidence: (1) the **API Setup cURL** sending a message that arrives in the WhatsApp client, and (2) **WhatsApp Manager** creating a message template. Both work pre-approval.

> **Caption-rule nuance vs the Facebook videos above:** the "no API endpoints in captions" rule came from the pages_* rejection. For WhatsApp, Meta's own sample-submission page accepts a terminal cURL recording — the endpoint being visible in the terminal is fine. Still keep the *captions* descriptive ("The business sends a WhatsApp message from its system"), not technical.

---

## Part A — Dashboard setup (~15 min, do first)

1. [developers.facebook.com/apps/774211662298446](https://developers.facebook.com/apps/774211662298446) → **Add Product** → **WhatsApp** → Set up.
2. Choose the existing business portfolio (867483152446840) when asked.
3. Open **WhatsApp → API Setup**. Note the **test phone number** Meta assigned and the temporary access token.
4. Under **To**, add your personal WhatsApp number as a test recipient (OTP verification on your phone).
5. Copy the pre-filled **cURL** command, run it in a terminal → the `hello_world` template arrives on your phone. This is both the smoke test and Scene 3–5 of Video 1.

## Part B — Record the two screencasts (~30 min)

Follow the global Recording Rules above (no audio, captions, 1920×1080, QuickTime + captions in iMovie/CapCut, one video per permission).

### Video 1 — `whatsapp_business_messaging`

| Scene | Action | Caption |
| ----- | ------ | ------- |
| 1 | App Dashboard → WhatsApp → API Setup (pause 3s) | *"The business configures WhatsApp messaging"* |
| 2 | Show the test number + recipient field | *"A WhatsApp Business number is set up for the business"* |
| 3 | Terminal — run the API Setup cURL | *"The business system sends a reply to a customer's WhatsApp message"* |
| 4 | Phone screen/mirror — message arrives in WhatsApp (pause 4s) | *"The customer receives the message in WhatsApp"* |
| 5 | (Optional, stronger) Jawab24 `/en/messages` inbox showing a WhatsApp conversation | *"Conversations appear in the business dashboard"* |

**Key:** the message MUST be shown arriving in the WhatsApp client (phone mirror via QuickTime works). Business-facing interface only — never the customer-side flow alone.

### Video 2 — `whatsapp_business_management`

| Scene | Action | Caption |
| ----- | ------ | ------- |
| 1 | business.facebook.com → WhatsApp Manager (pause 3s) | *"The business opens WhatsApp Manager"* |
| 2 | Account tools → Message templates → Create template | *"The business creates a message template"* |
| 3 | Fill name/category/body (e.g. order update) | *"The template defines the message the business will send"* |
| 4 | Submit → template listed (pause 4s) | *"The template is created and pending review"* |

## Part C — Submission texts (paste into App Review)

### `whatsapp_business_messaging`

> Jawab24 is a Tech Provider that enables small businesses to automatically reply to their customers on WhatsApp.
>
> When a customer sends a WhatsApp message to a business's registered number, Jawab24 receives the message via webhook, generates a reply based on the business's own business information, and sends the reply back to the customer within the 24-hour customer service window. Voice notes are transcribed and answered the same way. All conversations also appear in the business's Jawab24 inbox, where the business can reply manually.
>
> This allows business owners to:
> - Automatically answer customer questions 24/7, in Arabic and English
> - Respond to voice notes, images and text messages
> - Manage all customer conversations from one dashboard
>
> Jawab24 only responds to customer-initiated conversations. It does not send unsolicited or promotional messages.

### `whatsapp_business_management`

> Jawab24 uses whatsapp_business_management to onboard its business customers through Embedded Signup and to manage the WhatsApp Business Accounts they connect.
>
> When a business connects WhatsApp inside the Jawab24 dashboard, Jawab24 completes Embedded Signup, subscribes the business's WhatsApp Business Account to webhooks so that customer messages reach the business's Jawab24 inbox, and registers the business's phone number for Cloud API messaging. Jawab24 also needs this permission to manage message templates on behalf of its business customers.
>
> This allows business owners to:
> - Connect their WhatsApp Business number to Jawab24 in a few clicks, without technical setup
> - Have their number registered and their account subscribed to receive customer messages
> - Manage their WhatsApp presence alongside Facebook and Instagram in one dashboard

## Part D — Submit

1. App Dashboard → **App Review → Permissions and Features**.
2. Request **Advanced Access** for `whatsapp_business_messaging` and `whatsapp_business_management`.
3. Attach the matching video to each permission + paste the texts above. One video per permission.
4. Submit. Expect 3–5 business days.
5. **On approval:** WhatsApp → Embedded Signup → create a **configuration** → copy the **Configuration ID** → hand it over for the prod env (`NEXT_PUBLIC_WHATSAPP_CONFIG_ID` + `WHATSAPP_ALLOWLIST` + canary flag, frontend rebuild).

## Pilot watch item — payment method

Meta's Tech Provider docs state onboarded businesses "must add a payment method to their WhatsApp Business account." During the founder pilot, verify whether **inbound-only** usage (customer-initiated service conversations, which are free) actually works without one — this matters for sanctioned-country merchants who can't add international cards.

## WhatsApp submission checklist

- [ ] Part A: WhatsApp product added, test number noted, own number verified as recipient
- [ ] Part A: cURL smoke test — hello_world arrived on phone
- [ ] Video 1 (messaging) recorded + captioned
- [ ] Video 2 (management) recorded + captioned
- [ ] Both submission texts reviewed
- [ ] Submitted — clock started (3–5 business days)
- [ ] On approval: ES configuration created → Configuration ID handed over

**Sources:** Meta docs — [Embedded Signup](https://developers.facebook.com/docs/whatsapp/embedded-signup/), [Become a Tech Provider](https://developers.facebook.com/docs/whatsapp/solution-providers/get-started-for-tech-providers), [App Review sample submission](https://developers.facebook.com/docs/whatsapp/solution-providers/app-review/sample-submission), [Onboarding customers as a Tech Provider](https://developers.facebook.com/docs/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider/).
