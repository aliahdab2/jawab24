# Facebook Developer / Meta Setup — Jawab24

This document provides full instructions for configuring Meta (Facebook) for Jawab24.

---

---

## 0. Prerequisites: Verification (In Progress)

To pass Facebook App Review and gain Advanced Access for sensitive permissions (like managing page comments), you must verify your identity or business.

### Status: Company Registration
- **Type**: Enskild Näringsverksamhet (Sole Trader) + FA-tax
- **Registration Date**: 26 Dec 2025
- **Next Steps**:
  1. Wait for "Registreringsbevis" (Registration Certificate) from Bolagsverket/Skatteverket (1-2 weeks).
  2. Use this document to complete "Business Verification" in Meta Business Suite.
  3. Ensure your website footer says: "Operated by: [Your Name] (Org. nr: [Your Personal Number])" to match the registration.

---
## 1. Create Meta Developer Account

1. Go to https://developers.facebook.com
2. Log in with your Facebook account
3. Accept the developer terms

---

## 2. Create App

1. Click **"Create App"**
2. Select app type: **Business**
3. App name: `Jawab24` (or your preferred name)
4. Create or select a Business Portfolio
5. Click **"Create App"**

---

## 3. Add Products

In your app dashboard, add these products:

- ✅ **Facebook Login** - For user authentication
- ✅ **Webhooks** - For receiving comments/messages
- ✅ **Messenger** - For DM support (optional)

---

## 4. Configure Facebook Login

### Settings → Facebook Login → Settings

Enable:
- ✅ Client OAuth Login
- ✅ Web OAuth Login
- ✅ Enforce HTTPS

### Valid OAuth Redirect URIs:
```
https://jawab24.com/auth/callback
```

For local development, also add:
```
http://localhost:3001/auth/callback
```

---

## 5. Configure Webhooks

### Webhooks → Settings

**Callback URL:**
```
https://jawab24.com/webhook
```

**Verify Token:**
```
your_webhook_verify_token
```
(Set this in your `env/backend.env` as `FACEBOOK_WEBHOOK_VERIFY_TOKEN`)

### Subscribe to Fields:

For **Page** subscriptions:
- ✅ `feed` - Page post comments
- ✅ `messages` - Page inbox messages
- ✅ `messaging_postbacks` - Button clicks
- ✅ `message_deliveries` - Delivery receipts
- ✅ `message_reads` - Read receipts

---

## 6. Request Permissions

Go to **App Review → Permissions and Features**

Request **Advanced Access** for:

| Permission | Purpose |
|------------|---------|
| `pages_manage_engagement` | Reply to comments |
| `pages_read_engagement` | Read comments |
| `pages_manage_metadata` | Manage page settings |
| `pages_messaging` | Send/receive messages |
| `pages_read_user_content` | Read user posts/comments |
| `pages_show_list` | List user's pages |

---

## 7. App Review Submission

### Required Materials:

1. **Written Description** - Explain what your app does
2. **Screencast Video** showing:
   - User logs in with Facebook
   - User selects a page
   - User enables auto-reply
   - A comment is made on the page
   - App automatically replies

### Video Tips:
- Upload to YouTube (unlisted)
- 3-5 minutes is sufficient
- Show the full flow clearly
- Include voice narration

---

## 8. Privacy Policy & Terms

Add these URLs in **App Settings → Basic**:

| Field | URL |
|-------|-----|
| Privacy Policy | `https://jawab24.com/privacy` |
| Terms of Service | `https://jawab24.com/terms` |
| Data Deletion URL | `https://jawab24.com/api/auth/data-deletion` |

---

## 9. Domain Verification

1. Go to **App Settings → Advanced**
2. Add your domain: `jawab24.com`
3. Verify using one of:
   - DNS TXT record
   - HTML file upload
   - Meta tag

---

## 10. App Credentials

Copy these to your `env/backend.env`:

```bash
# From App Settings → Basic
FACEBOOK_APP_ID=your_app_id
FACEBOOK_APP_SECRET=your_app_secret

# Your custom webhook token
FACEBOOK_WEBHOOK_VERIFY_TOKEN=your_random_token

# OAuth redirect
FACEBOOK_REDIRECT_URI=https://jawab24.com/auth/callback
```

And to `env/frontend.env`:
```bash
NEXT_PUBLIC_FB_APP_ID=your_app_id
```

---

## 11. Go Live

After app review approval:

1. Go to **App Settings → Basic**
2. Toggle **App Mode** from "Development" to **"Live"**
3. Confirm the switch

---

## 12. Subscribe Pages to Webhooks

After a user connects their page, you need to subscribe it to webhooks:

```bash
# API call made by backend after page connection
POST https://graph.facebook.com/v18.0/{page-id}/subscribed_apps
?subscribed_fields=feed,messages,messaging_postbacks
&access_token={page-access-token}
```

This is handled automatically by the backend when users connect pages.

---

## Troubleshooting

### Webhook not receiving events
1. Check callback URL is accessible
2. Verify the verify token matches
3. Ensure page is subscribed to webhooks
4. Check App Mode is "Live"

### OAuth login failing
1. Verify redirect URI matches exactly
2. Check App ID and Secret are correct
3. Ensure required permissions are approved

### Comments not being replied
1. Check page access token is valid
2. Verify `pages_manage_engagement` permission
3. Check backend logs for errors

### Pages not appearing after login (Business Portfolio)
Facebook's `/me/accounts` returns an empty list for Pages owned by a Meta Business Portfolio, even when the user has "Facebook access with Full control" and all permissions are granted. Jawab24 handles this automatically: when `/me/accounts` is empty, `getUserPages` falls back to reading `granular_scopes` from `/debug_token` and fetches each authorized Page individually via `GET /{page-id}`.

If pages still don't appear, check backend logs for `[Facebook]` entries:
- `/me/accounts returned N pages` → primary path succeeded
- `/me/accounts empty, entering granular_scopes fallback` → fallback ran
- `Recovered page via fallback` (per page) → fallback succeeded
- `No page IDs in granular_scopes` → user didn't grant any Page during OAuth (reconnect + select pages)
- `Failed to fetch page via fallback` → per-page failure (check the `error` field)

---

## Useful Links

- [Meta Developer Dashboard](https://developers.facebook.com/apps)
- [Graph API Explorer](https://developers.facebook.com/tools/explorer)
- [Webhooks Documentation](https://developers.facebook.com/docs/graph-api/webhooks)
- [Page API Reference](https://developers.facebook.com/docs/pages)
