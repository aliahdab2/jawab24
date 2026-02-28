# Jawab24 - Complete System Analysis / تحليل النظام الكامل

> **Pre-Launch Reference Document / وثيقة مرجعية قبل الإطلاق**
> Generated: 2026-02-28

---

# Table of Contents / جدول المحتويات

1. [System Architecture Overview / نظرة عامة على البنية](#1-system-architecture-overview)
2. [Complete Message Flow / مسار الرسالة الكامل](#2-complete-message-flow)
3. [Decision Tree / شجرة القرارات](#3-decision-tree)
4. [AI Prompt Construction / بناء الأوامر للذكاء الاصطناعي](#4-ai-prompt-construction)
5. [Settings & Their Effects / الإعدادات وتأثيراتها](#5-settings-and-their-effects)
6. [With Store vs Without Store / مع متجر vs بدون متجر](#6-with-store-vs-without-store)
7. [Knowledge Base & RAG System / قاعدة المعرفة ونظام RAG](#7-knowledge-base-and-rag)
8. [Caching Strategy / استراتيجية التخزين المؤقت](#8-caching-strategy)
9. [Safety & Validation / الأمان والتحقق](#9-safety-and-validation)
10. [Edge Cases & Scenarios / حالات خاصة وسيناريوهات](#10-edge-cases-and-scenarios)
11. [Known Gaps & Pre-Launch Concerns / فجوات معروفة ومخاوف ما قبل الإطلاق](#11-known-gaps)

---

# 1. System Architecture Overview
# نظرة عامة على البنية

## English

Jawab24 is a **monorepo** with 3 services + 1 shared package:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        JAWAB24 ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │   Frontend    │    │   Backend    │    │     AI Worker        │  │
│  │  (Next.js)   │◄──►│  (Fastify)   │◄──►│   (Fastify)         │  │
│  │  Port: 3001  │    │  Port: 3000  │    │   Port: 3002        │  │
│  └──────────────┘    └──────┬───────┘    └──────────┬───────────┘  │
│                             │                       │               │
│                      ┌──────┴───────┐        ┌──────┴──────┐       │
│                      │  PostgreSQL  │        │   OpenAI    │       │
│                      │   + Redis    │        │  gpt-4.1-   │       │
│                      │   + BullMQ   │        │    mini     │       │
│                      └──────────────┘        └─────────────┘       │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    packages/shared                            │  │
│  │  Types, Constants, Sanitization, Intent Normalization         │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

**Services:**
- **Frontend** (Port 3001): Next.js 15 + Tailwind + Capacitor (mobile)
- **Backend** (Port 3000): Fastify 5 + Drizzle ORM + PostgreSQL + Redis
- **AI Worker** (Port 3002): Fastify 5 + OpenAI API (gpt-4.1-mini)
- **Shared Package**: TypeScript types, constants, sanitization utilities

**External Integrations:**
- Facebook Graph API (comments + DMs)
- Instagram Graph API (comments + DMs)
- Shopify API (products + policies)
- Salla API (products + policies)
- OpenAI API (reply generation + embeddings + translation)
- Stripe API (subscriptions + billing)

## عربي

Jawab24 هو **مستودع أحادي (monorepo)** يتكون من 3 خدمات + حزمة مشتركة:

**الخدمات:**
- **الواجهة الأمامية** (منفذ 3001): Next.js 15 + Tailwind + Capacitor (للموبايل)
- **الخادم الخلفي** (منفذ 3000): Fastify 5 + Drizzle ORM + PostgreSQL + Redis
- **عامل الذكاء الاصطناعي** (منفذ 3002): Fastify 5 + واجهة OpenAI (gpt-4.1-mini)
- **الحزمة المشتركة**: أنواع TypeScript، ثوابت، أدوات تنظيف المدخلات

**التكاملات الخارجية:**
- Facebook Graph API (التعليقات + الرسائل المباشرة)
- Instagram Graph API (التعليقات + الرسائل المباشرة)
- Shopify API (المنتجات + السياسات)
- Salla API (المنتجات + السياسات)
- OpenAI API (توليد الردود + التضمينات + الترجمة)
- Stripe API (الاشتراكات + الفواتير)

---

# 2. Complete Message Flow
# مسار الرسالة الكامل

## English

### The Full Journey: From Customer Message to Reply Sent

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                    COMPLETE MESSAGE LIFECYCLE                            ║
╠═══════════════════════════════════════════════════════════════════════════╣
║                                                                         ║
║  CUSTOMER writes on Facebook/Instagram                                  ║
║       │                                                                 ║
║       ▼                                                                 ║
║  ┌─────────────────────────────────────────┐                            ║
║  │  STEP 1: WEBHOOK RECEIPT                │                            ║
║  │  • Facebook/Instagram sends POST        │                            ║
║  │  • Backend verifies HMAC-SHA256         │                            ║
║  │  • Returns 200 OK immediately           │                            ║
║  │  • Enqueues job to BullMQ (async)       │                            ║
║  └────────────────┬────────────────────────┘                            ║
║                   │                                                     ║
║                   ▼                                                     ║
║  ┌─────────────────────────────────────────┐                            ║
║  │  STEP 2: WORKER PICKS UP JOB           │                            ║
║  │  • 5 concurrent workers (configurable)  │                            ║
║  │  • Routes by jobType:                   │                            ║
║  │    - facebook_comment                   │                            ║
║  │    - facebook_message                   │                            ║
║  │    - instagram_comment                  │                            ║
║  │    - instagram_message                  │                            ║
║  └────────────────┬────────────────────────┘                            ║
║                   │                                                     ║
║                   ▼                                                     ║
║  ┌─────────────────────────────────────────┐                            ║
║  │  STEP 3: VALIDATION CHECKS             │                            ║
║  │  ✓ Page exists & auto-reply enabled?    │                            ║
║  │  ✓ Platform auto-reply enabled?         │                            ║
║  │  ✓ Within business hours? (if setting)  │                            ║
║  │  ✓ Rate limit OK? (10 msgs/min)        │                            ║
║  │  ✓ Handoff pause active? (human agent) │                            ║
║  │  ✓ Already replied?                     │                            ║
║  │  ✓ Debounce (fast-path only, skipped   │                            ║
║  │    when replyDelay > 0)                │                            ║
║  └────────────────┬────────────────────────┘                            ║
║                   │                                                     ║
║          ┌────────┴─────────┐                                           ║
║          │ FIRST CONVERSATION│                                          ║
║          └────────┬─────────┘                                           ║
║             YES   │                                                     ║
║                   ▼                                                     ║
║  ┌─────────────────────────────────────────┐                            ║
║  │  STEP 4: GREETING GATE (if set)         │                            ║
║  │  • Only on first DM from sender (ever) │                            ║
║  │  • Detect customer language             │                            ║
║  │  • Send greeting, mark replied, RETURN │                            ║
║  │  • On failure: fall through to AI      │                            ║
║  └────────────────┬────────────────────────┘                            ║
║                   │                                                     ║
║                   ▼                                                     ║
║  ┌─────────────────────────────────────────┐                            ║
║  │  STEP 5: REPLY DELAY (consolidation)   │                            ║
║  │  • Wait X seconds (e.g., 2s)            │                            ║
║  │  • Post-delay debounce re-check         │                            ║
║  │  • Acts as message consolidation window │                            ║
║  └────────────────┬────────────────────────┘                            ║
║                   │                                                     ║
║                   ▼                                                     ║
║  ┌─────────────────────────────────────────┐                            ║
║  │  STEP 6: CONSOLIDATE MESSAGES           │                            ║
║  │  • Fetch all unreplied msgs from sender │                            ║
║  │  • Join for AI context                  │                            ║
║  │  • Use latest msg for template matching │                            ║
║  └────────────────┬────────────────────────┘                            ║
║                   │                                                     ║
║         ┌─────────┴──────────┐                                          ║
║         ▼                    ▼                                           ║
║  ┌──────────────┐    ┌──────────────┐                                   ║
║  │  TEMPLATE    │    │  AI REPLY    │                                   ║
║  │  MATCHING    │    │  GENERATION  │                                   ║
║  │  (Step 7a)   │    │  (Step 7b)   │                                   ║
║  └──────┬───────┘    └──────┬───────┘                                   ║
║         │                   │                                           ║
║         │    ┌──────────────┘                                           ║
║         │    │                                                          ║
║         ▼    ▼                                                          ║
║  ┌─────────────────────────────────────────┐                            ║
║  │  STEP 8: SAFETY FILTERS                │                            ║
║  │  • Offensive? → Skip reply, flag        │                            ║
║  │  • Price hallucination? → Safe fallback │                            ║
║  │  • Low confidence? → Hold for review    │                            ║
║  │  • Comment too long? → Truncate         │                            ║
║  └────────────────┬────────────────────────┘                            ║
║                   │                                                     ║
║                   ▼                                                     ║
║  ┌─────────────────────────────────────────┐                            ║
║  │  STEP 9: SEND REPLY                    │                            ║
║  │  • Via Facebook/Instagram Graph API     │                            ║
║  │  • Mark message as replied (DB)         │                            ║
║  │  • Store outgoing message               │                            ║
║  │  • Notify merchant if flagged           │                            ║
║  │  • Structured log: reply_sent event     │                            ║
║  │    (method, intent, confidence, flags,  │                            ║
║  │     duration, consolidated count)        │                            ║
║  └─────────────────────────────────────────┘                            ║
║                                                                         ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

### Step 7a: Template Matching (Detail)

```
Customer message: "كم سعر القميص الأزرق؟"
         │
         ▼
┌───────────────────────────────┐
│  Fetch active rules           │
│  (ordered by priority)        │
│                               │
│  Rule 1: keywords=["سعر"]     │ ◄── Priority 0 (highest)
│  Rule 2: keywords=["توصيل"]   │ ◄── Priority 1
│  Rule 3: keywords=["مرتجع"]   │ ◄── Priority 2
└───────────┬───────────────────┘
            │
            ▼
┌───────────────────────────────┐
│  Normalize text:              │
│  "كم سعر القميص الأزرق"       │
│                               │
│  Check Rule 1:                │
│    keyword "سعر" in text?     │
│    ✓ MATCH (Arabic substring) │
│                               │
│  → Return Rule 1's template   │
│  → replyMethod = 'template'   │
└───────────────────────────────┘
```

**Arabic keyword matching is special:**
- Substring match (handles prefixes like ال)
- Root consonant match (handles broken plurals: سعر → اسعار)
- English uses word-boundary regex (\bkeyword\b)

### Step 7b: AI Reply Generation (Detail)

```
┌─────────────────────────────────────────────────────────────────┐
│                    AI REPLY GENERATION PIPELINE                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. CHECK SUBSCRIPTION                                          │
│     └─ Can user use AI replies? (plan limit)                    │
│                                                                 │
│  2. BUILD CONTEXT                                               │
│     ├─ Page name                                                │
│     ├─ Knowledge base (static or RAG chunks)                    │
│     ├─ Store policies (if e-commerce linked)                    │
│     ├─ Product catalog (if e-commerce linked)                   │
│     ├─ Post message (for comments)                              │
│     ├─ Conversation history (for DMs, compressed if > 8 msgs)  │
│     ├─ Reply style (professional/casual/enthusiastic)           │
│     └─ Brand voice notes                                        │
│                                                                 │
│  3. CHECK EXACT CACHE (Redis → Postgres fallback)               │
│     Key = SHA256(comment + lang + pageId + kbVersion +          │
│                   postMsg + policies + style + promptVersion)   │
│     └─ HIT? → Return cached {reply, intent, confidence, flags} │
│                                                                 │
│  4. CHECK SEMANTIC CACHE (Vector similarity)                    │
│     └─ Similar question asked before? → Return cached reply     │
│                                                                 │
│  5. CALL AI WORKER (HTTP POST /generate)                        │
│     ├─ Build system prompt (~3000 words)                        │
│     ├─ Include KB + products + policies                         │
│     ├─ Include conversation history                             │
│     ├─ Call OpenAI gpt-4.1-mini                                 │
│     ├─ Parse JSON response                                      │
│     └─ Run 6 post-validation checks                             │
│                                                                 │
│  6. SAVE TO CACHES                                              │
│     ├─ Exact cache (Redis + Postgres)                           │
│     └─ Semantic cache (fire-and-forget)                         │
│                                                                 │
│  7. LOG TOKEN USAGE                                             │
│     └─ userId, pageId, model, tokensIn, tokensOut               │
│                                                                 │
│  RETURN: {reply, intent, confidence, flags}                     │
└─────────────────────────────────────────────────────────────────┘
```

## عربي

### الرحلة الكاملة: من رسالة العميل إلى إرسال الرد

**الخطوة 1: استقبال Webhook**
- فيسبوك/إنستغرام يرسل POST إلى الخادم
- التحقق من التوقيع HMAC-SHA256
- إرجاع 200 OK فوراً (عدم حجب)
- إضافة المهمة إلى طابور BullMQ (معالجة غير متزامنة)

**الخطوة 2: العامل يلتقط المهمة**
- 5 عمال متزامنين (قابل للتعديل)
- توجيه حسب نوع المهمة (تعليق فيسبوك، رسالة فيسبوك، تعليق إنستغرام، رسالة إنستغرام)

**الخطوة 3: فحوصات التحقق**
- هل الصفحة موجودة والرد التلقائي مفعّل؟
- هل الرد التلقائي للمنصة مفعّل؟
- هل نحن ضمن ساعات العمل؟ (إذا كان الإعداد مفعّلاً)
- هل حد المعدل مقبول؟ (10 رسائل/دقيقة)
- هل هناك توقف تسليم نشط؟ (وكيل بشري)
- هل تم الرد مسبقاً؟
- إزالة الازدواجية (هل هناك رسالة أحدث قادمة؟)

**الخطوة 4: رسالة الترحيب** (إذا كانت مُعدّة)
- كشف لغة العميل تلقائياً
- إرسال ترحيب بنفس اللغة
- لا يتم تعليم الرسالة كمُرد عليها (الذكاء الاصطناعي لا يزال يعمل)

**الخطوة 5: تأخير الرد** (إذا كان مُعدّاً)
- انتظار X ثانية
- يسمح لرسائل متتالية بالتجمع

**الخطوة 6: دمج الرسائل**
- جلب جميع الرسائل غير المرد عليها من نفس المرسل
- دمجها لسياق الذكاء الاصطناعي
- استخدام أحدث رسالة لمطابقة القوالب

**الخطوة 7أ: مطابقة القوالب**
- البحث في القواعد النشطة حسب الأولوية
- مطابقة الكلمات المفتاحية (دعم خاص للعربية: الجذور والبادئات)
- إذا تطابقت → استخدام قالب الرد (بدون تكلفة AI)

**الخطوة 7ب: توليد رد الذكاء الاصطناعي**
- فحص حد الاشتراك
- بناء السياق (قاعدة معرفة + منتجات + سياسات + تاريخ محادثة)
- فحص الكاش الدقيق (Redis/Postgres)
- فحص الكاش الدلالي (تشابه متجهات)
- استدعاء AI Worker (OpenAI gpt-4.1-mini)
- حفظ في الكاش

**الخطوة 8: فلاتر الأمان**
- محتوى مسيء؟ → تخطي الرد وتعليم للمراجعة
- هلوسة أسعار؟ → رد آمن بديل
- ثقة منخفضة؟ → احتجاز للمراجعة البشرية
- تعليق طويل جداً؟ → اقتطاع

**الخطوة 9: إرسال الرد**
- عبر واجهة Facebook/Instagram Graph API
- تعليم الرسالة كمُرد عليها في قاعدة البيانات
- تخزين الرسالة الصادرة
- إشعار التاجر إذا تم التعليم

---

# 3. Decision Tree
# شجرة القرارات

## English

```
CUSTOMER SENDS MESSAGE/COMMENT
│
├── Is page valid & auto-reply enabled?
│   └── NO → ❌ Ignore (log error)
│
├── Is platform auto-reply enabled? (comments/messages separately)
│   └── NO → Send AWAY MESSAGE (language-matched) → STOP
│
├── Is businessHoursOnly enabled?
│   ├── YES → Is it within business hours?
│   │   └── NO → Send AWAY MESSAGE → STOP
│   └── NO → Continue
│
├── Is there an active HANDOFF PAUSE? (human agent took over)
│   └── YES → Re-enqueue with delay → STOP (max 3 retries)
│
├── Rate limit exceeded? (>10 msgs/min from same sender)
│   └── YES → ❌ Skip silently → STOP
│
├── Already replied to this message?
│   └── YES → ❌ Skip → STOP
│
├── [DM only, fast-path] Is there a newer unreplied message? (debounce)
│   └── Skipped when replyDelay > 0 (delay acts as consolidation window)
│   └── YES → ❌ Skip (newer job will handle) → STOP
│
├── [DM only] Is this the FIRST message ever from sender?
│   └── YES → Send GREETING MESSAGE, mark as replied, RETURN early
│   └── Greeting send failure → fall through to AI as fallback
│
├── [If configured] Wait reply delay (consolidation window)
│
├── [DM only, post-delay] Re-check debounce after delay
│   └── YES → ❌ Skip (newer job arrived during delay) → STOP
│
├── [DM only] Consolidate unreplied messages from same sender
│
├── Try TEMPLATE MATCHING (keyword rules)
│   └── MATCH → Use template reply → Go to Safety Filters
│
├── Is AI enabled?
│   └── NO → ❌ No reply generated → STOP
│
├── Check subscription limit (can use AI?)
│   └── NO → Send generic fallback → Go to Send
│
├── BUILD AI CONTEXT:
│   ├── Knowledge Base (static or RAG chunks)
│   ├── Store products (if e-commerce linked)
│   ├── Store policies (if e-commerce linked)
│   ├── Post message (if comment)
│   ├── Conversation history (if DM)
│   ├── Reply style + brand voice
│   └── Channel type (comment vs DM)
│
├── Check EXACT CACHE → HIT? → Go to Safety Filters
├── Check SEMANTIC CACHE → HIT? → Go to Safety Filters
│
├── CALL AI WORKER → OpenAI gpt-4.1-mini
│   └── TIMEOUT/ERROR → Return FALLBACK reply
│
├── SAVE to caches (exact + semantic)
│
├── SAFETY FILTERS:
│   ├── Intent = OFFENSIVE or SPAM? → Flag → ❌ DON'T reply → STOP
│   ├── Flag = price_not_in_kb? → Replace with SAFE FALLBACK
│   ├── Confidence = low AND holdLowConfidence? → ❌ DON'T send → STOP
│   ├── [Comment] Reply > 280 chars? → Truncate
│   └── [Comment + QUESTION/PURCHASE] → Auto-append "DM us!"
│
├── SEND REPLY via Graph API
│   └── FAIL → ❌ Don't mark as replied → STOP
│
└── SUCCESS:
    ├── Mark message as replied (DB transaction)
    ├── Store outgoing message
    ├── Mark older consolidated messages as replied
    └── Notify merchant if flagged (needsAttention)
```

## عربي

```
العميل يرسل رسالة/تعليق
│
├── هل الصفحة صالحة والرد التلقائي مفعّل؟
│   └── لا → ❌ تجاهل
│
├── هل الرد التلقائي للمنصة مفعّل؟
│   └── لا → إرسال رسالة الغياب → توقف
│
├── هل وضع ساعات العمل فقط مفعّل؟
│   ├── نعم → هل نحن ضمن ساعات العمل؟
│   │   └── لا → إرسال رسالة الغياب → توقف
│   └── لا → متابعة
│
├── هل هناك توقف تسليم نشط؟ (وكيل بشري تولى المحادثة)
│   └── نعم → إعادة جدولة مع تأخير → توقف
│
├── هل تجاوز حد المعدل؟ (>10 رسائل/دقيقة)
│   └── نعم → ❌ تخطي → توقف
│
├── هل تم الرد مسبقاً؟
│   └── نعم → ❌ تخطي → توقف
│
├── [رسائل مباشرة] هل هناك رسالة أحدث غير مُرد عليها؟
│   └── نعم → ❌ تخطي (المهمة الأحدث ستتولى)
│
├── [رسائل مباشرة] هل هذه محادثة جديدة؟
│   └── نعم → إرسال رسالة ترحيب
│
├── محاولة مطابقة القوالب (قواعد الكلمات المفتاحية)
│   └── تطابق → استخدام قالب الرد
│
├── هل الذكاء الاصطناعي مفعّل؟
│   └── لا → ❌ لا رد → توقف
│
├── بناء سياق الذكاء الاصطناعي
│   ├── قاعدة المعرفة
│   ├── منتجات المتجر (إذا متصل)
│   ├── سياسات المتجر (إذا متصل)
│   ├── محتوى المنشور (للتعليقات)
│   ├── تاريخ المحادثة (للرسائل المباشرة)
│   └── أسلوب الرد + ملاحظات العلامة التجارية
│
├── فحص الكاش → استدعاء AI Worker إذا لم يوجد
│
├── فلاتر الأمان:
│   ├── مسيء/سبام؟ → تعليم للمراجعة → لا رد
│   ├── هلوسة أسعار؟ → رد آمن بديل
│   ├── ثقة منخفضة + احتجاز مفعّل؟ → احتجاز للمراجعة
│   └── [تعليق + سؤال] → إضافة "راسلنا للتفاصيل!"
│
└── إرسال الرد → تعليم كمُرد عليه → تخزين → إشعار
```

---

# 4. AI Prompt Construction
# بناء الأوامر للذكاء الاصطناعي

## English

### What Exactly Gets Sent to OpenAI

The system prompt sent to gpt-4.1-mini is approximately **3,000+ words** and consists of 8 sections:

```
┌─────────────────────────────────────────────────────────────────┐
│                    SYSTEM PROMPT STRUCTURE                       │
│                    (~3000+ words total)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  SECTION 1: ROLE & CONTEXT (~50 words)                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ "You are a [STYLE] customer service assistant for       │   │
│  │  '[pageName]'."                                          │   │
│  │                                                          │   │
│  │  Style mapping:                                          │   │
│  │  • professional → "formal but warm"                      │   │
│  │  • casual → "friendly and conversational"                │   │
│  │  • enthusiastic → "energetic and enthusiastic"           │   │
│  │                                                          │   │
│  │  Channel mapping:                                        │   │
│  │  • comment → "respond to customer comments on social     │   │
│  │    media posts"                                          │   │
│  │  • dm → "having a conversation with a customer via      │   │
│  │    direct message"                                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  SECTION 2: INTENT IDENTIFICATION (~850 words)                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 8 MANDATORY intent categories:                           │   │
│  │                                                          │   │
│  │ 1. QUESTION      - Info seeking (price, hours, etc.)     │   │
│  │ 2. COMPLIMENT    - Positive feedback/praise              │   │
│  │ 3. COMPLAINT     - Negative experience, frustration      │   │
│  │ 4. PURCHASE_INTENT - Wants to buy/order/book             │   │
│  │ 5. GREETING      - Simple hello/hi                       │   │
│  │ 6. BUSINESS_INQUIRY - Partnership/wholesale              │   │
│  │ 7. OFFENSIVE     - Insults, profanity, threats           │   │
│  │ 8. SPAM_OR_IRRELEVANT - Unrelated, ads, links           │   │
│  │                                                          │   │
│  │ + Sarcasm detection rules                                │   │
│  │ + Arabic dialect matching (Egyptian, Levantine, Gulf,    │   │
│  │   Maghrebi, Iraqi, formal)                               │   │
│  │ + Punctuation-only = SPAM                                │   │
│  │ + 9 detailed examples (Arabic + English)                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  SECTION 3: RESPONSE GUIDELINES BY INTENT (~180 words)         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ QUESTION     → Search KB; if not found → "I'll check"   │   │
│  │ COMPLIMENT   → Thank warmly                              │   │
│  │ COMPLAINT    → Apologize, acknowledge, offer help        │   │
│  │ PURCHASE     → Guide how to order/contact                │   │
│  │ GREETING     → Greet back, ask how to help               │   │
│  │ BUSINESS_INQ → Thank, express openness, ask details      │   │
│  │ OFFENSIVE    → Reply = "" (empty), skip                  │   │
│  │ SPAM         → Reply = "" (empty), skip                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  SECTION 4: GENERAL RESPONSE RULES (~420 words)                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ LANGUAGE:                                                │   │
│  │ • Reply in SAME language customer used                   │   │
│  │ • Match dialect naturally                                │   │
│  │                                                          │   │
│  │ COMMENT (public):                                        │   │
│  │ • Max 1-2 sentences, max 40 words                        │   │
│  │ • Never include prices/detailed specs                    │   │
│  │ • Redirect to DM for details                             │   │
│  │                                                          │   │
│  │ DM (private):                                            │   │
│  │ • Can provide full detailed answers                      │   │
│  │ • List ALL options if asked about pricing                │   │
│  │ • Context continuity (vague follow-ups use history)      │   │
│  │ • NEVER say "contact us" when IN a DM                    │   │
│  │                                                          │   │
│  │ EMOJI: 1-2 max, sparingly                                │   │
│  │ BRAND VOICE: Follow brandVoiceNotes if provided          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  SECTION 5: CRITICAL SAFETY RULES (~960 words)                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ KNOWLEDGE SOURCE:                                        │   │
│  │ • ONLY use <business_knowledge> as source                │   │
│  │ • Do NOT use training data even if correct               │   │
│  │                                                          │   │
│  │ NEVER:                                                   │   │
│  │ • Invent/guess prices, costs, fees                       │   │
│  │ • Make up availability, stock, delivery dates            │   │
│  │ • Invent dates, deadlines, offers                        │   │
│  │ • Promise refunds/returns (unless in KB)                 │   │
│  │ • Provide medical/legal/financial advice                 │   │
│  │ • Share personal customer data                           │   │
│  │ • Discuss affiliate/partner terms                        │   │
│  │                                                          │   │
│  │ WHEN UNSURE:                                             │   │
│  │ "Let me check with the team and get back to you"         │   │
│  │                                                          │   │
│  │ CONFIDENCE SCORING (STRICT):                             │   │
│  │ • HIGH: Every claim backed by KB                         │   │
│  │ • MEDIUM: Partial KB coverage + info_not_in_kb flag      │   │
│  │ • LOW: Not answered by KB + info_not_in_kb flag          │   │
│  │                                                          │   │
│  │ 9 common confidence mistake examples                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  SECTION 6: BUSINESS KNOWLEDGE (variable size)                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ <business_knowledge>                                     │   │
│  │   [RAG chunks OR static KB, max 16,000 chars]            │   │
│  │   [Store policies, max 2,000 chars]                      │   │
│  │ </business_knowledge>                                    │   │
│  │                                                          │   │
│  │ <product_catalog>                                        │   │
│  │   [Top 15 products, ~800 chars]                          │   │
│  │   Product Name — Price — Variants — Stock Status          │   │
│  │ </product_catalog>                                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  SECTION 7: JSON OUTPUT FORMAT                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Must return:                                             │   │
│  │ {                                                        │   │
│  │   "reply": "text",                                       │   │
│  │   "intent": "QUESTION",                                  │   │
│  │   "confidence": "high|medium|low",                       │   │
│  │   "flags": ["info_not_in_kb", ...]                       │   │
│  │ }                                                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  SECTION 8: FEW-SHOT EXAMPLES (9 examples)                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 1. Answer in KB → high confidence                        │   │
│  │ 2. Answer NOT in KB → low + info_not_in_kb               │   │
│  │ 3. Offensive → empty reply + offensive flag              │   │
│  │ 4. WHO question KB has WHAT → low                        │   │
│  │ 5. Sarcasm detection → COMPLAINT                         │   │
│  │ 6. Angry customer → COMPLAINT + angry_customer           │   │
│  │ 7. Partial geo match → medium + info_not_in_kb           │   │
│  │ 8. Related but different concept → low                   │   │
│  │ 9. Price listing in DM → high (list ALL)                 │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Post-Response Validation (6 Checks)

After OpenAI returns, the system runs **6 automated checks**:

| Check | What It Does | Action |
|-------|-------------|--------|
| **Hallucinated Prices** | Matches numbers adjacent to currency tokens (SAR, SR, ريال, $, etc.) and checks if they exist in KB. Ignores dates, phone numbers, delivery times. | Adds `price_not_in_kb` flag |
| **Comment Too Long** | Word count > 50 for public comments | Adds `comment_too_long` flag |
| **Language Mismatch** | Reply language differs from input language | Adds `language_mismatch` flag |
| **Hedge Words** | Detects "let me check", "سأتحقق", etc. with high/medium confidence | **Downgrades to LOW** + adds `info_not_in_kb` |
| **DM Deflection** | DM reply says "contact us" / "message us" | Adds `info_not_in_kb` + downgrades confidence |
| **Low Confidence Flag** | Low confidence without `info_not_in_kb` flag | **Auto-adds** `info_not_in_kb` flag |

### Valid Flags

| Flag | Meaning |
|------|---------|
| `info_not_in_kb` | Answer not found in knowledge base |
| `price_not_in_kb` | Reply mentions a price not in KB (hallucination!) |
| `angry_customer` | Customer seems angry/frustrated |
| `offensive_or_abusive` | Insults, profanity, threats |
| `low_confidence` | AI is uncertain about reply quality |
| `redirect_to_human` | Advised customer to contact human |
| `language_mismatch` | Reply language differs from input |
| `comment_too_long` | Public comment exceeded 50 words |
| `invalid_json` | AI returned non-JSON (parsing fallback) |

## عربي

### ما الذي يُرسل بالضبط إلى OpenAI

يتكون الـ System Prompt من **3,000+ كلمة** مقسمة إلى 8 أقسام:

**القسم 1: الدور والسياق** - "أنت مساعد خدمة عملاء [أسلوب] لـ '[اسم الصفحة]'"

**القسم 2: تحديد النية** - 8 فئات إلزامية:
1. **سؤال** (QUESTION) - استفسار عن سعر، مواعيد، إلخ
2. **إطراء** (COMPLIMENT) - ردود إيجابية
3. **شكوى** (COMPLAINT) - تجربة سلبية، إحباط
4. **نية شراء** (PURCHASE_INTENT) - يريد الطلب/الحجز
5. **تحية** (GREETING) - مرحبا/أهلاً
6. **استفسار تجاري** (BUSINESS_INQUIRY) - شراكة/جملة
7. **مسيء** (OFFENSIVE) - إهانات، ألفاظ نابية
8. **سبام** (SPAM_OR_IRRELEVANT) - غير ذي صلة، إعلانات

+ كشف السخرية + مطابقة اللهجة العربية (مصرية، شامية، خليجية، مغاربية، عراقية، فصحى)

**القسم 3: إرشادات الرد حسب النية**
- سؤال → البحث في قاعدة المعرفة؛ إذا لم يُوجد → "خليني أتحقق"
- شكوى → اعتذار وعرض المساعدة
- مسيء → رد فارغ + تخطي

**القسم 4: قواعد الرد العامة**
- التعليقات العامة: جملة أو جملتين فقط، 40 كلمة كحد أقصى
- الرسائل المباشرة: تفاصيل كاملة، أسعار، قوائم
- لا تقل "راسلنا" عندما تكون بالفعل في رسالة مباشرة!

**القسم 5: قواعد الأمان الحرجة**
- استخدم فقط قاعدة المعرفة كمصدر
- لا تخترع أسعار أو مواعيد أو سياسات
- عند الشك: "خليني أتحقق مع الفريق"

**القسم 6: المعرفة التجارية**
- قاعدة المعرفة (حتى 16,000 حرف)
- سياسات المتجر (حتى 2,000 حرف)
- كتالوج المنتجات (أعلى 15 منتج، ~800 حرف)

**القسم 7: تنسيق JSON المطلوب**

**القسم 8: أمثلة (9 أمثلة مفصلة)**

### التحقق بعد الرد (6 فحوصات)

| الفحص | ماذا يفعل | الإجراء |
|-------|-----------|---------|
| أرقام مهلوسة | استخراج الأرقام من الرد والتحقق من وجودها في KB | إضافة علم `info_not_in_kb` |
| تعليق طويل | عدد الكلمات > 50 للتعليقات العامة | إضافة علم `comment_too_long` |
| عدم تطابق اللغة | لغة الرد مختلفة عن لغة المدخل | إضافة علم `language_mismatch` |
| كلمات تحفظية | كشف "خليني أتحقق"، "سأتحقق" مع ثقة عالية/متوسطة | **تخفيض إلى منخفض** |
| تحويل في الرسائل المباشرة | الرد يقول "راسلنا" وهو في رسالة مباشرة | إضافة علم + تخفيض الثقة |
| فرض علم الثقة المنخفضة | ثقة منخفضة بدون علم `info_not_in_kb` | **إضافة تلقائية** |

---

# 5. Settings and Their Effects
# الإعدادات وتأثيراتها

## English

### Complete Settings Table

| Setting | Type | Default | Where It Affects |
|---------|------|---------|------------------|
| **commentsAutoReply** | boolean | true | If false, never auto-reply to comments |
| **messagesAutoReply** | boolean | true | If false, sends away message instead |
| **commentReplyMode** | enum | 'public' | `public` = visible comment, `private` = DM, `dual` = both |
| **dualReplyNudge** | text | "Details sent in DM" | Appended to public reply in dual mode |
| **businessHoursOnly** | boolean | false | If true, auto-reply ONLY during business hours |
| **businessHoursStart** | time | '09:00' | Start of business hours (timezone-aware) |
| **businessHoursEnd** | time | '18:00' | End of business hours (timezone-aware) |
| **timezone** | string | 'Asia/Damascus' | Used for business hours calculation |
| **aiEnabled** | boolean | true | Master switch: if false, only templates work |
| **replyDelay** | integer | 0 | Seconds to wait before sending (consolidation) |
| **commentEscalationMinutes** | integer | 60 | Auto-flag unreplied comments after X minutes |
| **messageEscalationMinutes** | integer | 30 | Auto-flag unreplied DMs after X minutes |
| **handoffPauseDurationMinutes** | integer | 15 | Pause auto-reply after human takes over |
| **replyStyle** | enum | 'professional' | `professional` / `casual` / `enthusiastic` |
| **brandVoiceNotes** | text | '' | Custom brand voice guidelines (500 char max) |
| **holdLowConfidence** | boolean | false | Hold low-confidence AI replies for review |
| **greetingMessageMulti** | JSONB | {} | `{ar: "...", en: "..."}` - first msg to new customer |
| **awayMessageMulti** | JSONB | {} | `{ar: "...", en: "..."}` - sent when off/outside hours |
| **defaultReplyLanguage** | enum | 'ar' | Default if auto-detect fails |
| **autoDetectLanguage** | boolean | true | Detect customer language from message |
| **supportedLanguages** | array | ['en','ar'] | Languages business supports |
| **notificationsEnabled** | boolean | true | Push/in-app notifications |

### Settings Save Flow

```
User saves settings on frontend
         │
         ▼
┌──────────────────────────────────┐
│  1. VALIDATE (Zod schema)        │
│  2. SMART AUTO-TRANSLATION:      │
│     ├─ 1 language changed →      │
│     │   auto-translate to other   │
│     ├─ 2+ languages changed →    │
│     │   sourceLang = 'manual'     │
│     └─ source cleared → reset    │
│  3. UPDATE settings table        │
│  4. INVALIDATE Redis cache       │
│  5. SYNC to workspace settings   │
│     (20+ fields for pipeline)    │
└──────────────────────────────────┘
```

## عربي

### جدول الإعدادات الكامل

| الإعداد | النوع | الافتراضي | التأثير |
|---------|-------|-----------|---------|
| **الرد التلقائي على التعليقات** | منطقي | مفعّل | إذا مُعطّل، لا رد تلقائي على التعليقات |
| **الرد التلقائي على الرسائل** | منطقي | مفعّل | إذا مُعطّل، يُرسل رسالة الغياب بدلاً |
| **وضع رد التعليقات** | اختيار | عام | `عام` = تعليق مرئي، `خاص` = رسالة مباشرة، `مزدوج` = كلاهما |
| **ساعات العمل فقط** | منطقي | مُعطّل | إذا مفعّل، الرد فقط خلال ساعات العمل |
| **بداية ساعات العمل** | وقت | 09:00 | بداية العمل (حسب المنطقة الزمنية) |
| **نهاية ساعات العمل** | وقت | 18:00 | نهاية العمل (حسب المنطقة الزمنية) |
| **المنطقة الزمنية** | نص | آسيا/دمشق | لحساب ساعات العمل |
| **تفعيل الذكاء الاصطناعي** | منطقي | مفعّل | مفتاح رئيسي: إذا مُعطّل، القوالب فقط |
| **تأخير الرد** | رقم | 0 | ثوانٍ قبل الإرسال (نافذة دمج) |
| **أسلوب الرد** | اختيار | مهني | شخصية AI: `مهني` / `ودي` / `حماسي` |
| **ملاحظات صوت العلامة** | نص | فارغ | إرشادات مخصصة لصوت العلامة التجارية |
| **احتجاز الثقة المنخفضة** | منطقي | مُعطّل | الردود منخفضة الثقة تُحتجز للمراجعة البشرية |
| **رسالة الترحيب** | JSONB | {} | `{ar: "...", en: "..."}` - أول رسالة للعميل الجديد |
| **رسالة الغياب** | JSONB | {} | `{ar: "...", en: "..."}` - خارج ساعات العمل |

---

# 6. With Store vs Without Store
# مع متجر vs بدون متجر

## English

### Scenario Comparison

```
┌────────────────────────────────────────────────────────────────────────┐
│                    WITHOUT E-COMMERCE STORE                            │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  AI Prompt receives:                                                   │
│  ┌──────────────────────────────────────┐                              │
│  │ <business_knowledge>                 │                              │
│  │   [Knowledge base text only]         │                              │
│  │   (max 16,000 chars)                 │                              │
│  │ </business_knowledge>                │                              │
│  │                                      │                              │
│  │ NO <product_catalog>                 │                              │
│  │ NO store_policies                    │                              │
│  └──────────────────────────────────────┘                              │
│                                                                        │
│  Customer: "كم سعر القميص الأزرق؟"                                     │
│  AI: "خليني أتحقق من الفريق وبرجعلك 😊"                                │
│  → confidence: LOW                                                     │
│  → flags: [info_not_in_kb]                                             │
│                                                                        │
│  Customer: "ما هي ساعات العمل؟"                                        │
│  AI: "ساعات العمل من 9 صباحاً حتى 6 مساءً" (if in KB)                  │
│  → confidence: HIGH                                                    │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│                    WITH E-COMMERCE STORE                               │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  AI Prompt receives:                                                   │
│  ┌──────────────────────────────────────┐                              │
│  │ <business_knowledge>                 │                              │
│  │   [RAG chunks from KB]               │                              │
│  │   [store_policies: shipping,         │                              │
│  │    returns, warranty (~2000 chars)]   │                              │
│  │ </business_knowledge>                │                              │
│  │                                      │                              │
│  │ <product_catalog>                    │                              │
│  │   Top 15 products (~800 chars):      │                              │
│  │   1. Blue Shirt — 120 SAR —          │                              │
│  │      S,M,L in Blue — in stock        │                              │
│  │   2. Red Dress — 250 SAR —           │                              │
│  │      S,M,L in Red — in stock         │                              │
│  │   3. ...                             │                              │
│  │ </product_catalog>                   │                              │
│  └──────────────────────────────────────┘                              │
│                                                                        │
│  Customer: "كم سعر القميص الأزرق؟"                                     │
│  AI: "القميص الأزرق سعره 120 ريال، متوفر بمقاسات S, M, L 😊"          │
│  → confidence: HIGH                                                    │
│  → flags: []                                                           │
│                                                                        │
│  Customer: "ما سياسة الإرجاع؟"                                         │
│  AI: "يمكنك الإرجاع خلال 14 يوم من تاريخ الاستلام..."                 │
│  → confidence: HIGH (from policies)                                    │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### What Product Data Looks Like in Prompt

```
<product_catalog>
Top Products:
1. iPhone 15 Pro — 3,800 SAR — black, silver, gold — in stock
2. Samsung Galaxy S24 — 2,900 SAR — blue, gray — in stock
3. MacBook Air M3 — 5,200 SAR — 256GB, 512GB — low stock
4. AirPods Pro — 850 SAR — white — out of stock
5. iPad Air — 2,400 SAR — 64GB, 256GB — in stock
...
[Max 15 products, ~800 characters total]
</product_catalog>
```

### Supported E-Commerce Platforms

| Platform | Status | OAuth | Token Expiry | Max Products |
|----------|--------|-------|-------------|--------------|
| **Shopify** | Active | OAuth 2.0 | Never expires | GraphQL (unlimited) |
| **Salla** | Active | OAuth 2.0 | 14 days (auto-refresh) | REST, max 260 |
| **Zid** | Schema ready | - | - | Not yet implemented |

### Product Sync → Cache Invalidation

```
Products synced from Shopify/Salla
         │
         ▼
┌──────────────────────────────┐
│ 1. Delete old products       │
│ 2. Insert new products       │
│ 3. Rebuild productSummary    │
│ 4. Update productCount       │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ INVALIDATE AI CACHES:        │
│ 1. Bump kbVersion per page   │
│ 2. Flush Redis exact cache   │
│ 3. Delete semantic cache     │
│ 4. Re-ingest KB + products   │
│    into RAG (new embeddings) │
│ 5. Activate new kbVersion    │
│    (atomic — no empty window)│
└──────────────────────────────┘
```

## عربي

### مقارنة السيناريوهات

**بدون متجر إلكتروني:**
- الذكاء الاصطناعي يحصل فقط على قاعدة المعرفة النصية
- لا كتالوج منتجات، لا سياسات متجر
- أسئلة عن المنتجات والأسعار → "خليني أتحقق" (ثقة منخفضة)
- أسئلة عامة (مواعيد، موقع) → يُجيب إذا كانت في قاعدة المعرفة

**مع متجر إلكتروني (Shopify/Salla):**
- الذكاء الاصطناعي يحصل على:
  - قاعدة المعرفة + أجزاء RAG
  - سياسات المتجر (شحن، إرجاع، ضمان) — حتى 2,000 حرف
  - كتالوج المنتجات (أعلى 15 منتج) — اسم، سعر، مقاسات/ألوان، حالة المخزون
- أسئلة عن المنتجات → يُجيب بالتفاصيل والأسعار (ثقة عالية)
- أسئلة عن السياسات → يُجيب من سياسات المتجر

**المنصات المدعومة:**
- **Shopify**: نشط، OAuth 2.0، التوكن لا ينتهي أبداً
- **سلة (Salla)**: نشط، OAuth 2.0، التوكن ينتهي كل 14 يوم (تجديد تلقائي)
- **زد (Zid)**: المخطط جاهز لكن التكامل لم يُنفذ بعد

---

# 7. Knowledge Base and RAG
# قاعدة المعرفة ونظام RAG

## English

### How Knowledge Flows Through the System

```
┌────────────────────────────────────────────────────────────────┐
│                 KNOWLEDGE BASE PIPELINE                        │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  MERCHANT writes KB text in settings                           │
│  "ساعات العمل من 9 صباحاً حتى 6 مساءً                         │
│   الشحن مجاني للطلبات فوق 200 ريال                             │
│   لدينا فرعين: الرياض وجدة"                                    │
│         │                                                      │
│         ▼                                                      │
│  ┌──────────────────────────────────────┐                      │
│  │  CHUNKING                            │                      │
│  │  Split by double-newline or topic    │                      │
│  │  Auto-detect type per chunk:         │                      │
│  │    • hours → "ساعات العمل من 9..."   │                      │
│  │    • policy → "الشحن مجاني..."       │                      │
│  │    • location → "لدينا فرعين..."     │                      │
│  │  Max 800 tokens per chunk            │                      │
│  └──────────────┬───────────────────────┘                      │
│                 │                                               │
│                 ▼                                               │
│  ┌──────────────────────────────────────┐                      │
│  │  EMBEDDING                           │                      │
│  │  text-embedding-3-small (512 dims)   │                      │
│  │  Normalize Arabic before embedding   │                      │
│  │  Store in kb_chunks table            │                      │
│  │  with pgvector HNSW index            │                      │
│  └──────────────┬───────────────────────┘                      │
│                 │                                               │
│                 ▼                                               │
│  ┌──────────────────────────────────────┐                      │
│  │  VERSION ACTIVATION                  │                      │
│  │  kbVersion bumped                    │                      │
│  │  kbActiveVersion set AFTER all       │                      │
│  │  chunks stored (atomic, no gaps)     │                      │
│  └──────────────────────────────────────┘                      │
│                                                                │
│  ─────────── CUSTOMER ASKS QUESTION ───────────                │
│                                                                │
│  Customer: "هل الشحن مجاني؟"                                   │
│         │                                                      │
│         ▼                                                      │
│  ┌──────────────────────────────────────┐                      │
│  │  HYBRID RETRIEVAL                    │                      │
│  │                                      │                      │
│  │  1. Embed query → vector            │                      │
│  │  2. Vector search: top-20 (HNSW)    │                      │
│  │  3. Trigram re-rank (pg_trgm)       │                      │
│  │  4. Fuse scores:                    │                      │
│  │     0.7 * vector + 0.3 * trigram    │                      │
│  │     + language bonus                 │                      │
│  │  5. Filter > 0.3 threshold          │                      │
│  │  6. Return top-5 chunks              │                      │
│  └──────────────────────────────────────┘                      │
│                                                                │
│  AI receives relevant chunks:                                  │
│  [policy: "الشحن مجاني للطلبات فوق 200 ريال"]                  │
│                                                                │
│  AI reply: "نعم! الشحن مجاني للطلبات فوق 200 ريال 😊"          │
│  → confidence: HIGH                                            │
└────────────────────────────────────────────────────────────────┘
```

### RAG Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `off` | No retrieval, use static KB only | Legacy / simple businesses |
| `shadow` | Run retrieval + log, but AI uses static KB | A/B testing retrieval quality |
| `on` | Use retrieved chunks, drop static KB | Production (recommended) |

### KB Gap Detection

When the AI can't find an answer in KB:
1. Query recorded in `kbGaps` table
2. Similar queries deduplicated (trigram similarity)
3. Occurrence count incremented
4. At count **>=3**: merchant notified
5. When merchant updates KB: all gaps auto-resolved

## عربي

### كيف تتدفق المعرفة عبر النظام

**المرحلة 1: التاجر يكتب قاعدة المعرفة**
- نص حر في إعدادات الصفحة
- يُقسم تلقائياً إلى أجزاء حسب الموضوع

**المرحلة 2: التقطيع (Chunking)**
- تقسيم بالسطر المزدوج أو الموضوع
- كشف تلقائي لنوع كل جزء (ساعات، سياسة، موقع، عرض، إلخ)
- حد أقصى 800 توكن لكل جزء

**المرحلة 3: التضمين (Embedding)**
- text-embedding-3-small (512 بُعد)
- تطبيع العربية قبل التضمين (إزالة التشكيل، توحيد الألف)
- تخزين في جدول `kb_chunks` مع فهرس pgvector HNSW

**المرحلة 4: الاسترجاع الهجين عند السؤال**
1. تضمين السؤال → متجه
2. بحث متجهي: أعلى 20 مرشح (HNSW)
3. إعادة ترتيب بالتشابه النصي (pg_trgm)
4. دمج النتائج: 0.7 * متجه + 0.3 * نص + مكافأة اللغة
5. تصفية > عتبة 0.3
6. إرجاع أعلى 5 أجزاء

**كشف الفجوات:**
- يُسجل السؤال في جدول `kbGaps`
- الأسئلة المتشابهة تُدمج
- عند بلوغ 3 مرات: إشعار للتاجر
- عند تحديث قاعدة المعرفة: كل الفجوات تُحل تلقائياً

---

# 8. Caching Strategy
# استراتيجية التخزين المؤقت

## English

### 3-Layer Cache Architecture

```
Customer question arrives
         │
         ▼
┌──────────────────────────────────────┐
│  LAYER 1: EXACT CACHE (Redis)        │
│                                      │
│  Key: SHA256(                        │
│    normalized_comment +              │
│    language +                        │
│    pageId +                          │
│    kbActiveVersion +                 │
│    postMessage +                     │
│    storePolicies_hash +              │
│    replyStyle +                      │
│    PROMPT_VERSION                    │
│  )                                   │
│                                      │
│  Value: {reply, intent,              │
│          confidence, flags}          │
│  TTL: 30 days                        │
│                                      │
│  Fallback: PostgreSQL aiCache table  │
├────────────┬─────────────────────────┘
│  MISS      │ HIT → Return (zero cost)
│            │
▼            │
┌──────────────────────────────────────┐
│  LAYER 2: SEMANTIC CACHE (pgvector)  │
│                                      │
│  Query embedding vs cached embeddings│
│  Scoped by:                          │
│    • pageId                          │
│    • intent category                 │
│    • kbActiveVersion                 │
│    • promptVersion                   │
│    • channel (comment/dm) *          │
│    • replyStyle *                    │
│    (* stored in metadata JSONB,      │
│       filtered application-side)     │
│                                      │
│  Thresholds (per intent):            │
│    GREETING: 0.88 (low bar)          │
│    COMPLAINT: 0.95 (high bar)        │
│    Default: 0.93                     │
│                                      │
│  Skipped for OTHER intent            │
├────────────┬─────────────────────────┘
│  MISS      │ HIT → Return cached reply
│            │
▼            │
┌──────────────────────────────────────┐
│  LAYER 3: FULL AI CALL               │
│                                      │
│  HTTP POST to AI Worker (:3002)      │
│  Circuit breaker protection          │
│  Timeout: 30 seconds                 │
│                                      │
│  On success: save to both caches     │
│  On failure: return fallback reply   │
└──────────────────────────────────────┘
```

### What Invalidates the Cache

| Event | Exact Cache | Semantic Cache |
|-------|------------|----------------|
| KB updated | Old keys stale (new kbVersion) | Old entries filtered out |
| Products synced | Redis flushed | Rows deleted |
| Policies changed | Hash changes = new keys | Auto (part of KB ingest) |
| Reply style changed | New keys (style in hash) | N/A |
| Prompt version bumped | New keys (version in hash) | Old entries filtered |

## عربي

### بنية الكاش ثلاثية الطبقات

**الطبقة 1: الكاش الدقيق (Redis)**
- مفتاح: SHA256 (التعليق + اللغة + معرف الصفحة + إصدار KB + المنشور + السياسات + الأسلوب + إصدار الأوامر)
- القيمة: {الرد، النية، الثقة، الأعلام}
- مدة الصلاحية: 30 يوم
- احتياطي: PostgreSQL

**الطبقة 2: الكاش الدلالي (pgvector)**
- تضمين السؤال مقابل التضمينات المخزنة
- عتبات حسب النية: تحية=0.88، شكوى=0.95، افتراضي=0.93

**الطبقة 3: استدعاء AI كامل**
- HTTP POST إلى AI Worker
- حماية بقاطع الدائرة
- مهلة: 30 ثانية

---

# 9. Safety and Validation
# الأمان والتحقق

## English

### 3-Layer Input Sanitization

```
┌────────────────────────────────────────────────────────────────┐
│                 SANITIZATION LAYERS                             │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  LAYER 1: Customer Message                                     │
│  • Strip HTML tags                                             │
│  • Remove prompt injection patterns:                           │
│    - "ignore all previous instructions"                        │
│    - "act as", "SYSTEM:", "OVERRIDE:"                          │
│    - Special tokens: <|endoftext|>, etc.                       │
│  • Cap at 2,000 characters                                     │
│                                                                │
│  LAYER 2: KB Content                                           │
│  • Same injection pattern removal                              │
│  • Applied on save AND retrieval                               │
│                                                                │
│  LAYER 3: Page Name                                            │
│  • Remove quotes, newlines, backslashes                        │
│  • Truncate to 100 characters                                  │
│                                                                │
│  LAYER 4: Arabic Text Normalization                            │
│  • Remove diacritics (harakat)                                 │
│  • Normalize alef variants (أ/إ/آ → ا)                        │
│  • Remove tatweel (ـ)                                          │
│  • Normalize Arabic digits (٠-٩ → 0-9)                        │
└────────────────────────────────────────────────────────────────┘
```

### Safety Actions by Scenario

| Scenario | Detection | Action | Merchant Notified? |
|----------|-----------|--------|-------------------|
| Offensive comment | intent = OFFENSIVE | Empty reply, flag for review | Yes |
| Spam/irrelevant | intent = SPAM_OR_IRRELEVANT | Empty reply, don't send | No |
| Price hallucination | `price_not_in_kb` flag | Replace with safe fallback | Yes |
| Low confidence + hold | confidence=low + setting on | Don't send, flag for review | Yes |
| Angry customer | `angry_customer` flag | Send reply + notify merchant | Yes |
| AI worker down | Circuit breaker open | Lightweight fallback reply | No |
| Invalid JSON from AI | Parse error | Use raw text + `invalid_json` flag | No |
| Rate limit exceeded | >10 msgs/min | Skip silently | No |

### Circuit Breaker

```
Healthy → CLOSED (normal)
    │
    5 consecutive failures
    │
    ▼
Failing → OPEN (all requests get fallback)
    │
    30-second timeout
    │
    ▼
    HALF-OPEN (try one request)
    │
    ├── Success → CLOSED
    └── Failure → OPEN
```

## عربي

### إجراءات الأمان حسب السيناريو

| السيناريو | الكشف | الإجراء | إشعار التاجر؟ |
|-----------|-------|---------|--------------|
| تعليق مسيء | نية = OFFENSIVE | رد فارغ، تعليم للمراجعة | نعم |
| سبام | نية = SPAM | رد فارغ، لا إرسال | لا |
| هلوسة أسعار | علم `price_not_in_kb` | استبدال بالرد الآمن | نعم |
| ثقة منخفضة + احتجاز | confidence=low + مفعّل | لا إرسال، مراجعة | نعم |
| عميل غاضب | علم `angry_customer` | إرسال + إشعار التاجر | نعم |
| AI Worker معطل | قاطع الدائرة مفتوح | رد احتياطي خفيف | لا |

---

# 10. Edge Cases and Scenarios
# حالات خاصة وسيناريوهات

## English

### Scenario 1: Rapid-Fire Messages (Debounce + Consolidation)

```
Customer sends 3 messages quickly (replyDelay=0, fast-path debounce):
  t=0ms:   "hi"
  t=200ms: "How much for blue shirt?"
  t=400ms: "Do you have XL?"

RESULT:
  "hi"         → Processed → Reply: "Hi! 👋"
  "blue shirt?" → DEBOUNCED (newer msg exists) → SKIPPED
  "Do you have XL?" → Processed → Reply: "Yes, XL available!"

With replyDelay=3s (consolidation window):
  t=0ms:   "hi"           → Stored, skip debounce, wait 3s...
  t=200ms: "blue shirt?"  → Stored, skip debounce, wait 3s...
  t=400ms: "Do you have XL?" → Stored, skip debounce, wait 3s...

  t=3400ms: "Do you have XL?" job wakes → post-delay debounce: no newer →
            consolidates all 3 → AI reply: "Hi! XL blue shirt is $50, yes available!"
  t=3200ms: "blue shirt?" job wakes → post-delay debounce: newer exists → SKIPPED
  t=3000ms: "hi" job wakes → post-delay debounce: newer exists → SKIPPED
```

### Scenario 2: Human Agent Takes Over

```
0:00 - Customer asks → AI replies
0:05 - Customer follow-up → AI replies
0:10 - Human agent sends manual reply → AUTO-PAUSE (15 min)
0:12 - Customer messages → PAUSED → re-enqueued
0:25 - Pause expires → AI processes → Reply sent
```

### Scenario 3: Comment vs DM - Same Question

```
Question: "كم سعر القميص الأزرق وهل متوفر بمقاس XL؟"

AS COMMENT (public):                   AS DM (private):
─────────────────────                  ──────────────────
"شكراً لسؤالك! راسلنا                  "القميص الأزرق سعره 120 ريال
 وبنعطيك كل التفاصيل 😊"               ومتوفر بمقاسات S, M, L, XL.
                                        نقدر نرسله لأي مكان
• Max 40 words                          بالمملكة والشحن مجاني
• No prices                             للطلبات فوق 200 ريال 😊"
• Redirect to DM
                                       • Full details + prices
                                       • Shipping info included
```

### Scenario 4: DM Context Continuity

```
Msg 1 (customer): "ما هي المنتجات المتوفرة؟"
Reply 1 (AI): "لدينا iPhone 15 Pro بـ 3,800 ريال..."

Msg 2 (customer): "عطيني تفاصيل أكثر"  ← VAGUE

RAG QUERY ENRICHMENT (v14):
  Original query: "عطيني تفاصيل أكثر" (≤6 words = vague)
  Last assistant reply: "لدينا iPhone 15 Pro بـ 3,800 ريال..."
  Enriched query: "لدينا iPhone 15 Pro بـ 3,800 ريال... عطيني تفاصيل أكثر"
  (capped at 300 chars for embedding cost/quality)
  → RAG finds iPhone 15 Pro chunk (not random product!)

AI MUST: Talk about iPhone (from previous exchange)
AI MUST NOT: Ask "which product?" or switch topic
```

### Scenario 5: Outside Business Hours

```
Settings: businessHoursOnly=true, 09:00-18:00, Asia/Riyadh
Customer messages at 21:00 Riyadh time:
→ Away message: "شكراً لتواصلك! سنرد عليك خلال ساعات العمل 🕐"
→ NO AI processing
```

### Scenario 6: Template Match vs AI

```
Rules: Priority 0: keywords=["سعر","كم"] → "الأسعار على الموقع"
Customer: "كم سعر الشحن؟"
→ "سعر" matches Rule 0
→ Template reply sent (AI NEVER called = zero cost!)
```

### Scenario 7: Product Not in Catalog

```
Catalog: iPhone 15, Galaxy S24, AirPods Pro
Customer: "عندكم Samsung Tab S9?"
AI: "خليني أتحقق من توفر Samsung Tab S9 وبرجعلك!"
→ confidence: LOW, flags: [info_not_in_kb]
→ NOT "we don't have it" (inference, not fact!)
```

## عربي

### السيناريو 1: رسائل متتالية سريعة (إزالة الازدواجية + التجميع)
- العميل يرسل 3 رسائل بسرعة
- **بدون تأخير رد** (replyDelay=0): مسار سريع — الرسالة الثانية تُتخطى، فقط 1 و 3 تحصل على ردود
- **مع تأخير رد** (replyDelay=3s): نافذة تجميع — جميع الرسائل تنتظر، ثم تُجمع في رد واحد شامل
- إعادة فحص الازدواجية بعد التأخير تمنع الردود المكررة

### السيناريو 2: الوكيل البشري يتولى
- عند الرد اليدوي → توقف تلقائي 15 دقيقة
- الرسائل خلال التوقف تُعاد جدولتها
- بعد انتهاء التوقف → AI يعود

### السيناريو 3: تعليق vs رسالة مباشرة
- التعليق: 40 كلمة كحد أقصى، لا أسعار، إحالة للرسائل
- الرسالة المباشرة: تفاصيل كاملة، أسعار، شحن

### السيناريو 4: استمرارية السياق (إثراء استعلام RAG - v14)
- "عطيني تفاصيل" بعد الحديث عن منتج → AI يتحدث عن نفس المنتج
- لا يسأل "أي منتج تقصد؟"
- **آلية إثراء الاستعلام**: إذا كان سؤال العميل غامضاً (≤6 كلمات)، يُضاف أول 100 حرف من آخر رد AI إلى استعلام RAG
- **حد أقصى**: 300 حرف للاستعلام المُثرى (للحفاظ على جودة وتكلفة التضمين)
- مثال: "شو مميزاتها؟" → يُصبح "لدينا iPhone 15 Pro بـ 3,800 ريال... شو مميزاتها؟"
- هذا يضمن أن RAG يجد الأجزاء المتعلقة بالمنتج الصحيح بدلاً من منتج عشوائي

### السيناريو 5: خارج ساعات العمل
- إرسال رسالة الغياب، لا معالجة AI

### السيناريو 6: قالب vs AI
- القوالب تُفحص أولاً = صفر تكلفة عند التطابق

### السيناريو 7: منتج غير موجود
- AI لا يقول "ما عندنا" (استنتاج وليس حقيقة!)
- يقول "خليني أتحقق" → ثقة منخفضة

---

# 11. Known Gaps
# فجوات معروفة ومخاوف ما قبل الإطلاق

## English

### Pre-Launch Concerns

| # | Gap | Severity | Impact |
|---|-----|----------|--------|
| 1 | Zid e-commerce not implemented | Medium | Zid merchants can't connect |
| 2 | No scheduled product sync | Medium | Manual "Sync Now" only |
| 3 | Single-language KB | Medium | Must mix both languages in one text |
| 4 | Templates not auto-translated | Low | Manual both-language maintenance |
| 5 | No visual regression tests | Medium | RTL/landscape may break silently |
| 6 | One store per workspace | Low | Multi-store needs workaround |
| 7 | No pluralization in i18n | Low | "1 Pages" instead of "1 Page" |
| 8 | Inventory is point-in-time | Info | AI adds "verify before ordering" caveat |

### System Resilience

| Failure Point | What Happens | User Impact |
|---------------|-------------|-------------|
| AI Worker down | Circuit breaker → fallback | Generic replies |
| Redis down | Fail-open → bypass cache | Higher cost |
| PostgreSQL down | Fatal → service down | No replies |
| OpenAI API down | Timeout → fallback | Generic replies |
| Facebook API down | Webhook retries | Delayed replies |
| Salla token expires | Auto-refresh | Transparent |

### Key Numbers

| Config | Value |
|--------|-------|
| AI Model | gpt-4.1-mini |
| Max Output Tokens | 300 |
| Temperature | 0.3 |
| Max Input Tokens | 24,000 |
| KB Max Chars | 16,000 |
| Product Catalog | 15 products, 800 chars |
| Store Policies | 2,000 chars max |
| Rate Limit | 10 msgs/min per sender |
| Worker Concurrency | 5 jobs |
| Cache TTL | 30 days |
| Prompt Version | v14 |
| Queue Retries | 3 (exponential backoff) |
| Handoff Pause | 15 minutes default |

## عربي

### مخاوف ما قبل الإطلاق

| # | الفجوة | الشدة | التأثير |
|---|--------|-------|---------|
| 1 | تكامل زد غير مُنفذ | متوسط | تجار زد لا يمكنهم الربط |
| 2 | لا مزامنة تلقائية للمنتجات | متوسط | يدوية فقط |
| 3 | قاعدة معرفة بلغة واحدة | متوسط | خلط اللغتين في نص واحد |
| 4 | القوالب لا تُترجم تلقائياً | منخفض | صيانة يدوية |
| 5 | لا اختبارات بصرية | متوسط | أعطال RTL قد لا تُكتشف |
| 6 | المخزون نقطة زمنية | معلوماتي | AI يضيف "تأكد قبل الطلب" |

### مرونة النظام

| نقطة الفشل | ماذا يحدث | التأثير |
|------------|-----------|---------|
| AI Worker معطل | قاطع الدائرة → ردود احتياطية | ردود عامة |
| Redis معطل | تجاوز الكاش → تكلفة أعلى | بطء |
| PostgreSQL معطل | الخدمة تتوقف | لا ردود |
| OpenAI معطل | مهلة → رد احتياطي | ردود عامة |

---

# Quick Reference Card / بطاقة مرجعية سريعة

```
╔══════════════════════════════════════════════════════════════════╗
║                    JAWAB24 QUICK REFERENCE                      ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  REPLY PRIORITY:                                                 ║
║  1. Template match (keyword rules) → FREE, instant              ║
║  2. Exact cache hit (Redis/Postgres) → FREE, instant            ║
║  3. Semantic cache hit (pgvector) → FREE, instant               ║
║  4. Full AI call (gpt-4.1-mini) → COST, ~2-5 seconds           ║
║  5. Fallback (circuit breaker open) → FREE, instant             ║
║                                                                  ║
║  SAFETY CHAIN:                                                   ║
║  Input sanitization → AI generation → 6 post-checks →           ║
║  Offensive filter → Price hallucination filter →                 ║
║  Low confidence filter → Send or hold                            ║
║                                                                  ║
║  INTENTS: QUESTION | COMPLIMENT | COMPLAINT | PURCHASE_INTENT   ║
║           GREETING | BUSINESS_INQUIRY | OFFENSIVE |              ║
║           SPAM_OR_IRRELEVANT                                     ║
║                                                                  ║
║  CONFIDENCE: HIGH (KB-backed) | MEDIUM (partial) | LOW (guess)  ║
║                                                                  ║
║  KEY LIMITS:                                                     ║
║  • Comment reply: 40 words max (public)                          ║
║  • DM reply: 3-4 sentences with detail                           ║
║  • KB: 16,000 chars / Products: 15 items, 800 chars             ║
║  • Rate: 10 msgs/min per sender per page                         ║
║  • Token budget: 24,000 input tokens                             ║
║  • Cache: 30-day TTL, version-scoped                             ║
║                                                                  ║
║  PORTS: Frontend=3001 | Backend=3000 | AI Worker=3002            ║
║  MODEL: gpt-4.1-mini | PROMPT: v14 | TEMP: 0.3                  ║
╚══════════════════════════════════════════════════════════════════╝
```
