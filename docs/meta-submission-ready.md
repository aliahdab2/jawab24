# Meta App Review — Ready-to-Submit Guide

**App ID:** 774211662298446
**Submission date:** April 1, 2026
**Permissions to submit:** `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement`, `instagram_basic`, `instagram_manage_comments`, `instagram_manage_messages`

---

## 1. pages_read_engagement

### Submission Text (copy-paste this)

```
Jawab24 uses the pages_read_engagement permission to read comments and engagement activity on connected Facebook Pages.

After a Page is connected, Jawab24 receives webhook notifications when customers comment on Page posts. When a new comment is received, Jawab24 reads the comment content and displays it in the Comments section of the dashboard. The app then automatically generates a reply using AI or matches it against user-configured template rules.

This allows Page owners to:
- Monitor customer comments on their Facebook Page posts
- View all comments and replies in a centralized dashboard
- Automatically respond to comments using AI-generated or template-based replies
```

### Video Captions (add these in order in iMovie/CapCut)

| # | What to do on screen | Caption text to display |
|---|---------------------|----------------------|
| 1 | Show `jawab24.com/en/login` (logged out) | "User visits Jawab24 login page" |
| 2 | Click "Login with Facebook" | "User clicks Login with Facebook" |
| 3 | Enter credentials on Facebook | "User authenticates with their Facebook account" |
| 4 | Permission dialog appears — zoom in, pause 3 seconds | "Facebook requests permission to read Page engagement" |
| 5 | Click Continue / Save | "User grants permission" |
| 6 | Jawab24 dashboard shows the connected Page — pause 4 seconds | "The Facebook Page is connected to Jawab24" |
| 7 | Switch to Facebook — comment on a Page post from a different account | "A customer comments on a post on the Facebook Page" |
| 8 | Switch back to Jawab24 → Comments page — comment appears | "Jawab24 receives the new comment and displays it in the dashboard" |
| 9 | Show the reply being generated — pause 4 seconds | "Jawab24 reads the comment and generates an automatic reply" |

### API Test Call

**Status:** Completed ✅ (no action needed)

---

## 2. pages_read_user_content

### Submission Text (copy-paste this)

```
Jawab24 uses the pages_read_user_content permission to read comments that customers post on connected Facebook Page posts.

When a customer comments on a Page post, Jawab24 receives a webhook notification and reads the comment content using the Graph API. The comment is displayed in the Jawab24 dashboard, where the app generates an automatic reply — either AI-powered or matched against user-configured template rules.

This allows Page owners to:
- Read customer comments on their Facebook Page posts in real time
- Display comment content in a centralized dashboard for monitoring
- Use comment content as input for generating automatic replies

The app only reads user-generated content (comments) on Pages the owner has explicitly connected. No data is used for marketing or advertising purposes.
```

### Video Captions (add these in order in iMovie/CapCut)

| # | What to do on screen | Caption text to display |
|---|---------------------|----------------------|
| 1 | Show `jawab24.com/en/login` (logged out) | "User visits Jawab24 login page" |
| 2 | Click "Login with Facebook" | "User clicks Login with Facebook" |
| 3 | Enter credentials on Facebook | "User authenticates with their Facebook account" |
| 4 | Permission dialog appears — zoom in, pause 3 seconds | "Facebook requests permission to read user content on the Page" |
| 5 | Click Continue / Allow | "User grants permission" |
| 6 | Jawab24 dashboard shows the connected Page — pause 4 seconds | "The Facebook Page is connected to Jawab24" |
| 7 | Switch to Facebook — comment on a Page post from a different account | "A customer comments on a post on the Facebook Page" |
| 8 | Switch back to Jawab24 → Comments page — comment appears with full text | "Jawab24 reads the customer's comment and displays it in the dashboard" |
| 9 | Show the reply being generated — pause 4 seconds | "The comment content is used to generate an automatic reply" |

### API Test Call

**Status:** 0 of 1 required

**How to complete:** In Graph API Explorer, generate a Page Access Token with `pages_read_user_content`, then run:

```
GET /{post-id}/comments
```

Use a post ID from your test Page. The response should return the comments on that post.

---

## 3. pages_manage_engagement

### Submission Text (copy-paste this)

```
Jawab24 uses the pages_manage_engagement permission to reply to comments on connected Facebook Page posts on behalf of the Page.

When a customer comments on a Facebook Page post, Jawab24 receives the comment and generates an automatic reply — either AI-powered or matched against user-configured template rules. The reply is then posted as a response to the original comment directly on the Facebook post.

This allows Page owners to:
- Automatically reply to customer comments on their Page posts
- Maintain fast response times without manual monitoring
- Use AI-generated or template-based replies to engage with customers

The app only responds to customer-initiated engagement. Jawab24 does not post unsolicited comments or promotional content.
```

### Video Captions (add these in order in iMovie/CapCut)

| # | What to do on screen | Caption text to display |
|---|---------------------|----------------------|
| 1 | Show `jawab24.com/en/login` (logged out) | "User visits Jawab24 login page" |
| 2 | Click "Login with Facebook" | "User clicks Login with Facebook" |
| 3 | Enter credentials on Facebook | "User authenticates with their Facebook account" |
| 4 | Permission dialog appears — zoom in, pause 3 seconds | "Facebook requests permission to manage Page engagement" |
| 5 | Click Continue / Allow | "User grants permission" |
| 6 | Jawab24 dashboard shows the connected Page — pause 4 seconds | "The Facebook Page is connected to Jawab24" |
| 7 | Switch to Facebook — comment on a Page post from a different account | "A customer comments on a post on the Facebook Page" |
| 8 | Switch back to Jawab24 → Comments page — comment appears | "Jawab24 receives the comment in the dashboard" |
| 9 | Show reply being generated and sent — pause 4 seconds | "Jawab24 generates an automatic reply and posts it to the comment" |
| 10 | Switch to Facebook — show the reply visible on the post — pause 4 seconds | "The automatic reply appears on the Facebook post" |

### API Test Call

**Status:** 0 of 1 required

**How to complete:** In Graph API Explorer, generate a Page Access Token with `pages_manage_engagement`, then run:

```
POST /{comment-id}/comments
Body: { "message": "Thank you for your comment!" }
```

Use a comment ID from your test Page post.

---

## 4. instagram_basic

### Submission Text (copy-paste this)

```
Jawab24 uses instagram_basic to access basic profile information and media data for connected Instagram Business accounts. This allows the app to identify the linked Instagram account, display the account name and profile in the dashboard, and correlate incoming comment and message webhooks with the correct business account.

We are requesting instagram_basic as a dependent permission for instagram_manage_messages and instagram_manage_comments.

How to test:
1. Go to https://jawab24.com/en/login
2. Click "Login with Facebook"
3. Connect a Facebook Page that has a linked Instagram Business Account
4. Go to the "My Pages" section — the linked Instagram account name and profile picture will appear under the connected Page

No Instagram credentials are needed — the reviewer connects via Facebook OAuth.
```

### Screencast Requirements (from Meta)

- Show how an Instagram professional account can connect to your app
- Show profile information like username, profile pic displayed in the app

### Video Captions (add these in order in iMovie/CapCut)

| # | What to do on screen | Caption text to display |
|---|---------------------|----------------------|
| 1 | Show `jawab24.com/en/login` (logged out) | "User visits Jawab24 login page" |
| 2 | Click "Login with Facebook" | "User clicks Login with Facebook" |
| 3 | Enter credentials on Facebook | "User authenticates with their Facebook account" |
| 4 | Permission dialog appears — zoom in, pause 3 seconds | "Facebook requests permission to access Instagram account info" |
| 5 | Click Continue / Allow | "User grants permission" |
| 6 | Jawab24 dashboard — My Pages shows the connected Page with Instagram account | "The linked Instagram Business Account appears in the dashboard" |
| 7 | Click on the Page to show Instagram username, profile pic, media — pause 4 seconds | "Jawab24 displays the Instagram account profile and media" |

### API Test Call

**How to complete:** In Graph API Explorer, generate a User Access Token with `instagram_basic`, then run:

```
GET /me/accounts?fields=instagram_business_account{name,username,profile_picture_url}
```

---

## 5. instagram_manage_comments

### Submission Text (copy-paste this)

```
Jawab24 uses instagram_manage_comments to read and reply to comments on Instagram Business account posts. When a customer comments on a post, Jawab24 receives a webhook notification, reads the comment, and automatically generates a reply using AI or user-configured template rules. The reply is posted directly on the Instagram post as a response.

This allows business owners to automatically respond to customer comments on Instagram without manual monitoring.

How to test:
1. Go to https://jawab24.com/en/login and connect a Facebook Page with a linked Instagram Business Account
2. Comment on any post from the connected Instagram Business Account using a different account
3. Any comment will trigger an automatic reply — no specific keywords needed
4. The reply appears on the Instagram post within 30 seconds
5. The comment and reply also appear in Jawab24's Comments dashboard

Post link for testing: [INSERT YOUR INSTAGRAM POST URL HERE]
```

### Screencast Requirements (from Meta)

- Show an Instagram user commenting on a post made by the connected Instagram professional account
- Show the Instagram professional account responding to the comment **within 30 seconds**
- Provide link to the post that has automation set up
- Provide any keywords or phrases the reviewer should use when commenting (or say "any comment")

### Video Captions (add these in order in iMovie/CapCut)

| # | What to do on screen | Caption text to display |
|---|---------------------|----------------------|
| 1 | Show `jawab24.com/en/login` (logged out) | "User visits Jawab24 login page" |
| 2 | Click "Login with Facebook" | "User clicks Login with Facebook" |
| 3 | Enter credentials on Facebook | "User authenticates with their Facebook account" |
| 4 | Permission dialog appears — zoom in, pause 3 seconds | "Facebook requests permission to manage Instagram comments" |
| 5 | Click Continue / Allow | "User grants permission" |
| 6 | Jawab24 dashboard shows the connected Page with Instagram — pause 4 seconds | "The Instagram Business Account is connected to Jawab24" |
| 7 | Switch to Instagram — comment on a post from a different account | "A customer comments on an Instagram post" |
| 8 | Switch back to Jawab24 → Comments page — Instagram comment appears | "Jawab24 receives the Instagram comment and displays it in the dashboard" |
| 9 | Show reply being generated and sent — pause 4 seconds | "Jawab24 generates an automatic reply and posts it to the Instagram comment" |
| 10 | Switch to Instagram — show the reply visible on the post — pause 4 seconds | "The automatic reply appears on the Instagram post" |

### API Test Call

**How to complete:** In Graph API Explorer, generate a Page Access Token with `instagram_manage_comments`, then run:

```
GET /{instagram-media-id}/comments
```

Use a media ID from your test Instagram Business Account.

---

## 6. instagram_manage_messages

### Submission Text (copy-paste this)

```
Jawab24 uses instagram_manage_messages to receive and respond to Instagram direct messages through the Instagram Graph API. When a customer sends a DM to a connected Instagram Business account, Jawab24 receives the message via webhook and displays it in the Messages dashboard. The app then generates an automatic reply — either AI-powered or matched against user-configured template rules — and sends it back as an Instagram DM.

This enables automatic AI-powered and template-based replies to customer DMs on Instagram Business accounts, providing consistent customer support across both Facebook and Instagram channels.

How to test:
1. Go to https://jawab24.com/en/login and connect a Facebook Page with a linked Instagram Business Account
2. From a different Instagram account, send a DM to the connected Business Account
3. The message appears in Jawab24's Messages dashboard
4. Jawab24 automatically generates and sends a reply within seconds
```

### Video Captions (add these in order in iMovie/CapCut)

| # | What to do on screen | Caption text to display |
|---|---------------------|----------------------|
| 1 | Show `jawab24.com/en/login` (logged out) | "User visits Jawab24 login page" |
| 2 | Click "Login with Facebook" | "User clicks Login with Facebook" |
| 3 | Enter credentials on Facebook | "User authenticates with their Facebook account" |
| 4 | Permission dialog appears — zoom in, pause 3 seconds | "Facebook requests permission to manage Instagram messages" |
| 5 | Click Continue / Allow | "User grants permission" |
| 6 | Jawab24 dashboard shows the connected Page with Instagram — pause 4 seconds | "The Instagram Business Account is connected to Jawab24" |
| 7 | Switch to Instagram — send a DM to the Business Account from a different account | "A customer sends a direct message to the Instagram Business Account" |
| 8 | Switch back to Jawab24 → Messages page — DM appears | "Jawab24 receives the Instagram message and displays it in the dashboard" |
| 9 | Show reply being generated and sent — pause 4 seconds | "Jawab24 generates an automatic reply and sends it as an Instagram DM" |
| 10 | Switch to Instagram — show the reply in the DM thread — pause 4 seconds | "The automatic reply appears in the Instagram DM conversation" |

### API Test Call

**How to complete:** In Graph API Explorer, generate a Page Access Token with `instagram_manage_messages`, then run:

```
GET /{instagram-business-account-id}/conversations
```

---

## Recording Rules Reminder

- **No audio** — captions only
- **English UI** — use `/en/` URLs
- **Resolution:** 1920x1080
- **Large cursor**, mouse clicks only (no keyboard shortcuts)
- **Start logged out**
- **Pause 2-3 seconds** on permission dialogs
- **Pause 3-4 seconds** on dashboard screens
- **One video per permission** — do NOT combine
- **Record with QuickTime Player** (Preferences > Show Mouse Clicks)
- **Add captions** in iMovie or CapCut after recording

### What NOT to show

- No API endpoints in captions (e.g., `POST /{page-id}/subscribed_apps`)
- No permission dependency explanations
- No Facebook Settings / Business Integrations pages
- Do not combine permissions into one video

---

## Submission Checklist

- [ ] Record video for `pages_read_engagement`
- [ ] Add captions to `pages_read_engagement` video
- [ ] Record video for `pages_read_user_content`
- [ ] Add captions to `pages_read_user_content` video
- [ ] Complete API test call for `pages_read_user_content` (GET /{post-id}/comments)
- [ ] Record video for `pages_manage_engagement`
- [ ] Add captions to `pages_manage_engagement` video
- [ ] Complete API test call for `pages_manage_engagement` (POST /{comment-id}/comments)
- [ ] Copy-paste submission text for all 3 Facebook permissions
- [ ] Check all agreement boxes for Facebook permissions
- [ ] Submit Facebook permissions

### Instagram Permissions

- [ ] Record video for `instagram_basic`
- [ ] Add captions to `instagram_basic` video
- [ ] Complete API test call for `instagram_basic`
- [ ] Record video for `instagram_manage_comments`
- [ ] Add captions to `instagram_manage_comments` video
- [ ] Complete API test call for `instagram_manage_comments`
- [ ] Record video for `instagram_manage_messages`
- [ ] Add captions to `instagram_manage_messages` video
- [ ] Complete API test call for `instagram_manage_messages`
- [ ] Copy-paste submission text for all 3 Instagram permissions
- [ ] Check all agreement boxes for Instagram permissions
- [ ] Submit Instagram permissions
