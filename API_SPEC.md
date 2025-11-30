# API Specification — Jawab24

## Base URL
```
https://jawab24.com/api
```

---

## Authentication
All endpoints require JWT token in header:
```
Authorization: Bearer <token>
```

---

## Endpoints

### 1. Auth

#### POST /auth/facebook
Login with Facebook OAuth
```json
Request:
{
  "accessToken": "fb_user_access_token"
}

Response:
{
  "token": "jwt_token",
  "fbAccessToken": "fb_user_access_token",
  "user": {
    "id": "user_id",
    "name": "User Name",
    "facebookId": "fb_id"
  }
}
```

---

### 2. Pages

#### GET /pages
Get user's Facebook pages
```json
Response:
[
  {
    "id": "page_id",
    "facebookPageId": "fb_page_id",
    "name": "Page Name",
    "autoReplyEnabled": true,
    "knowledgeBase": "Business info..."
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

Response:
{
  "success": true,
  "syncedCount": 5
}
```

#### PUT /pages/:id
Update page settings
```json
Request:
{
  "autoReplyEnabled": true,
  "knowledgeBase": "Business info for AI..."
}

Response:
{
  "id": "page_id",
  "autoReplyEnabled": true,
  "knowledgeBase": "..."
}
```

---

### 3. Templates

#### GET /templates
Get all reply templates
```json
Response:
[
  {
    "id": "template_id",
    "name": "Welcome Message",
    "translations": {
      "en": "Thank you!",
      "ar": "شكراً!"
    },
    "keywords": ["hello", "hi"],
    "active": true
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

Response:
{
  "id": "template_id",
  "success": true
}
```

#### PUT /templates/:id
Update template

#### DELETE /templates/:id
Delete template

---

### 4. Rules

#### GET /rules
Get all rules
```json
Response:
[
  {
    "id": "rule_id",
    "name": "Price Inquiry",
    "keywords": ["price", "cost"],
    "templateId": "template_id",
    "priority": 1,
    "active": true
  }
]
```

#### POST /rules
Create new rule

#### PUT /rules/:id
Update rule

#### DELETE /rules/:id
Delete rule

#### PUT /rules/:id/reorder
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
```json
Response:
[
  {
    "id": "comment_id",
    "postId": "post_id",
    "message": "Comment text",
    "fromName": "User Name",
    "fromId": "user_id",
    "createdTime": "2024-01-01T00:00:00Z",
    "replied": true,
    "replyText": "Reply content",
    "replyMethod": "template|ai|manual"
  }
]
```

---

### 6. Messages

#### GET /messages
Get direct messages
```json
Response:
[
  {
    "id": "message_id",
    "pageId": "page_id",
    "senderId": "user_id",
    "messageText": "Message content",
    "direction": "incoming|outgoing",
    "replied": true,
    "replyText": "Reply content",
    "replyMethod": "ai|template",
    "createdAt": "timestamp"
  }
]
```

---

### 7. Settings

#### GET /settings
Get user settings
```json
Response:
{
  "id": "settings_id",
  "dashboardLanguage": "en|ar",
  "defaultReplyLanguage": "ar",
  "autoDetectLanguage": true,
  "aiEnabled": true,
  "aiModel": "gpt-4-mini",
  "commentsAutoReply": true,
  "messagesAutoReply": true,
  "businessHoursOnly": false,
  "businessHoursStart": "09:00",
  "businessHoursEnd": "18:00",
  "awayMessage": "We are currently away...",
  "replyDelay": 0,
  "greetingMessage": "Hi there!..."
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
```

---

### 8. Webhooks

#### GET /webhook
Webhook verification

#### POST /webhook
Receive Facebook webhook events (feed, messages)
