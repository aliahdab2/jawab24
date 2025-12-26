# Instagram Integration Setup Guide

## Overview

Jawab24 supports Instagram Business Accounts that are linked to Facebook Pages. This integration uses the Instagram Graph API through the Facebook/Meta platform.

## Prerequisites

1. **Instagram Business Account** - Your Instagram must be a Business or Creator account
2. **Facebook Page** - Your Instagram must be linked to a Facebook Page
3. **Facebook App** - Must have the required permissions approved

## Required Facebook App Permissions

Add these permissions to your Facebook App in the [Meta Developer Console](https://developers.facebook.com/):

### Basic Permissions (Already Added)
- `pages_show_list` - List pages you manage
- `pages_read_engagement` - Read page content and comments
- `pages_manage_posts` - Create and manage posts
- `pages_messaging` - Send and receive messages

### Instagram Permissions (NEW - Add These)

| Permission | Purpose | Approval Required |
|------------|---------|-------------------|
| `instagram_basic` | Read Instagram account info and media | Yes |
| `instagram_manage_comments` | Read and reply to comments | Yes |
| `instagram_manage_messages` | Read and send Instagram DMs | Yes |
| `instagram_content_publish` | Post content to Instagram | Optional |

## How to Add Instagram Permissions

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Select your app (Jawab24)
3. Go to **App Review** → **Permissions and Features**
4. Search for each permission above and click **Request**
5. Follow the review process (may require video walkthrough)

## Linking Instagram to Facebook Page

Users must link their Instagram Business Account to their Facebook Page:

1. Open your **Facebook Page**
2. Go to **Settings** → **Linked Accounts**
3. Click **Instagram** → **Connect Account**
4. Follow the prompts to link your Instagram Business Account

## Webhook Configuration

Add Instagram webhook subscriptions:

1. Go to your app's **Webhooks** settings
2. Add a new subscription for `instagram`
3. Subscribe to these fields:
   - `comments` - New comments on posts
   - `mentions` - When account is mentioned
   - `messages` - Direct messages (optional)

### Webhook URL
```
https://jawab24.com/api/webhook
```

### Verify Token
Use the same verify token as your Facebook webhook.

## Database Migration

Run the Instagram migration on your server:

```bash
psql -d jawab24 -f backend/drizzle/0002_add_instagram_support.sql
```

## Testing

1. Log in to Jawab24
2. Go to **My Pages**
3. Click **Connect New Page** to sync
4. Your Instagram account should appear under the page if linked

## Troubleshooting

### Instagram not showing up?
- Ensure your Instagram is a Business/Creator account
- Check it's linked to the Facebook Page in Facebook Settings
- Verify `instagram_basic` permission is granted

### Comments not being captured?
- Check `instagram_manage_comments` permission
- Verify webhook is receiving Instagram events
- Check server logs for Instagram webhook errors

### Can't reply to DMs?
- Instagram DMs require the user to message you first
- Check `instagram_manage_messages` permission
- There's a 24-hour messaging window limitation

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/instagram/:pageId/media` | GET | Get Instagram media for a page |
| `/instagram/media/:mediaId/comments` | GET | Get comments on media |
| `/instagram/comments/:commentId/reply` | POST | Reply to a comment |
| `/instagram/:pageId/sync` | POST | Sync media and comments |
| `/pages/:id/instagram-auto-reply` | PATCH | Toggle Instagram auto-reply |

## Rate Limits

Instagram API has stricter rate limits than Facebook:
- 200 calls per user per hour
- 4,800 calls per app per 24 hours

The application handles rate limiting automatically.

