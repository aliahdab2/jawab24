# Meta App Review Resubmission Guide

**App ID:** 774211662298446
**Submitted:** 2026-03-06
**Rejected:** 2026-03-12
**Rejection reason (all 4):** Screencast Not Aligned with Use Case Details (Developer Policy 1.6)

**Meta confirmed:** Use case is allowed. Only the video was rejected.

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

## 1. pages_show_list

### Status: [x] Video recorded [ ] Captions added [ ] Ready to submit

### Submission Text

Jawab24 uses the pages_show_list permission during Facebook Login to identify and display the Facebook Pages a user manages.

When a user logs in with Facebook, Meta asks the user to grant permission to "Show a list of the Pages you manage." After the user grants this permission, Jawab24 retrieves the list of Facebook Pages the user manages and displays them in the My Pages section of the Jawab24 dashboard.

This allows the user to:

- View the Facebook Pages associated with their account
- See which Pages are currently connected to Jawab24
- Connect or reconnect a Page through Meta authorization
- Manage automation settings for connected Pages, such as enabling or disabling automatic replies

### Screencast Scenes

| Scene | Action                                   | Caption                                                             |
| ----- | ---------------------------------------- | ------------------------------------------------------------------- |
| 1     | Show `jawab24.com/en/login` (logged out) | _"User visits Jawab24 login page"_                                  |
| 2     | Click "Login with Facebook"              | _"User clicks Login with Facebook"_                                 |
| 3     | Enter credentials on Facebook            | _"User authenticates with their Facebook account"_                  |
| 4     | Permission dialog — zoom in (pause 3s)   | _"Facebook requests permission to access the user's Pages list"_    |
| 5     | Click Continue/Allow                     | _"User grants permission"_                                          |
| 6     | Pages list loads in onboarding           | _"Jawab24 retrieves and displays all Pages the user manages"_       |
| 7     | User selects Pages to connect            | _"User selects which Pages to connect for automatic replies"_       |
| 8     | Navigate to `/en/pages` (pause 4s)       | _"Connected Pages displayed in the Pages management dashboard"_     |

---

## 2. pages_manage_metadata

### Status: [ ] Video recorded [ ] Captions added [ ] Ready to submit

### Submission Text

Jawab24 uses the pages_manage_metadata permission to allow users to connect and manage their Facebook Pages inside the Jawab24 dashboard.

When a user connects a Facebook Page through Jawab24, the app subscribes the Page to receive real-time events such as comments and messages. The connected Page then appears in the Pages dashboard where the user can manage automation settings.

This enables:

- Connecting a Facebook Page to Jawab24
- Receiving real-time notifications when customers comment on posts or send messages
- Managing the Page connection and automation settings from the dashboard

### Screencast Scenes

| Scene | Action                                        | Caption                                                                                         |
| ----- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1     | Show `jawab24.com/en/login` (logged out)      | _"User visits Jawab24 login page"_                                                              |
| 2     | Click "Login with Facebook"                   | _"User clicks Login with Facebook"_                                                             |
| 3     | Enter credentials on Facebook                 | _"User authenticates with their Facebook account"_                                              |
| 4     | Permission dialog — zoom in (pause 3s)        | _"Facebook requests permission to manage Page metadata"_                                        |
| 5     | Click Continue/Allow                          | _"User grants permission"_                                                                      |
| 6     | Select a Page and connect it                  | _"User selects a Page to connect"_                                                              |
| 7     | Show Page as "Connected" in `/en/pages` (4s)  | _"The selected Facebook Page is now connected and managed in the Jawab24 dashboard"_            |

---

## 3. pages_read_engagement

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

## 4. pages_messaging

### Status: [ ] Video recorded [ ] Captions added [ ] Ready to submit

### NOTE: Messaging IS working (confirmed with tester account via Messenger)

**Reviewer's specific note:**

> "Show (1) asset selection (Page, account, or number visible), (2) a live send action from your app, and (3) the delivered message in the native client."

You MUST show the reply appearing in **Messenger** (the native client).

### Submission Text

Jawab24 uses the pages_messaging permission to send automatic replies to customers who message a connected Facebook Page via Messenger.

When a customer sends a message to a connected Page, the message appears in the Jawab24 dashboard and the system generates an automatic reply based on configured AI or template rules. The reply is sent back to the customer through Messenger.

This permission enables:

- Automatic AI-powered replies to customer messages 24/7
- Greeting messages for first-time customers
- Away messages when auto-reply is inactive (outside business hours)

The app only responds to customer-initiated conversations. Jawab24 does not send unsolicited messages or promotional content.

### Screencast Scenes

| Scene | Action                                                              | Caption                                                                 |
| ----- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1     | Show `jawab24.com/en/login` (logged out)                            | _"User visits Jawab24 login page"_                                      |
| 2     | Click "Login with Facebook"                                         | _"User clicks Login with Facebook"_                                     |
| 3     | Enter credentials on Facebook                                       | _"User authenticates with their Facebook account"_                      |
| 4     | Permission dialog — zoom in (pause 3s)                              | _"Facebook requests permission to manage Page messages"_                |
| 5     | Click Continue/Allow                                                | _"User grants permission"_                                              |
| 6     | Show connected Page in `/en/pages` (pause 4s)                       | _"The Jawab24 Facebook Page is connected"_                              |
| 7     | Open Messenger (other browser/incognito) — send message to the Page | _"A customer sends a message to the Page via Messenger"_                |
| 8     | Switch to Jawab24 → `/en/messages` — message appears                | _"Jawab24 receives the message and displays it in the dashboard"_       |
| 9     | Show auto-reply generated (pause 4s)                                | _"Jawab24 generates an automatic reply and sends it to the customer"_   |
| 10    | Switch to Messenger — show reply received (pause 4s)                | _"The automatic reply appears in Messenger"_                            |

### Key: You MUST show the reply in the native Messenger client. This is what the reviewer specifically asked for.

---

## Other Permissions (Not Rejected — Keep Original Text)

These were part of the submission but were not rejected. Keep the original submission text:

- **instagram_business_basic** — keep as is
- **instagram_business_manage_messages** — keep as is
- **instagram_manage_comments** — keep as is
- **instagram_manage_messages** — keep as is
- **instagram_basic** — keep as is
- **public_profile** — auto-granted
- **email** — auto-granted (NOTE: add usage description — was blank in original submission)

### email — Add This Usage Description

Jawab24 uses the email permission to read the user's primary email address associated with their Facebook profile. This is used to create and authenticate the user's Jawab24 account and for account-related communications such as subscription confirmations and support.

---

## Resubmission Checklist

- [x] pages_show_list — video recorded
- [ ] pages_show_list — captions added in iMovie/CapCut
- [ ] pages_manage_metadata — video recorded
- [ ] pages_manage_metadata — captions added
- [ ] pages_read_engagement — resolve catch-22 (comment webhooks need the permission)
- [ ] pages_read_engagement — video recorded
- [ ] pages_read_engagement — captions added
- [ ] pages_messaging — video recorded (messaging confirmed working)
- [ ] pages_messaging — captions added
- [ ] email — add usage description (was blank)
- [ ] iOS build — upload proper .app/.zip (NOT .apk)
- [ ] Review all submission text before submitting
