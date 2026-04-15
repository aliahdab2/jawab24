# API Specification — Jawab24

> **WARNING: This document is significantly outdated (last updated ~2025).** The backend now has 31 route files with 20+ endpoint groups not listed here. Missing: phone OTP auth, workspace management, e-commerce integrations (Shopify/Salla/Zid), leads, admin panel, waitlist, voice, customer notifications, SSE, analytics, subscriptions, and more. New response fields (needsAttention, flagReason, aiIntent, resolved) exist on comments and messages. See `backend/src/routes/` for current endpoints.

## Base URL
```
Production: https://jawab24.com/api
Development: http://localhost:3000
```

---

## Authentication

All endpoints (except `/auth/*` and `/webhook`) require JWT token in header:
```
Authorization: Bearer <token>
```

---

## Health Check

### GET /health
Check API health status

```json
Response: 200 OK
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

## Endpoints

### 1. Authentication

#### POST /auth/facebook
Login/Register with Facebook OAuth

```json
Request:
{
  "accessToken": "fb_user_access_token"
}

Response: 200 OK
{
  "token": "jwt_token",
  "fbAccessToken": "fb_user_access_token",
  "user": {
    "id": "uuid",
    "name": "User Name",
    "facebookId": "fb_id"
  }
}
```

---

### 2. Pages

#### GET /pages
Get user's connected Facebook pages

```json
Response: 200 OK
[
  {
    "id": "uuid",
    "facebookPageId": "fb_page_id",
    "name": "Page Name",
    "autoReplyEnabled": true,
    "knowledgeBase": "Business info...",
    "commentsCount": 150,
    "repliesCount": 120,
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
]
```

#### POST /pages/sync
Sync pages from Facebook

```json
Request:
{
  "accessToken": "fb_user_access_token"
}

Response: 200 OK
{
  "success": true,
  "syncedCount": 5,
  "pages": [...]
}
```

#### PUT /pages/:id
Update page settings

```json
Request:
{
  "autoReplyEnabled": true,
  "knowledgeBase": "Business info for AI context..."
}

Response: 200 OK
{
  "id": "uuid",
  "autoReplyEnabled": true,
  "knowledgeBase": "..."
}
```

---

### 3. Templates

#### GET /templates
Get all reply templates

```json
Response: 200 OK
[
  {
    "id": "uuid",
    "name": "Welcome Message",
    "translations": {
      "en": "Thank you for your message!",
      "ar": "شكراً لرسالتك!"
    },
    "keywords": ["hello", "hi", "مرحبا"],
    "active": true,
    "usageCount": 45
  }
]
```

#### POST /templates
Create new template

```json
Request:
{
  "name": "Template Name",
  "translations": {
    "en": "English content",
    "ar": "Arabic content"
  },
  "keywords": ["keyword1", "keyword2"]
}

Response: 201 Created
{
  "id": "uuid",
  "name": "Template Name",
  ...
}
```

#### PUT /templates/:id
Update template

#### DELETE /templates/:id
Delete template

---

### 4. Rules

#### GET /rules
Get all automation rules (sorted by priority)

```json
Response: 200 OK
[
  {
    "id": "uuid",
    "name": "Price Inquiry",
    "keywords": ["price", "cost", "كم السعر"],
    "templateId": "template_uuid",
    "priority": 1,
    "active": true,
    "matchCount": 28
  }
]
```

#### POST /rules
Create new rule

```json
Request:
{
  "name": "Rule Name",
  "keywords": ["keyword1", "keyword2"],
  "templateId": "template_uuid"
}

Response: 201 Created
{
  "id": "uuid",
  ...
}
```

#### PUT /rules/:id
Update rule

#### DELETE /rules/:id
Delete rule

#### PUT /rules/:id/priority
Update rule priority

```json
Request:
{
  "priority": 2
}
```

---

### 5. Comments

#### GET /comments
Get recent comments

Query params:
- `pageId` - Filter by page
- `replied` - Filter by replied status (true/false)
- `limit` - Number of results (default: 50)

```json
Response: 200 OK
[
  {
    "id": "uuid",
    "postId": "post_uuid",
    "facebookCommentId": "fb_comment_id",
    "message": "Comment text",
    "fromName": "User Name",
    "fromId": "fb_user_id",
    "replied": true,
    "replyText": "Reply content",
    "replyMethod": "template",
    "detectedLanguage": "ar",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
]
```

---

### 6. Messages

#### GET /messages
Get direct messages

Query params:
- `pageId` - Filter by page
- `senderId` - Filter by sender

```json
Response: 200 OK
[
  {
    "id": "uuid",
    "pageId": "page_uuid",
    "facebookMessageId": "fb_message_id",
    "senderId": "fb_user_id",
    "senderName": "User Name",
    "message": "Message content",
    "direction": "incoming",
    "replied": true,
    "replyText": "Reply content",
    "replyMethod": "ai",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
]
```

---

### 7. Settings

#### GET /settings
Get user settings

```json
Response: 200 OK
{
  "id": "uuid",
  "userId": "user_uuid",
  "dashboardLanguage": "ar",
  "defaultReplyLanguage": "ar",
  "autoDetectLanguage": true,
  "aiEnabled": true,
  "commentsAutoReply": true,
  "messagesAutoReply": true,
  "businessHoursOnly": false,
  "businessHoursStart": "09:00",
  "businessHoursEnd": "18:00",
  "awayMessage": "We are currently away...",
  "greetingMessage": "Hi there!",
  "replyDelay": 0
}
```

#### PUT /settings
Update settings

```json
Request:
{
  "aiEnabled": true,
  "commentsAutoReply": true,
  "messagesAutoReply": true,
  "replyDelay": 5,
  ...
}

Response: 200 OK
{
  ... updated settings
}
```

---

### 8. AI

#### POST /ai/generate
Generate AI reply (internal use)

```json
Request:
{
  "message": "Customer message",
  "pageId": "page_uuid",
  "context": "optional context"
}

Response: 200 OK
{
  "reply": "AI generated reply",
  "language": "ar",
  "cached": false
}
```

---

### 9. Webhooks

#### GET /webhook
Facebook webhook verification

Query params:
- `hub.mode` - Should be "subscribe"
- `hub.verify_token` - Your verify token
- `hub.challenge` - Challenge to return

#### POST /webhook
Receive Facebook webhook events

```json
Request (from Facebook):
{
  "object": "page",
  "entry": [
    {
      "id": "page_id",
      "time": 1234567890,
      "changes": [
        {
          "field": "feed",
          "value": {
            "item": "comment",
            "verb": "add",
            "comment_id": "comment_id",
            "post_id": "post_id",
            "message": "Comment text"
          }
        }
      ]
    }
  ]
}

Response: 200 OK
"EVENT_RECEIVED"
```

---

## Error Responses

### 400 Bad Request
```json
{
  "error": "Validation error",
  "message": "Invalid request body",
  "details": [...]
}
```

### 401 Unauthorized
```json
{
  "error": "Unauthorized",
  "message": "Invalid or expired token"
}
```

### 404 Not Found
```json
{
  "error": "Not Found",
  "message": "Resource not found"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal Server Error",
  "message": "Something went wrong"
}
```

---

## Rate Limiting

| Endpoint | Limit |
|----------|-------|
| `/api/*` | 10 requests/second |
| `/webhook` | 100 requests/second |

Rate limit headers:
```
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 9
X-RateLimit-Reset: 1234567890
```

---

## Shared Types

All types are defined in `@jawab24/shared`:

```typescript
import type { 
  Message, 
  Comment, 
  Page, 
  Template, 
  Rule,
  DashboardStats 
} from '@jawab24/shared';
```
