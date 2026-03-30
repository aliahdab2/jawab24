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
