# Language Support — AutoReply.AI

## Overview
AutoReply.AI supports **full bilingual operation** in Arabic and English, with special support for **Syrian dialect**.

---

## 🌍 Supported Languages

### Primary Languages
- **Arabic (العربية)** - Full support
  - Modern Standard Arabic (MSA)
  - Syrian Dialect (اللهجة الشامية) - Primary focus
  - Other dialects supported via AI
- **English** - Full support

---

## 🎯 Language Support Areas

### 1. Dashboard UI
**Fully translated interface:**
- Menu items
- Buttons and labels
- Form fields
- Error messages
- Help text
- Settings

**Technology:**
- Next.js i18n
- next-i18next library
- RTL (Right-to-Left) support for Arabic

**User Control:**
- Language toggle in header
- Preference saved per user
- Instant switching (no reload)

---

### 2. Templates (Bilingual Content)

Each template contains **both languages**:

```sql
CREATE TABLE templates (
  id UUID PRIMARY KEY,
  name VARCHAR(255),
  content_en TEXT,      -- English version
  content_ar TEXT,      -- Arabic version
  keywords TEXT[]       -- Both languages
);
```

**Example:**
```json
{
  "name": "Welcome Message",
  "content_en": "Thank you for your comment! How can we help?",
  "content_ar": "شكراً لتعليقك! كيف فينا نساعدك؟",
  "keywords": ["hello", "hi", "مرحبا", "هلا", "أهلا"]
}
```

---

### 3. AI Replies

**Automatic Language Detection:**
- Detects comment language
- Replies in same language
- Falls back to user preference

**Syrian Dialect Support:**
```javascript
// AI System Prompt for Syrian Dialect
const syrianPrompt = `
You are a customer service assistant for a Syrian business.
Respond in Syrian Arabic dialect (اللهجة الشامية).

Use natural Syrian expressions:
- "أهلا فيك" (welcome)
- "كيفك" (how are you)
- "شو بدك" (what do you want)
- "موجود عنا" (we have it)
- "تفضل مرر" (please come by)
- "ما في مشكلة" (no problem)

Keep responses short (1-2 sentences) and friendly.
`;
```

---

## 🔄 Language Detection Flow

```
1. Comment Received
   ↓
2. Detect Language
   - Check for Arabic characters (U+0600 to U+06FF)
   - Or use franc library
   ↓
3. Match Template
   - If Arabic → use content_ar
   - If English → use content_en
   ↓
4. Or Call AI
   - Pass detected language
   - AI replies in same language
   ↓
5. Post Reply
   - Track language used
   - Save for analytics
```

---

## 🛠️ Implementation

### Frontend (i18n Setup)

**Install Dependencies:**
```bash
npm install next-i18next react-i18next i18next
```

**Configuration:**
```javascript
// next-i18next.config.js
module.exports = {
  i18n: {
    defaultLocale: 'ar',
    locales: ['en', 'ar'],
    localeDetection: false,
  },
  reloadOnPrerender: process.env.NODE_ENV === 'development',
}
```

**Translation Files:**
```
/public/locales
  /ar
    common.json
    dashboard.json
  /en
    common.json
    dashboard.json
```

**Usage in Components:**
```javascript
import { useTranslation } from 'next-i18next'

export default function Dashboard() {
  const { t, i18n } = useTranslation('common')
  
  return (
    <div dir={i18n.language === 'ar' ? 'rtl' : 'ltr'}>
      <h1>{t('dashboard')}</h1>
      <button onClick={() => i18n.changeLanguage('ar')}>
        العربية
      </button>
      <button onClick={() => i18n.changeLanguage('en')}>
        English
      </button>
    </div>
  )
}
```

---

### Backend (Language Detection)

**Simple Detection:**
```javascript
function detectLanguage(text) {
  // Check for Arabic Unicode range
  const arabicPattern = /[\u0600-\u06FF]/;
  return arabicPattern.test(text) ? 'ar' : 'en';
}
```

**Advanced Detection:**
```javascript
import { franc } from 'franc';

function detectLanguage(text) {
  const lang = franc(text);
  
  if (lang === 'arb' || lang === 'ara') return 'ar';
  if (lang === 'eng') return 'en';
  
  // Fallback to user preference
  return user.settings.default_reply_language;
}
```

**Template Selection:**
```javascript
function getTemplateContent(template, language) {
  return language === 'ar' 
    ? template.content_ar 
    : template.content_en;
}
```

---

### AI Worker (Bilingual Prompts)

**System Prompts:**
```javascript
const systemPrompts = {
  ar: `أنت مساعد خدمة عملاء لمتجر سوري على فيسبوك.
       استخدم اللهجة السورية (الشامية) في الرد.
       كن ودوداً ومختصراً (جملة أو جملتين).
       استخدم تعابير سورية طبيعية.`,
  
  en: `You are a customer service assistant for a Syrian business on Facebook.
       Keep responses short (1-2 sentences).
       Be friendly and helpful.`
};

async function generateReply(comment, language) {
  const systemPrompt = systemPrompts[language];
  
  const response = await openai.chat.completions.create({
    model: 'gpt-4-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: comment }
    ],
    max_tokens: 150,
    temperature: 0.7
  });
  
  return response.choices[0].message.content;
}
```

---

## 📊 User Settings

```sql
CREATE TABLE settings (
  user_id UUID REFERENCES users(id),
  language VARCHAR(10) DEFAULT 'ar',              -- Dashboard language
  default_reply_language VARCHAR(10) DEFAULT 'ar', -- Reply language
  auto_detect_language BOOLEAN DEFAULT true        -- Auto-detect from comment
);
```

**Settings UI:**
- Dashboard Language: العربية | English
- Default Reply Language: العربية | English
- Auto-detect language: ☑ Enabled

---

## 🎨 Syrian Dialect Examples

### Common Phrases
| English | MSA | Syrian Dialect |
|---------|-----|----------------|
| Hello | مرحباً | أهلا / هلا |
| How are you? | كيف حالك؟ | كيفك؟ |
| Thank you | شكراً لك | شكراً إلك |
| You're welcome | على الرحب | أهلا فيك |
| What do you want? | ماذا تريد؟ | شو بدك؟ |
| We have it | متوفر لدينا | موجود عنا |
| Come by | تفضل بالزيارة | تفضل مرر |
| No problem | لا مشكلة | ما في مشكلة |

### Template Examples (Syrian)
```json
[
  {
    "name": "Greeting",
    "content_ar": "أهلا فيك! كيف فينا نساعدك؟",
    "content_en": "Hello! How can we help you?"
  },
  {
    "name": "Price Inquiry",
    "content_ar": "السعر [X] ليرة، تواصل معنا للتفاصيل",
    "content_en": "The price is [X] LBP, contact us for details"
  },
  {
    "name": "Availability",
    "content_ar": "موجود عنا، تفضل مرر عالمحل",
    "content_en": "We have it, please visit our store"
  },
  {
    "name": "Thanks",
    "content_ar": "شكراً إلك، منتظرينك!",
    "content_en": "Thank you, we're waiting for you!"
  }
]
```

---

## 🔍 Language Analytics

Track language usage:

```sql
-- Add to comments table
ALTER TABLE comments 
  ADD COLUMN detected_language VARCHAR(5),
  ADD COLUMN reply_language VARCHAR(5);

-- Analytics query
SELECT 
  detected_language,
  COUNT(*) as comment_count,
  AVG(CASE WHEN replied THEN 1 ELSE 0 END) as reply_rate
FROM comments
GROUP BY detected_language;
```

---

## ✅ Language Support Checklist

### Frontend
- [ ] Install next-i18next
- [ ] Create translation files (ar/en)
- [ ] Add language toggle
- [ ] Implement RTL support
- [ ] Test all screens in both languages

### Backend
- [ ] Implement language detection
- [ ] Add language fields to database
- [ ] Template selection by language
- [ ] API responses in user language

### AI Worker
- [ ] Create bilingual system prompts
- [ ] Add Syrian dialect prompt
- [ ] Test with Syrian phrases
- [ ] Implement language detection

### Templates
- [ ] Create bilingual templates
- [ ] Add Syrian dialect examples
- [ ] Test keyword matching (both languages)

---

## 🚀 Future Enhancements

### Additional Languages
- French (common in Syria/Lebanon)
- Turkish
- Kurdish

### Dialect Support
- Lebanese dialect
- Egyptian dialect
- Gulf dialects

### Advanced Features
- Mixed language detection
- Transliteration support (Franco-Arabic)
- Emoji interpretation

---

## 📝 Best Practices

1. **Always provide both languages** in templates
2. **Use natural Syrian dialect** for Arabic
3. **Keep replies short** (1-2 sentences)
4. **Test with real Syrian users**
5. **Track language metrics**
6. **Update translations regularly**

---

## 🎯 Summary

✅ **Full bilingual support** (Arabic + English)  
✅ **Syrian dialect** as primary Arabic variant  
✅ **Auto-detection** of comment language  
✅ **User preferences** for dashboard and replies  
✅ **RTL support** for Arabic interface  
✅ **Bilingual templates** and rules  
✅ **AI-powered** language-aware replies  

**The system is designed from the ground up for Arabic/English bilingual operation with special focus on Syrian market needs.**
