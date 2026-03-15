# Meta App Review Resubmission Guide

**App ID:** 774211662298446
**Submitted:** 2026-03-06
**Rejected:** 2026-03-12
**Rejection reason (all 4):** Screencast Not Aligned with Use Case Details (Developer Policy 1.6)

**Meta confirmed:** Use case is allowed. Only the video was rejected.

## Recording Rules (from Meta Screen Recording Guide)

- No audio
- English UI (`/en/` URLs)
- 1080p resolution, max 1440px width
- Large cursor, mouse clicks only (no keyboard shortcuts)
- Start logged out
- Show complete login flow
- Add text captions/tooltips explaining each step
- Record with QuickTime Player (Show Mouse Clicks enabled)
- Add captions in iMovie or CapCut after recording

---

## 1. pages_show_list

### Status: [x] Video recorded  [ ] Captions added  [ ] Ready to submit

### Submission Text

Jawab24 uses the pages_show_list permission during Facebook Login to identify and display the Facebook Pages a user manages.

When a user logs in with Facebook, Meta asks the user to grant permission to "Show a list of the Pages you manage." After the user grants this permission, Jawab24 retrieves the list of Facebook Pages the user manages and displays them in the My Pages section of the Jawab24 dashboard.

This allows the user to:
- View the Facebook Pages associated with their account
- See which Pages are currently connected to Jawab24
- Connect or reconnect a Page through Meta authorization
- Manage automation settings for connected Pages, such as enabling or disabling automatic replies

The screencast demonstrates:
1. The user logging in with Facebook from Jawab24
2. Meta requesting permission including "Show a list of the Pages you manage" (pages_show_list)
3. The user granting the permission
4. The user being redirected back to Jawab24
5. Jawab24 displaying the user's Pages in the My Pages dashboard where they can be connected or managed

### Screencast Scenes

| Scene | Action | Caption |
|-------|--------|---------|
| 1 | Show `jawab24.com/en/login` (logged out) | *"User visits Jawab24 login page"* |
| 2 | Click "Login with Facebook" | *"User clicks Login with Facebook"* |
| 3 | Enter credentials on Facebook | *"User authenticates with their Facebook account"* |
| 4 | Permission dialog — zoom in | *"Facebook requests permission to access the user's Pages list (pages_show_list)"* |
| 5 | Click Continue/Allow | *"User grants permission"* |
| 6 | Pages list loads in onboarding | *"Jawab24 retrieves and displays all Pages the user manages"* |
| 7 | User selects Pages to connect | *"User selects which Pages to connect for automatic replies"* |
| 8 | Navigate to `/en/pages` | *"Connected Pages displayed in the Pages management dashboard"* |

---

## 2. pages_manage_metadata

### Status: [ ] Video recorded  [ ] Captions added  [ ] Ready to submit

### Submission Text

Jawab24 uses the pages_manage_metadata permission to subscribe connected Facebook Pages to webhook events via the /PAGE_ID/subscribed_apps endpoint.

When a user connects a Facebook Page through Jawab24, the app subscribes the Page to receive real-time webhook notifications for new comments and messages. This is required so that Facebook delivers instant notifications to Jawab24, enabling automatic replies.

This allows the user to:
- Connect a Page and have it automatically subscribed to webhook events
- Receive real-time notifications when customers comment on posts or send messages
- Ensure automatic replies are triggered instantly without manual polling

The screencast demonstrates:
1. The user logging in with Facebook from Jawab24
2. Meta requesting the pages_manage_metadata permission
3. The user granting the permission
4. The user selecting a Page to connect
5. Jawab24 subscribing the Page to webhook events (Page shows as "Connected")
6. A real-time notification arriving in the dashboard (message or comment)

### Screencast Scenes

| Scene | Action | Caption |
|-------|--------|---------|
| 1 | Show `jawab24.com/en/login` (logged out) | *"User visits Jawab24 login page"* |
| 2 | Click "Login with Facebook" | *"User clicks Login with Facebook"* |
| 3 | Enter credentials on Facebook | *"User authenticates with their Facebook account"* |
| 4 | Permission dialog — zoom in | *"Facebook requests permission to manage Page metadata (pages_manage_metadata)"* |
| 5 | Click Continue/Allow | *"User grants permission"* |
| 6 | Select a Page and connect it | *"User selects a Page to connect"* |
| 7 | Show Page as "Connected" in `/en/pages` | *"Jawab24 subscribes the Page to webhook events via /PAGE_ID/subscribed_apps — Page is now connected and receiving real-time notifications"* |
| 8 | (Optional) Show a message arriving in real-time | *"Real-time webhook notification received"* |

---

## 3. pages_read_engagement

### Status: [ ] Video recorded  [ ] Captions added  [ ] Ready to submit

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

The screencast demonstrates:
1. The user logging in with Facebook
2. Meta requesting the pages_read_engagement permission
3. The user granting permission
4. A customer posting a comment on a Facebook Page post
5. Jawab24 receiving and displaying the comment in the dashboard
6. Jawab24 generating an automatic reply

### Screencast Scenes

| Scene | Action | Caption |
|-------|--------|---------|
| 1 | Show `jawab24.com/en/login` (logged out) | *"User visits Jawab24 login page"* |
| 2 | Click "Login with Facebook" | *"User clicks Login with Facebook"* |
| 3 | Enter credentials on Facebook | *"User authenticates with their Facebook account"* |
| 4 | Permission dialog — zoom in on "Read content posted on the Page" | *"Facebook requests the pages_read_engagement permission"* (pause 2 seconds) |
| 5 | Click Continue/Save | *"User grants permission"* |
| 6 | Show Page connected in Jawab24 | *"The Facebook Page is connected to Jawab24"* |
| 7 | Switch to Facebook — post a comment from the tester account | *"A customer comments on a post on the Facebook Page"* |
| 8 | Switch to Jawab24 → `/en/comments` — comment appears | *"Jawab24 receives the new comment and displays it in the dashboard"* |
| 9 | Show reply generation | *"Jawab24 reads the comment and generates an automatic reply"* |

### Key: You MUST show the comment being created on Facebook, then appearing in Jawab24. Without this, reviewers reject.

---

## 4. pages_messaging

### Status: [ ] Video recorded  [ ] Captions added  [ ] Ready to submit

### NOTE: Messaging IS working (confirmed with tester account via Messenger)

**Reviewer's specific note:**
> "Show (1) asset selection (Page, account, or number visible), (2) a live send action from your app, and (3) the delivered message in the native client."

You MUST show the reply appearing in **Messenger** (the native client).

### Submission Text

Jawab24 uses the pages_messaging permission to send automatic replies to customers who message a connected Facebook Page via Messenger.

When a customer sends a message to a connected Page, Jawab24 receives a webhook notification, generates an AI-powered or template-based reply, and sends it back through the Page's Messenger using the Send API. Page owners can also configure greeting messages for new conversations and away messages for when auto-reply is inactive.

This allows the user to:
- Automatically reply to customer messages on Messenger
- Configure greeting messages for first-time customers
- Set away messages for off-hours
- View all conversations in the Jawab24 Messages dashboard

The screencast demonstrates:
1. The user logging in with Facebook from Jawab24
2. Meta requesting the pages_messaging permission
3. The user granting permission
4. The connected Page visible in the dashboard
5. A customer sending a message via Messenger
6. Jawab24 receiving the message and generating an automatic reply
7. The reply appearing in Messenger (native client)

### Screencast Scenes

| Scene | Action | Caption |
|-------|--------|---------|
| 1 | Show `jawab24.com/en/login` (logged out) | *"User visits Jawab24 login page"* |
| 2 | Click "Login with Facebook" | *"User clicks Login with Facebook"* |
| 3 | Enter credentials on Facebook | *"User authenticates with their Facebook account"* |
| 4 | Permission dialog — zoom in | *"Facebook requests permission to manage Page messages (pages_messaging)"* |
| 5 | Click Continue/Allow | *"User grants permission"* |
| 6 | Show connected Page in `/en/pages` | *"The Jawab24 Facebook Page is connected"* |
| 7 | Open Messenger (other browser/incognito) — send message to the Page | *"A customer sends a message to the Page via Messenger"* |
| 8 | Switch to Jawab24 → `/en/messages` — message appears | *"Jawab24 receives the message via webhook"* |
| 9 | Show auto-reply generated | *"Jawab24 generates an automatic reply and sends it via the Send API"* |
| 10 | Switch to Messenger — show reply received | *"The automatic reply appears in Messenger (native client)"* |

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
