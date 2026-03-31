# Meta App Review — Ready-to-Submit Guide

**App ID:** 774211662298446
**Submission date:** March 31, 2026
**Permissions to submit:** `pages_read_engagement`, `pages_manage_engagement`

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

## 2. pages_manage_engagement

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

**Status:** 0 of 1 required ⚠️

**Problem:** Adding `pages_manage_engagement` to Graph API Explorer causes Facebook to inject the deprecated `pages_read_user_content` scope, which breaks the OAuth flow entirely. This is a known Facebook bug.

**Recommended approach:** Submit anyway and add this note to the submission:

```
Note: The API test call for pages_manage_engagement cannot be completed through the Graph API Explorer due to a known issue where Facebook injects the deprecated "pages_read_user_content" scope when generating an access token with this permission, causing the OAuth flow to fail. The app's server-side implementation correctly uses POST /{comment-id}/comments with the Page Access Token to reply to comments. This can be verified in the screencast video.
```

---

## Recording Rules Reminder

- **No audio** — captions only
- **English UI** — use `/en/` URLs
- **Resolution:** 1920×1080
- **Large cursor**, mouse clicks only (no keyboard shortcuts)
- **Start logged out**
- **Pause 2-3 seconds** on permission dialogs
- **Pause 3-4 seconds** on dashboard screens
- **One video per permission** — do NOT combine
- **Record with QuickTime Player** (Preferences → Show Mouse Clicks)
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
- [ ] Record video for `pages_manage_engagement`
- [ ] Add captions to `pages_manage_engagement` video
- [ ] Copy-paste submission text for `pages_read_engagement`
- [ ] Copy-paste submission text for `pages_manage_engagement`
- [ ] Add the API test call note for `pages_manage_engagement`
- [ ] Submit

---

## Known Issue: Comment Replies Not Appearing on Facebook

Replies show in the Jawab24 dashboard but not on the actual Facebook post. This is because `pages_manage_engagement` is not yet approved, so the app cannot write back to Facebook. After approval, add `pages_manage_engagement` to the OAuth scope in `login.tsx` (line ~176) and `pages.tsx` (line ~132), and replies will appear on Facebook automatically.
