# Multi-Language Database Schema

## Updated Schema for Unlimited Languages

### Templates (Multi-Language)

```sql
-- Main template table
CREATE TABLE templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  keywords TEXT[],
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Template translations (one row per language)
CREATE TABLE template_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES templates(id) ON DELETE CASCADE,
  language_code VARCHAR(10) NOT NULL,  -- 'en', 'ar', 'ar-sy', 'sv', etc.
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(template_id, language_code)
);

CREATE INDEX idx_template_translations_template_id ON template_translations(template_id);
CREATE INDEX idx_template_translations_language ON template_translations(language_code);
```

### Settings (Multi-Language)

```sql
-- User settings with language preferences
CREATE TABLE settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  dashboard_language VARCHAR(10) DEFAULT 'en',  -- UI language
  default_reply_language VARCHAR(10) DEFAULT 'ar',  -- Default for replies
  supported_languages TEXT[] DEFAULT ARRAY['en', 'ar'],  -- Languages this user supports
  auto_detect_language BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Comments (Track Language)

```sql
-- Track which language was detected and used
ALTER TABLE comments 
  ADD COLUMN detected_language VARCHAR(10),
  ADD COLUMN reply_language VARCHAR(10);

CREATE INDEX idx_comments_detected_language ON comments(detected_language);
```

---

## Supported Language Codes

### Arabic Dialects
- `ar` - Modern Standard Arabic (MSA)
- `ar-sy` - Syrian Arabic
- `ar-jo` - Jordanian Arabic
- `ar-lb` - Lebanese Arabic
- `ar-eg` - Egyptian Arabic
- `ar-gulf` - Gulf Arabic (UAE, Saudi, Kuwait)
- `ar-ma` - Moroccan Arabic
- `ar-iq` - Iraqi Arabic

### Other Languages
- `en` - English
- `sv` - Swedish
- `fr` - French
- `de` - German
- `es` - Spanish
- `tr` - Turkish
- `ku` - Kurdish
- `it` - Italian
- `pt` - Portuguese
- `nl` - Dutch
- `pl` - Polish
- `ru` - Russian

---

## Example Data

### Template with Multiple Languages

```sql
-- Create template
INSERT INTO templates (id, user_id, name, keywords) VALUES 
  ('t1', 'user123', 'Welcome Message', ARRAY['hello', 'hi', 'مرحبا', 'hej', 'bonjour']);

-- Add translations
INSERT INTO template_translations (template_id, language_code, content) VALUES
  ('t1', 'en', 'Thank you for your comment! How can we help?'),
  ('t1', 'ar', 'شكراً لتعليقك! كيف يمكننا مساعدتك؟'),
  ('t1', 'ar-sy', 'شكراً إلك! كيف فينا نساعدك؟'),
  ('t1', 'ar-jo', 'شكراً إلك! كيف ممكن نساعدك؟'),
  ('t1', 'sv', 'Tack för din kommentar! Hur kan vi hjälpa dig?'),
  ('t1', 'fr', 'Merci pour votre commentaire! Comment pouvons-nous vous aider?'),
  ('t1', 'tr', 'Yorumunuz için teşekkürler! Size nasıl yardımcı olabiliriz?');
```

### User Settings (Multi-Market)

```sql
-- Syrian user
INSERT INTO settings (user_id, dashboard_language, default_reply_language, supported_languages) VALUES
  ('user1', 'ar', 'ar-sy', ARRAY['ar-sy', 'en']);

-- Swedish user
INSERT INTO settings (user_id, dashboard_language, default_reply_language, supported_languages) VALUES
  ('user2', 'sv', 'sv', ARRAY['sv', 'en']);

-- Multi-language business (Lebanon)
INSERT INTO settings (user_id, dashboard_language, default_reply_language, supported_languages) VALUES
  ('user3', 'ar', 'ar-lb', ARRAY['ar-lb', 'fr', 'en']);
```

---

## Query Examples

### Get Template in Specific Language

```sql
-- Get template in Swedish
SELECT t.name, tr.content
FROM templates t
JOIN template_translations tr ON t.id = tr.template_id
WHERE t.id = 't1' AND tr.language_code = 'sv';
```

### Get Template with Fallback

```sql
-- Try to get Syrian Arabic, fallback to MSA, then English
SELECT content
FROM template_translations
WHERE template_id = 't1' 
  AND language_code IN ('ar-sy', 'ar', 'en')
ORDER BY 
  CASE language_code
    WHEN 'ar-sy' THEN 1
    WHEN 'ar' THEN 2
    WHEN 'en' THEN 3
  END
LIMIT 1;
```

### Get All Languages for a Template

```sql
SELECT language_code, content
FROM template_translations
WHERE template_id = 't1'
ORDER BY language_code;
```

---

## Migration from Current Schema

```sql
-- Step 1: Create new tables
CREATE TABLE template_translations (...);

-- Step 2: Migrate existing data
INSERT INTO template_translations (template_id, language_code, content)
SELECT id, 'en', content_en FROM templates WHERE content_en IS NOT NULL
UNION ALL
SELECT id, 'ar', content_ar FROM templates WHERE content_ar IS NOT NULL;

-- Step 3: Drop old columns (after verification)
ALTER TABLE templates DROP COLUMN content_en;
ALTER TABLE templates DROP COLUMN content_ar;
```

---

## Benefits

✅ **Unlimited languages** - Add as many as needed  
✅ **Dialect support** - ar-sy, ar-jo, ar-eg, etc.  
✅ **Easy expansion** - Just add new rows  
✅ **Fallback logic** - ar-sy → ar → en  
✅ **Per-user languages** - Each user chooses their markets  
✅ **Clean data model** - Normalized and scalable  
