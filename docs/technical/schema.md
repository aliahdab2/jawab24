# Database Schema — Jawab24

> **WARNING: This document is significantly outdated (last updated ~2025).** The database now has 37+ tables. Missing tables: workspaces, workspaceMembers, workspaceInvites, otpCodes, refreshTokens, instagramMedia, instagramComments, conversationPauses, plans, subscriptions, ecommerceStores, leads, waitlistSubscribers, and more. Many existing tables have 10+ new fields (escalation, intent detection, workspace isolation, multilingual messages). See `backend/src/db/schema.ts` for the authoritative schema.

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
  knowledge_base TEXT, -- Business info for AI context
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
  detected_language VARCHAR(10), -- Auto-detected language
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
  -- Example: {"en": "Thank you!", "ar": "شكراً!"}
  keywords TEXT[], -- Array of keywords
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_templates_user_id ON templates(user_id);
CREATE INDEX idx_templates_translations ON templates USING GIN(translations);
CREATE INDEX idx_templates_keywords ON templates USING GIN(keywords);
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
  dashboard_language VARCHAR(10) DEFAULT 'ar',
  default_reply_language VARCHAR(10) DEFAULT 'ar',
  supported_languages TEXT[] DEFAULT ARRAY['en', 'ar'],
  auto_detect_language BOOLEAN DEFAULT true,
  ai_enabled BOOLEAN DEFAULT true,
  ai_model VARCHAR(100) DEFAULT 'gpt-4o-mini',
  
  -- Auto-reply Config
  comments_auto_reply BOOLEAN DEFAULT true,
  messages_auto_reply BOOLEAN DEFAULT true,
  business_hours_only BOOLEAN DEFAULT false,
  business_hours_start VARCHAR(5) DEFAULT '09:00',
  business_hours_end VARCHAR(5) DEFAULT '18:00',
  away_message TEXT,
  greeting_message TEXT,
  reply_delay INTEGER DEFAULT 0, -- seconds

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_settings_user_id ON settings(user_id);
```

---

### 8. messages (New)
```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID REFERENCES pages(id) ON DELETE CASCADE,
  facebook_message_id VARCHAR(255) UNIQUE NOT NULL,
  sender_id VARCHAR(255) NOT NULL,
  sender_name VARCHAR(255),
  message TEXT NOT NULL,
  direction VARCHAR(10) DEFAULT 'incoming', -- 'incoming', 'outgoing'
  replied BOOLEAN DEFAULT false,
  reply_text TEXT,
  reply_method VARCHAR(50), -- 'template', 'ai', 'manual'
  created_time TIMESTAMP,
  replied_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_messages_page_id ON messages(page_id);
CREATE INDEX idx_messages_sender_id ON messages(sender_id);
CREATE INDEX idx_messages_facebook_message_id ON messages(facebook_message_id);
CREATE INDEX idx_messages_direction ON messages(direction);
```

---

### 9. ai_cache
```sql
CREATE TABLE ai_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_hash VARCHAR(64) UNIQUE NOT NULL,
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

### 10. logs
```sql
CREATE TABLE logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  page_id UUID REFERENCES pages(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  action VARCHAR(100),
  status VARCHAR(50), -- 'success', 'error', 'pending'
  message TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_logs_user_id ON logs(user_id);
CREATE INDEX idx_logs_created_at ON logs(created_at DESC);
CREATE INDEX idx_logs_action ON logs(action);
```
