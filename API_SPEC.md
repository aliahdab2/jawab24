# API Specification — AutoReply.AI

## Base URL
```
https://api.autoreply.ai/v1
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
  "code": "facebook_oauth_code"
}

Response:
{
  "token": "jwt_token",
  "user": {
    "id": "user_id",
    "name": "User Name",
    "facebook_id": "fb_id"
  }
}
```

---

### 2. Pages

#### GET /pages
Get user's Facebook pages
```json
Response:
{
  "pages": [
    {
      "id": "page_id",
      "name": "Page Name",
      "access_token": "encrypted_token",
      "auto_reply_enabled": true
    }
  ]
}
```

#### POST /pages/:id/toggle
Enable/disable auto-reply for a page
```json
Request:
{
  "enabled": true
}

Response:
{
  "success": true,
  "enabled": true
}
```

---

### 3. Posts

#### GET /pages/:pageId/posts
Get posts from a page
```json
Response:
{
  "posts": [
    {
      "id": "post_id",
      "message": "Post content",
      "created_time": "2024-01-01T00:00:00Z",
      "auto_reply_enabled": true,
      "comments_count": 10
    }
  ]
}
```

#### POST /posts/:id/toggle
Enable/disable auto-reply for a post
```json
Request:
{
  "enabled": true
}

Response:
{
  "success": true
}
```

---

### 4. Templates

#### GET /templates
Get all reply templates
```json
Response:
{
  "templates": [
    {
      "id": "template_id",
      "name": "Welcome Message",
      "content_en": "Thank you for your comment!",
      "content_ar": "شكراً لتعليقك!",
      "keywords": ["hello", "hi", "مرحبا"],
      "active": true
    }
  ]
}
```

#### POST /templates
Create new template
```json
Request:
{
  "name": "Template Name",
  "content_en": "English content",
  "content_ar": "Arabic content",
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

### 5. Rules

#### GET /rules
Get all rules
```json
Response:
{
  "rules": [
    {
      "id": "rule_id",
      "name": "Price Inquiry",
      "keywords": ["price", "cost", "سعر"],
      "template_id": "template_id",
      "priority": 1,
      "active": true
    }
  ]
}
```

#### POST /rules
Create new rule

#### PUT /rules/:id
Update rule

#### DELETE /rules/:id
Delete rule

---

### 6. Comments

#### GET /comments
Get recent comments
```json
Response:
{
  "comments": [
    {
      "id": "comment_id",
      "post_id": "post_id",
      "message": "Comment text",
      "from": {
        "name": "User Name",
        "id": "user_id"
      },
      "created_time": "2024-01-01T00:00:00Z",
      "replied": true,
      "reply_text": "Reply content",
      "reply_method": "template|ai"
    }
  ]
}
```

---

### 7. Webhooks

#### GET /webhook/facebook
Webhook verification

#### POST /webhook/facebook
Receive Facebook webhook events
```json
Request:
{
  "object": "page",
  "entry": [
    {
      "id": "page_id",
      "time": 1234567890,
      "changes": [
        {
          "value": {
            "item": "comment",
            "comment_id": "comment_id",
            "post_id": "post_id",
            "message": "Comment text",
            "from": {
              "id": "user_id",
              "name": "User Name"
            }
          }
        }
      ]
    }
  ]
}
```

---

### 8. Settings

#### GET /settings
Get user settings
```json
Response:
{
  "language": "en|ar",
  "ai_enabled": true,
  "ai_model": "gpt-4-mini",
  "default_language": "ar"
}
```

#### PUT /settings
Update settings

---

### 9. Stats

#### GET /stats
Get usage statistics
```json
Response:
{
  "total_comments": 1000,
  "total_replies": 950,
  "template_replies": 600,
  "ai_replies": 350,
  "today": {
    "comments": 50,
    "replies": 48
  }
}
```

---

## Error Responses

```json
{
  "error": true,
  "message": "Error description",
  "code": "ERROR_CODE"
}
```

### Error Codes
- `AUTH_FAILED` - Authentication failed
- `INVALID_TOKEN` - Invalid or expired token
- `PERMISSION_DENIED` - Insufficient permissions
- `NOT_FOUND` - Resource not found
- `VALIDATION_ERROR` - Invalid input data
- `RATE_LIMIT` - Rate limit exceeded
- `FACEBOOK_API_ERROR` - Facebook API error
- `AI_SERVICE_ERROR` - AI service error
