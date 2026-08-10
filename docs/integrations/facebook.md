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

### Pages not appearing after login (Business Portfolio / New Pages Experience)
**`/me/accounts` is not the authorization truth.** For Pages owned by a Meta Business
Portfolio or on the New Pages Experience it can omit granted Pages — returning an empty
list, or (the case that cost a full support night on 2026-08-09) a **partial** one: the
merchant granted two Pages, `/me/accounts` listed only the older one, and the newly
granted Page was invisible to every sync no matter how often he reconnected.

`getUserPages` therefore always reconciles: it diffs `/me/accounts` against the token's
`granular_scopes` (from `/debug_token`) and fetches every omitted Page individually via
`GET /{page-id}`, returning the **union**. Treating this as a fallback that only ran when
`/me/accounts` came back EMPTY is exactly what hid the partial case. Reconciliation is
best-effort: if `/debug_token` fails while `/me/accounts` did return Pages, the primary
list is returned unchanged rather than failing the sync (a thrown sync would read as
"the user revoked everything" to the revoke step).

If pages still don't appear, check backend logs for `[Facebook]` entries:
- `/me/accounts returned N pages` → primary path result (N may be short — see below)
- `granular_scopes lists pages missing from /me/accounts` → reconciliation kicked in; the log names the missing page IDs
- `Recovered page missing from /me/accounts` (per page) → reconciliation succeeded
- `granular_scopes lookup failed — returning /me/accounts result as-is` → `/debug_token` hiccup, degraded to the primary list
- `Reconciled page missing access_token — skipping` → the user lacks `pages_read_engagement` on that specific Page
- `Failed to fetch page missing from /me/accounts` → per-page failure (check the `error` field)

**Diagnosing a "my page won't connect" report:** read the merchant's grant, not our DB.
`/debug_token` on their stored user token lists `granular_scopes.pages_show_list.target_ids`
— that is what Meta says they authorized. If the wanted Page ID is there, the grant is
fine and the problem is on our side; if it is absent, they never completed the Meta dialog
for that Page. ⚠️ A New-Pages-Experience Page has TWO ids: the `profile.php?id=…` URL shows
a delegate id that Graph cannot resolve, while the real Page ID (the one in
`granular_scopes` and in Meta's permission dialog) is different — never conclude "not a
Page" from the URL id failing a Graph lookup.

---

## Useful Links

- [Meta Developer Dashboard](https://developers.facebook.com/apps)
- [Graph API Explorer](https://developers.facebook.com/tools/explorer)
- [Webhooks Documentation](https://developers.facebook.com/docs/graph-api/webhooks)
- [Page API Reference](https://developers.facebook.com/docs/pages)
