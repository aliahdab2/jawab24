# Database Schema — AutoReply.AI

## PostgreSQL Tables

---

### 1. users
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facebook_id VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  email VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

### 2. pages
```sql
CREATE TABLE pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  facebook_page_id VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  access_token TEXT NOT NULL,
  auto_reply_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_pages_user_id ON pages(user_id);
CREATE INDEX idx_pages_facebook_page_id ON pages(facebook_page_id);
```

---

### 3. posts
```sql
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID REFERENCES pages(id) ON DELETE CASCADE,
  facebook_post_id VARCHAR(255) UNIQUE NOT NULL,
  message TEXT,
  auto_reply_enabled BOOLEAN DEFAULT true,
  created_time TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_posts_page_id ON posts(page_id);
CREATE INDEX idx_posts_facebook_post_id ON posts(facebook_post_id);
```

---

### 4. comments
```sql
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  facebook_comment_id VARCHAR(255) UNIQUE NOT NULL,
  message TEXT NOT NULL,
  from_id VARCHAR(255),
  from_name VARCHAR(255),
  replied BOOLEAN DEFAULT false,
  reply_text TEXT,
  reply_method VARCHAR(50), -- 'template', 'ai', 'manual'
  template_id UUID REFERENCES templates(id),
  detected_language VARCHAR(10), -- Auto-detected language: 'en', 'ar', 'ar-sy', 'sv', etc.
  reply_language VARCHAR(10), -- Language used in reply
  created_time TIMESTAMP,
  replied_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_comments_post_id ON comments(post_id);
CREATE INDEX idx_comments_facebook_comment_id ON comments(facebook_comment_id);
CREATE INDEX idx_comments_replied ON comments(replied);
CREATE INDEX idx_comments_detected_language ON comments(detected_language);
```

---

### 5. templates
```sql
CREATE TABLE templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  translations JSONB NOT NULL DEFAULT '{}',
  -- Example: {"en": "Thank you!", "ar": "شكراً!", "ar-sy": "شكراً إلك!", "sv": "Tack!"}
  keywords TEXT[], -- Array of keywords in all languages
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_templates_user_id ON templates(user_id);
CREATE INDEX idx_templates_translations ON templates USING GIN(translations);
CREATE INDEX idx_templates_keywords ON templates USING GIN(keywords);

-- Constraint: Ensure at least one translation exists
ALTER TABLE templates ADD CONSTRAINT templates_has_translation 
  CHECK (jsonb_typeof(translations) = 'object' AND translations != '{}');
```

---

### 6. rules
```sql
CREATE TABLE rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  keywords TEXT[], -- Array of keywords
  template_id UUID REFERENCES templates(id) ON DELETE SET NULL,
  priority INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_rules_user_id ON rules(user_id);
CREATE INDEX idx_rules_keywords ON rules USING GIN(keywords);
CREATE INDEX idx_rules_priority ON rules(priority DESC);
```

---

### 7. settings
```sql
CREATE TABLE settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  dashboard_language VARCHAR(10) DEFAULT 'en', -- UI language: 'en', 'ar', 'sv', etc.
  default_reply_language VARCHAR(10) DEFAULT 'ar', -- Default language for replies
  supported_languages TEXT[] DEFAULT ARRAY['en', 'ar'], -- Languages this user supports
  auto_detect_language BOOLEAN DEFAULT true, -- Auto-detect comment language
  ai_enabled BOOLEAN DEFAULT true,
  ai_model VARCHAR(100) DEFAULT 'gpt-4-mini',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_settings_user_id ON settings(user_id);
```

---

### 8. ai_cache
```sql
CREATE TABLE ai_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_hash VARCHAR(64) UNIQUE NOT NULL, -- MD5 or SHA256 of normalized comment
  reply_text TEXT NOT NULL,
  language VARCHAR(10),
  hit_count INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_ai_cache_comment_hash ON ai_cache(comment_hash);
CREATE INDEX idx_ai_cache_last_used ON ai_cache(last_used_at);
```

---

### 9. logs
```sql
CREATE TABLE logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  page_id UUID REFERENCES pages(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  action VARCHAR(100), -- 'webhook_received', 'reply_sent', 'ai_called', etc.
  status VARCHAR(50), -- 'success', 'error', 'pending'
  message TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_logs_user_id ON logs(user_id);
CREATE INDEX idx_logs_created_at ON logs(created_at DESC);
CREATE INDEX idx_logs_action ON logs(action);
```

---

## Redis Keys

### Cache Keys
```
comment:hash:<hash>:<language> -> cached AI reply (language-specific)
user:token:<user_id> -> JWT token data
page:token:<page_id> -> encrypted page access token
```

### Queue Keys
```
queue:ai:pending -> List of pending AI jobs
queue:ai:processing -> Set of processing jobs
queue:ai:failed -> List of failed jobs
```

### Job Format
```json
{
  "id": "job_id",
  "comment_id": "comment_id",
  "post_id": "post_id",
  "page_id": "page_id",
  "message": "Comment text",
  "detected_language": "ar-sy",
  "reply_language": "ar-sy",
  "created_at": "timestamp"
}
```

---

## Multi-Language Query Examples

### Get Template in Specific Language (with fallback)

```sql
-- Get template in Syrian Arabic, fallback to MSA, then English
SELECT 
  name,
  COALESCE(
    translations->>'ar-sy',
    translations->>'ar',
    translations->>'en'
  ) as content
FROM templates
WHERE id = 'template_id';
```

### Get All Languages for a Template

```sql
SELECT 
  id,
  name,
  jsonb_object_keys(translations) as available_languages
FROM templates
WHERE id = 'template_id';
```

### Find Templates with Specific Language

```sql
-- Find all templates that have Swedish translation
SELECT id, name, translations->>'sv' as swedish_content
FROM templates
WHERE user_id = 'user_id'
  AND translations ? 'sv'
  AND active = true;
```

### Language Usage Analytics

```sql
-- Most common languages in comments
SELECT 
  detected_language,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM comments
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY detected_language
ORDER BY count DESC;
```

### Add Translation to Existing Template

```sql
-- Add Swedish translation
UPDATE templates
SET translations = translations || '{"sv": "Tack för din kommentar!"}'::jsonb,
    updated_at = NOW()
WHERE id = 'template_id';
```

---

## Indexes Summary

- All foreign keys are indexed
- GIN indexes for array fields (keywords, supported_languages)
- GIN index for JSONB translations (enables fast language lookups)
- Timestamp indexes for sorting
- Unique indexes for Facebook IDs
- Hash index for AI cache lookups
- Language indexes for analytics (detected_language, reply_language)

---

## Supported Languages

The system supports unlimited languages using ISO 639-1 codes with optional region codes:

### Common Languages
- `en` - English
- `ar` - Arabic (Modern Standard)
- `ar-sy` - Syrian Arabic
- `ar-jo` - Jordanian Arabic
- `ar-lb` - Lebanese Arabic
- `ar-eg` - Egyptian Arabic
- `sv` - Swedish
- `fr` - French
- `de` - German
- `es` - Spanish
- `tr` - Turkish

### Adding New Languages
Simply add new key-value pairs to the `translations` JSONB field. No schema changes required.
