# Multi-Language Best Practices — AutoReply.AI

## Recommended Approach: JSONB

After evaluating industry standards and your specific use case, **JSONB is the best approach** for AutoReply.AI.

---

## 📊 Why JSONB?

### ✅ Advantages for Your Use Case

1. **Simplicity**
   - One table, no joins
   - Easier to understand and maintain
   - Less code complexity

2. **Flexibility**
   - Add languages without schema changes
   - Each template can have different languages
   - Easy to handle partial translations

3. **Performance**
   - PostgreSQL JSONB is indexed and fast
   - Good enough for < 1M templates
   - Atomic operations (no transaction complexity)

4. **Developer Experience**
   - JSON is universal (works with any language)
   - Easy to work with in JavaScript/Node.js
   - AI-friendly format

5. **Future-Proof**
   - Can migrate to translation table later if needed
   - No lock-in

### ⚠️ Limitations

- Slightly slower than separate columns (negligible at your scale)
- Less normalized (acceptable trade-off)
- Requires PostgreSQL 9.4+ (you're using 15+)

---

## 🗄️ Complete Database Schema (JSONB Approach)

### Templates

```sql
CREATE TABLE templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  translations JSONB NOT NULL DEFAULT '{}',
  keywords TEXT[],
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_templates_user_id ON templates(user_id);
CREATE INDEX idx_templates_translations ON templates USING GIN (translations);
CREATE INDEX idx_templates_keywords ON templates USING GIN(keywords);

-- Constraint: Ensure at least one translation
ALTER TABLE templates ADD CONSTRAINT templates_has_translation 
  CHECK (jsonb_object_keys(translations) IS NOT NULL);
```

### Settings (Multi-Language)

```sql
CREATE TABLE settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  dashboard_language VARCHAR(10) DEFAULT 'en',
  default_reply_language VARCHAR(10) DEFAULT 'ar',
  supported_languages TEXT[] DEFAULT ARRAY['en', 'ar'],
  auto_detect_language BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Comments (Track Language)

```sql
ALTER TABLE comments 
  ADD COLUMN detected_language VARCHAR(10),
  ADD COLUMN reply_language VARCHAR(10);

CREATE INDEX idx_comments_detected_language ON comments(detected_language);
```

---

## 💻 Code Examples

### Backend (Node.js)

#### Create Template

```javascript
async function createTemplate(userId, name, translations, keywords) {
  const query = `
    INSERT INTO templates (user_id, name, translations, keywords)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `;
  
  const result = await db.query(query, [
    userId,
    name,
    JSON.stringify(translations),  // {"en": "...", "ar": "..."}
    keywords
  ]);
  
  return result.rows[0];
}

// Usage
await createTemplate('user123', 'Welcome', {
  'en': 'Thank you!',
  'ar': 'شكراً!',
  'ar-sy': 'شكراً إلك!',
  'sv': 'Tack!'
}, ['hello', 'مرحبا', 'hej']);
```

#### Get Template with Fallback

```javascript
async function getTemplateContent(templateId, preferredLanguage) {
  // Try: preferred → base language → English
  const fallbackChain = [
    preferredLanguage,           // 'ar-sy'
    preferredLanguage.split('-')[0],  // 'ar'
    'en'                         // fallback
  ];
  
  const query = `
    SELECT COALESCE(
      translations->$2,
      translations->$3,
      translations->$4
    ) as content
    FROM templates
    WHERE id = $1
  `;
  
  const result = await db.query(query, [
    templateId,
    ...fallbackChain
  ]);
  
  return result.rows[0]?.content;
}

// Usage
const content = await getTemplateContent('t1', 'ar-sy');
// Returns Syrian Arabic, or MSA, or English
```

#### Add Translation to Existing Template

```javascript
async function addTranslation(templateId, languageCode, content) {
  const query = `
    UPDATE templates
    SET translations = translations || $2::jsonb,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `;
  
  const newTranslation = { [languageCode]: content };
  
  const result = await db.query(query, [
    templateId,
    JSON.stringify(newTranslation)
  ]);
  
  return result.rows[0];
}

// Usage
await addTranslation('t1', 'sv', 'Tack för din kommentar!');
```

#### Get All Languages for Template

```javascript
async function getTemplateLanguages(templateId) {
  const query = `
    SELECT jsonb_object_keys(translations) as language
    FROM templates
    WHERE id = $1
  `;
  
  const result = await db.query(query, [templateId]);
  return result.rows.map(r => r.language);
}

// Usage
const languages = await getTemplateLanguages('t1');
// Returns: ['en', 'ar', 'ar-sy', 'sv']
```

#### Search Templates by Language

```javascript
async function getTemplatesWithLanguage(userId, languageCode) {
  const query = `
    SELECT id, name, translations->$2 as content
    FROM templates
    WHERE user_id = $1
      AND translations ? $2
      AND active = true
  `;
  
  const result = await db.query(query, [userId, languageCode]);
  return result.rows;
}

// Usage
const swedishTemplates = await getTemplatesWithLanguage('user123', 'sv');
```

---

## 🎨 Frontend Integration

### Template Editor Component

```javascript
function TemplateEditor({ template, onSave }) {
  const [translations, setTranslations] = useState(template.translations || {});
  const [activeLanguage, setActiveLanguage] = useState('en');
  
  const supportedLanguages = [
    { code: 'en', name: 'English' },
    { code: 'ar', name: 'العربية' },
    { code: 'ar-sy', name: 'سوري' },
    { code: 'ar-jo', name: 'أردني' },
    { code: 'sv', name: 'Svenska' },
    { code: 'fr', name: 'Français' }
  ];
  
  const handleTranslationChange = (lang, content) => {
    setTranslations({
      ...translations,
      [lang]: content
    });
  };
  
  return (
    <div>
      {/* Language Tabs */}
      <div className="language-tabs">
        {supportedLanguages.map(lang => (
          <button
            key={lang.code}
            onClick={() => setActiveLanguage(lang.code)}
            className={activeLanguage === lang.code ? 'active' : ''}
          >
            {lang.name}
            {translations[lang.code] && ' ✓'}
          </button>
        ))}
      </div>
      
      {/* Translation Input */}
      <textarea
        value={translations[activeLanguage] || ''}
        onChange={(e) => handleTranslationChange(activeLanguage, e.target.value)}
        placeholder={`Enter ${activeLanguage} translation...`}
        dir={activeLanguage.startsWith('ar') ? 'rtl' : 'ltr'}
      />
      
      <button onClick={() => onSave({ ...template, translations })}>
        Save Template
      </button>
    </div>
  );
}
```

---

## 🌍 Language Detection & Selection

### Detect Comment Language

```javascript
function detectLanguage(text) {
  // Arabic detection
  if (/[\u0600-\u06FF]/.test(text)) {
    // Detect dialect (simple heuristics)
    if (text.includes('فيك') || text.includes('شو')) return 'ar-sy';  // Syrian
    if (text.includes('ممكن') || text.includes('بدك')) return 'ar-jo';  // Jordanian
    return 'ar';  // Default Arabic
  }
  
  // Swedish detection
  if (/[åäöÅÄÖ]/.test(text)) return 'sv';
  
  // French detection
  if (/[àâäéèêëïîôùûüÿç]/i.test(text)) return 'fr';
  
  // Default to English
  return 'en';
}

// Or use a library
import { franc } from 'franc';

function detectLanguageAdvanced(text) {
  const detected = franc(text);
  
  const languageMap = {
    'arb': 'ar',
    'ara': 'ar',
    'eng': 'en',
    'swe': 'sv',
    'fra': 'fr',
    'tur': 'tr'
  };
  
  return languageMap[detected] || 'en';
}
```

### Select Reply Language

```javascript
async function selectReplyLanguage(comment, userSettings) {
  // 1. Auto-detect if enabled
  if (userSettings.auto_detect_language) {
    const detected = detectLanguage(comment.text);
    
    // Check if user supports this language
    if (userSettings.supported_languages.includes(detected)) {
      return detected;
    }
  }
  
  // 2. Fall back to user's default
  return userSettings.default_reply_language;
}
```

---

## 📊 Analytics Queries

### Language Usage Statistics

```sql
-- Most used languages
SELECT 
  detected_language,
  COUNT(*) as comment_count,
  COUNT(CASE WHEN replied THEN 1 END) as replied_count
FROM comments
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY detected_language
ORDER BY comment_count DESC;
```

### Template Coverage by Language

```sql
-- How many templates have each language
SELECT 
  lang.language,
  COUNT(*) as template_count
FROM templates,
     LATERAL jsonb_object_keys(translations) as lang(language)
WHERE user_id = 'user123'
GROUP BY lang.language
ORDER BY template_count DESC;
```

### Missing Translations

```sql
-- Templates without Swedish translation
SELECT id, name
FROM templates
WHERE user_id = 'user123'
  AND NOT (translations ? 'sv')
  AND active = true;
```

---

## 🔄 Migration Path

### From Current Schema (2 columns) to JSONB

```sql
-- Step 1: Add JSONB column
ALTER TABLE templates ADD COLUMN translations JSONB DEFAULT '{}';

-- Step 2: Migrate existing data
UPDATE templates
SET translations = jsonb_build_object(
  'en', content_en,
  'ar', content_ar
)
WHERE content_en IS NOT NULL OR content_ar IS NOT NULL;

-- Step 3: Verify
SELECT id, name, translations FROM templates LIMIT 10;

-- Step 4: Drop old columns (after verification)
ALTER TABLE templates DROP COLUMN content_en;
ALTER TABLE templates DROP COLUMN content_ar;

-- Step 5: Add index
CREATE INDEX idx_templates_translations ON templates USING GIN (translations);
```

---

## ✅ Best Practices

### 1. Always Provide Fallback
```javascript
const content = translations[preferredLang] 
  || translations[baseLang] 
  || translations['en'] 
  || 'Default message';
```

### 2. Validate Translations
```javascript
function validateTranslations(translations) {
  // Ensure at least one language
  if (Object.keys(translations).length === 0) {
    throw new Error('At least one translation required');
  }
  
  // Ensure all values are non-empty strings
  for (const [lang, content] of Object.entries(translations)) {
    if (typeof content !== 'string' || content.trim() === '') {
      throw new Error(`Invalid translation for ${lang}`);
    }
  }
  
  return true;
}
```

### 3. Use Language Constants
```javascript
const LANGUAGES = {
  ENGLISH: 'en',
  ARABIC: 'ar',
  ARABIC_SYRIAN: 'ar-sy',
  ARABIC_JORDANIAN: 'ar-jo',
  SWEDISH: 'sv',
  FRENCH: 'fr'
};
```

### 4. Index JSONB Properly
```sql
-- GIN index for existence checks (translations ? 'sv')
CREATE INDEX idx_templates_translations ON templates USING GIN (translations);

-- Expression index for specific language (if frequently queried)
CREATE INDEX idx_templates_swedish ON templates ((translations->>'sv'));
```

---

## 🎯 Summary

### ✅ Use JSONB Because:
1. Simple and flexible
2. No schema changes when adding languages
3. PostgreSQL JSONB is fast and powerful
4. Perfect for your scale (< 1M templates)
5. Easy to work with in JavaScript
6. Industry-proven approach

### 📈 Future Migration Path:
If you ever reach millions of templates and need more optimization, you can migrate to a translation table. But for 99% of SaaS apps, JSONB is perfect.

### 🏆 This is Best Practice for:
- Modern SaaS applications
- PostgreSQL databases
- Multi-language content
- Dynamic language support
- Developer productivity

**Recommendation: Use JSONB approach for AutoReply.AI** ✅
