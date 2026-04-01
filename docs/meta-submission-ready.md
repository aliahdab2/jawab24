# Meta App Review — Ready-to-Submit Guide

**App ID:** 774211662298446
**Submission date:** April 1, 2026
**Permissions to submit:** `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement`, `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages`

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

## 4. instagram_business_basic

### Submission Text (copy-paste this)

```
Jawab24 uses the instagram_business_basic permission to read the profile information and media of Instagram Business Accounts that are linked to connected Facebook Pages.

When a user connects their Facebook Page to Jawab24, the app detects any linked Instagram Business Account and displays it in the dashboard. Jawab24 reads the Instagram account name, profile picture, and media posts so the user can monitor and manage their Instagram engagement alongside their Facebook Page.

This allows Page owners to:
- See their linked Instagram Business Account in the Jawab24 dashboard
- View Instagram media posts that customers are engaging with
- Monitor comments across both Facebook and Instagram from one place

The app only accesses Instagram accounts that are linked to Pages the user has explicitly connected. No data is stored beyond what is needed to display in the dashboard.
```

### Video Captions (add these in order in iMovie/CapCut)

| # | What to do on screen | Caption text to display |
|---|---------------------|----------------------|
| 1 | Show `jawab24.com/en/login` (logged out) | "User visits Jawab24 login page" |
| 2 | Click "Login with Facebook" | "User clicks Login with Facebook" |
| 3 | Enter credentials on Facebook | "User authenticates with their Facebook account" |
| 4 | Permission dialog appears — zoom in, pause 3 seconds | "Facebook requests permission to access Instagram account info" |
| 5 | Click Continue / Allow | "User grants permission" |
| 6 | Jawab24 dashboard — My Pages shows the connected Page with Instagram account | "The linked Instagram Business Account appears in the dashboard" |
| 7 | Click on the Page to show Instagram media/details — pause 4 seconds | "Jawab24 displays the Instagram account profile and media" |

### API Test Call

**How to complete:** In Graph API Explorer, generate a User Access Token with `instagram_business_basic`, then run:

```
GET /me/accounts?fields=instagram_business_account{name,username,profile_picture_url}
```

---

## 5. instagram_business_manage_comments

### Submission Text (copy-paste this)

```
Jawab24 uses the instagram_business_manage_comments permission to read and reply to comments on Instagram Business Account media posts.

When a customer comments on an Instagram post, Jawab24 receives a webhook notification and reads the comment content. The comment is displayed in the Jawab24 dashboard, and the app generates an automatic reply — either AI-powered or matched against user-configured template rules. The reply is posted directly on the Instagram post as a response to the customer's comment.

This allows Page owners to:
- Read customer comments on their Instagram posts in real time
- View Instagram comments in a centralized dashboard alongside Facebook comments
- Automatically reply to Instagram comments using AI or template-based replies

The app only reads and replies to comments on media owned by Instagram accounts the user has explicitly connected. Jawab24 does not post unsolicited comments.
```

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

**How to complete:** In Graph API Explorer, generate a Page Access Token with `instagram_business_manage_comments`, then run:

```
GET /{instagram-media-id}/comments
```

Use a media ID from your test Instagram Business Account.

---

## 6. instagram_business_manage_messages

### Submission Text (copy-paste this)

```
Jawab24 uses the instagram_business_manage_messages permission to read and reply to direct messages sent to Instagram Business Accounts that are linked to connected Facebook Pages.

When a customer sends a direct message to the Instagram Business Account, Jawab24 receives the message via webhook and displays it in the Messages section of the dashboard. The app then generates an automatic reply — either AI-powered or matched against user-configured template rules — and sends it back to the customer as an Instagram DM.

This allows Page owners to:
- Receive Instagram direct messages in the Jawab24 dashboard
- Automatically reply to customer DMs using AI or template-based replies
- Manage Instagram and Facebook messages from a single inbox

The app only responds to customer-initiated messages within Instagram's 24-hour messaging window. Jawab24 does not send unsolicited messages.
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

**How to complete:** In Graph API Explorer, generate a Page Access Token with `instagram_business_manage_messages`, then run:

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

- [ ] Record video for `instagram_business_basic`
- [ ] Add captions to `instagram_business_basic` video
- [ ] Complete API test call for `instagram_business_basic`
- [ ] Record video for `instagram_business_manage_comments`
- [ ] Add captions to `instagram_business_manage_comments` video
- [ ] Complete API test call for `instagram_business_manage_comments`
- [ ] Record video for `instagram_business_manage_messages`
- [ ] Add captions to `instagram_business_manage_messages` video
- [ ] Complete API test call for `instagram_business_manage_messages`
- [ ] Copy-paste submission text for all 3 Instagram permissions
- [ ] Check all agreement boxes for Instagram permissions
- [ ] Submit Instagram permissions
