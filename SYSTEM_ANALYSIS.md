# Jawab24 - Complete System Analysis / تحليل النظام الكامل

> **System Reference Document / وثيقة مرجعية للنظام**
> Generated: 2026-02-28 | Updated: 2026-04-04 (v27 — WhatsApp Cloud API backend: `whatsapp_message` job type, WhatsApp adapter, `platformMessageId` column replacing `facebookMessageId`/`instagramMessageId`, Meta Tech Provider Embedded Signup plan)

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
11. [Known Gaps & Concerns / فجوات معروفة ومخاوف](#11-known-gaps)
12. [Monitoring & Alerting / المراقبة والتنبيهات](#12-monitoring--alerting)
13. [Launch Defaults / القيم الافتراضية عند الإطلاق](#launch-defaults-single-source-of-truth)
14. [RBAC & Workspace System / نظام الأدوار ومساحات العمل](#14-rbac--workspace-system)
15. [Security: Token Encryption / الأمان: تشفير التوكنات](#15-security-token-encryption)
16. [Content & SEO / المحتوى وتحسين محركات البحث](#16-content--seo)

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
- Facebook Graph API (comments + DMs) — Live (App ID: 774211662298446)
- Instagram Graph API (comments + DMs) — backend complete; Instagram permissions pending Meta App Review
- WhatsApp Cloud API (DMs) — backend complete; Meta Tech Provider Embedded Signup approval pending
- Shopify API (products + policies)
- Salla API (products + policies)
- Zid API (products + policies — Saudi Arabia)
- OpenAI API (reply generation + embeddings + translation)
- Stripe API (subscriptions + billing; Embedded Checkout with PaymentElement, monthly + yearly billing intervals, Billing Portal for plan changes)
- Vonage SMS API (phone OTP authentication + team invites)

## عربي

Jawab24 هو **مستودع أحادي (monorepo)** يتكون من 3 خدمات + حزمة مشتركة:

**الخدمات:**
- **الواجهة الأمامية** (منفذ 3001): Next.js 15 + Tailwind + Capacitor (للموبايل)
- **الخادم الخلفي** (منفذ 3000): Fastify 5 + Drizzle ORM + PostgreSQL + Redis
- **عامل الذكاء الاصطناعي** (منفذ 3002): Fastify 5 + واجهة OpenAI (gpt-4.1-mini)
- **الحزمة المشتركة**: أنواع TypeScript، ثوابت، أدوات تنظيف المدخلات

**التكاملات الخارجية:**
- Facebook Graph API (التعليقات + الرسائل المباشرة) — مباشر (App ID: 774211662298446)
- Instagram Graph API (التعليقات + الرسائل المباشرة) — الكود مكتمل؛ صلاحيات Instagram قيد مراجعة Meta
- WhatsApp Cloud API (الرسائل المباشرة) — الكود مكتمل؛ موافقة Meta Tech Provider Embedded Signup قيد الانتظار
- Shopify API (المنتجات + السياسات)
- Salla API (المنتجات + السياسات)
- Zid API (المنتجات + السياسات — المملكة العربية السعودية)
- OpenAI API (توليد الردود + التضمينات + الترجمة)
- Stripe API (الاشتراكات + الفواتير؛ Embedded Checkout مع PaymentElement، دوري شهري وسنوي)
- Vonage SMS API (رمز OTP عبر SMS + دعوة الفريق)

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
║  │    - whatsapp_message                   │                            ║
║  └────────────────┬────────────────────────┘                            ║
║                   │                                                     ║
║                   ▼                                                     ║
║  ┌─────────────────────────────────────────┐                            ║
║  │  STEP 3: VALIDATION CHECKS             │                            ║
║  │  ✓ Page exists & auto-reply enabled?    │                            ║
║  │  ✓ Platform auto-reply enabled?         │                            ║
║  │  ✓ Within business hours? (if setting)  │                            ║
║  │  ✓ Rate limit OK? (5/min comments,     │                            ║
║  │    10/min messages)                    │                            ║
║  │  ✓ Handoff pause active? (human agent) │                            ║
║  │  ✓ Already replied?                     │                            ║
║  │  ✓ Debounce (fast-path only, skipped   │                            ║
║  │    when replyDelay > 0)                │                            ║
║  └────────────────┬────────────────────────┘                            ║
║                   │                                                     ║
║                   ▼                                                     ║
║  ┌─────────────────────────────────────────┐                            ║
║  │  STEP 3b: DISTRIBUTED LOCK (Redis)     │                            ║
║  │  • SET reply_lock:{pageId}:{senderId}  │                            ║
║  │    EX 60 NX (one-shot acquire)         │                            ║
║  │  • If held → skip (another worker has  │                            ║
║  │    it); prevents double-replies         │                            ║
║  │  • Released in finally (Lua CAS)       │                            ║
║  └────────────────┬────────────────────────┘                            ║
║                   │                                                     ║
║          ┌────────┴─────────┐                                           ║
║          │ FIRST CONVERSATION│                                          ║
║          └────────┬─────────┘                                           ║
║             YES   │                                                     ║
║                   ▼                                                     ║
║  ┌─────────────────────────────────────────┐                            ║
║  │  STEP 4: GREETING GATE (DMs only)        │                            ║
║  │  • Only on first-ever DM from sender   │                            ║
║  │  • Detect customer language             │                            ║
║  │  • Send greeting → mark replied → STOP │                            ║
║  │    (no AI processing after greeting)   │                            ║
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
║  │  • Price hallucination (2-tier)?        │                            ║
║  │    Tier A: currency-adjacent number     │                            ║
║  │    Tier B: price-cue phrase + number    │                            ║
║  │    → Replace with safe fallback         │                            ║
║  │  • Low confidence? → Hold for review    │                            ║
║  │    (AI draft shown in review UI)       │                            ║
║  │  • Comment > 50 words? → Flag            │                            ║
║  │  • Comment > 280 chars? → Truncate      │                            ║
║  │    (public mode only, at sentence)      │                            ║
║  └────────────────┬────────────────────────┘                            ║
║                   │                                                     ║
║                   ▼                                                     ║
║  ┌─────────────────────────────────────────┐                            ║
║  │  STEP 8b: TYPING INDICATOR (DMs only)  │                            ║
║  │  • Send "typing..." to Messenger/IG    │                            ║
║  │  • Shown before AI reply arrives       │                            ║
║  │  • Makes response feel more natural    │                            ║
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
│     ├─ Customer context (name + returning status, DMs only)     │
│     ├─ Reply style (professional/casual/enthusiastic)           │
│     └─ Brand voice notes                                        │
│                                                                 │
│  3. CHECK EXACT CACHE (Redis → Postgres fallback)               │
│     Key = SHA256(comment + lang + pageId + kbVersion +          │
│           postMsg + policies + style + promptVersion +          │
│           customerContext)                                      │
│     └─ HIT? → Return cached {reply, intent, confidence, flags} │
│                                                                 │
│  4. CHECK SEMANTIC CACHE (Vector similarity)                    │
│     └─ Skipped for PRICE/PURCHASE_INTENT (exact answers only)  │
│     └─ Skipped when customerContext present (personalized)      │
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
- هل حد المعدل مقبول؟ (5/دقيقة للتعليقات، 10/دقيقة للرسائل)
- هل هناك توقف تسليم نشط؟ (وكيل بشري)
- هل تم الرد مسبقاً؟
- إزالة الازدواجية (هل هناك رسالة أحدث قادمة؟)

**الخطوة 3ب: القفل الموزع (Redis)**
- اكتساب قفل لكل محادثة (SET NX EX 60)
- إذا كان محجوزاً → تخطي (عامل آخر يعالج)
- يُحرر في كتلة finally عبر سكريبت Lua CAS

**الخطوة 4: رسالة الترحيب** (للرسائل المباشرة فقط)
- فقط عند أول رسالة مباشرة من المرسل (على الإطلاق)
- كشف لغة العميل تلقائياً
- إرسال ترحيب → تعليم كمُرد عليها → **توقف** (لا معالجة AI بعد الترحيب)
- عند الفشل: تجاوز إلى الذكاء الاصطناعي كاحتياطي

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
- بناء السياق (قاعدة معرفة + منتجات + سياسات + تاريخ محادثة + سياق العميل)
- سياق العميل (للرسائل المباشرة فقط): اسم العميل + حالة عميل عائد
- فحص الكاش الدقيق (Redis/Postgres) — يشمل سياق العميل في المفتاح
- فحص الكاش الدلالي (تشابه متجهات) — يُتخطى عند وجود سياق عميل مخصص
- استدعاء AI Worker (OpenAI gpt-4.1-mini)
- حفظ في الكاش

**الخطوة 8: فلاتر الأمان**
- محتوى مسيء؟ → تخطي الرد وتعليم للمراجعة
- هلوسة أسعار (طبقتين)؟
  - الطبقة أ: رقم مجاور لعملة (SAR/$/ريال)
  - الطبقة ب: عبارة سعرية + رقم قريب (مثل "سعره 120"، "only 50")
  - → رد آمن بديل
- ثقة منخفضة؟ → احتجاز للمراجعة البشرية (مع عرض مسودة AI في واجهة المراجعة)
- تعليق > 50 كلمة؟ → إضافة علم `comment_too_long`
- تعليق > 280 حرف؟ → اقتطاع عند حدود الجملة (الوضع العام فقط)

**الخطوة 8ب: مؤشر الكتابة** (للرسائل المباشرة فقط)
- إرسال مؤشر "يكتب..." إلى Messenger/Instagram قبل الرد
- يجعل الرد يبدو أكثر طبيعية

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
│   ├── Comments OFF → ❌ Ignore silently (comment still stored) → STOP
│   └── Messages OFF → Send AWAY MESSAGE (language-matched, first msg only) → STOP
│
├── Is businessHoursOnly enabled?
│   ├── YES → Is it within business hours?
│   │   └── NO → Same as "platform disabled" above:
│   │       ├── Comments → ❌ Ignore silently → STOP
│   │       └── Messages → Send AWAY MESSAGE (first msg only) → STOP
│   └── NO → Continue
│
├── Is there an active HANDOFF PAUSE? (human agent took over)
│   └── YES → Re-enqueue with delay → STOP (max 3 retries)
│
├── Rate limit exceeded? (>5/min comments, >10/min messages per sender)
│   └── YES → ❌ Skip silently → STOP
│
├── Already replied to this message?
│   └── YES → ❌ Skip → STOP
│
├── [DM only, fast-path] Is there a newer unreplied message? (debounce)
│   └── Skipped when replyDelay > 0 (delay acts as consolidation window)
│   └── YES → ❌ Skip (newer job will handle) → STOP
│
├── ACQUIRE DISTRIBUTED LOCK (Redis SET NX EX 60)
│   └── ALREADY HELD → ❌ Skip (another worker handling) → STOP
│   └── ACQUIRED → Continue (released in finally block via Lua CAS)
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
├── Check SEMANTIC CACHE (skipped for PRICE/PURCHASE_INTENT) → HIT? → Go to Safety Filters
│
├── CALL AI WORKER → OpenAI gpt-4.1-mini
│   └── TIMEOUT/ERROR → Return FALLBACK reply
│
├── SAVE to caches (exact + semantic)
│
├── SAFETY FILTERS:
│   ├── Intent = OFFENSIVE or SPAM? → Flag → ❌ DON'T reply → STOP
│   ├── Flag = price_not_in_kb? → Replace with SAFE FALLBACK
│   │   (Tier A: currency-adjacent number not in KB)
│   │   (Tier B: price-cue phrase + nearby number not in KB)
│   ├── Confidence = low AND holdLowConfidence? → ❌ DON'T send (AI draft saved for review) → STOP
│   ├── [Comment] Reply > 50 words? → Add `comment_too_long` flag
│   ├── [Comment, public mode] Reply > 280 chars? → Truncate at sentence
│   ├── [Comment + QUESTION/PURCHASE] → Auto-append "DM us!"
│   └── [Comment + dual mode] → Pick random nudge variation (anti-spam)
│
├── [DM only] SEND TYPING INDICATOR → "typing..." to Messenger/Instagram
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
├── هل الرد التلقائي للمنصة مفعّل؟ (التعليقات/الرسائل منفصلة)
│   ├── التعليقات مُعطّلة → ❌ تجاهل بصمت (التعليق يُحفظ) → توقف
│   └── الرسائل مُعطّلة → إرسال رسالة الغياب (أول رسالة فقط) → توقف
│
├── هل وضع ساعات العمل فقط مفعّل؟
│   ├── نعم → هل نحن ضمن ساعات العمل؟
│   │   └── لا → نفس سلوك "المنصة مُعطّلة" أعلاه:
│   │       ├── التعليقات → ❌ تجاهل بصمت → توقف
│   │       └── الرسائل → إرسال رسالة الغياب (أول رسالة فقط) → توقف
│   └── لا → متابعة
│
├── هل هناك توقف تسليم نشط؟ (وكيل بشري تولى المحادثة)
│   └── نعم → إعادة جدولة مع تأخير → توقف
│
├── هل تجاوز حد المعدل؟ (>5/دقيقة تعليقات، >10/دقيقة رسائل)
│   └── نعم → ❌ تخطي → توقف
│
├── هل تم الرد مسبقاً؟
│   └── نعم → ❌ تخطي → توقف
│
├── [رسائل مباشرة] هل هناك رسالة أحدث غير مُرد عليها؟
│   └── نعم → ❌ تخطي (المهمة الأحدث ستتولى)
│
├── اكتساب قفل موزع (Redis SET NX EX 60)
│   └── القفل محجوز → ❌ تخطي (عامل آخر يعالج) → توقف
│   └── تم الاكتساب → متابعة (يُحرر في كتلة finally عبر Lua CAS)
│
├── [رسائل مباشرة] هل هذه أول رسالة من المرسل (على الإطلاق)؟
│   └── نعم → إرسال رسالة ترحيب → تعليم كمُرد عليها → **توقف** (لا AI)
│   └── فشل الإرسال → تجاوز إلى AI كاحتياطي
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
├── فحص الكاش (الدلالي يُتخطى لنوايا PRICE/PURCHASE_INTENT) → استدعاء AI Worker إذا لم يوجد
│
├── فلاتر الأمان:
│   ├── مسيء/سبام؟ → تعليم للمراجعة → لا رد
│   ├── هلوسة أسعار؟ → رد آمن بديل
│   ├── ثقة منخفضة + احتجاز مفعّل؟ → احتجاز للمراجعة (مع حفظ مسودة AI)
│   ├── [تعليق] > 50 كلمة؟ → إضافة علم `comment_too_long`
│   ├── [تعليق، وضع عام] > 280 حرف؟ → اقتطاع عند حدود الجملة
│   ├── [تعليق + سؤال] → إضافة "راسلنا للتفاصيل!"
│   └── [تعليق + وضع مزدوج] → اختيار صيغة تنبيه عشوائية (مكافحة السبام)
│
├── [رسائل مباشرة فقط] إرسال مؤشر "يكتب..."
│
└── إرسال الرد → تعليم كمُرد عليه → تخزين → إشعار
```

---

# 4. AI Prompt Construction
# بناء الأوامر للذكاء الاصطناعي

## English

### What Exactly Gets Sent to OpenAI

The system prompt sent to gpt-4.1-mini is approximately **3,000+ words** and consists of 9 sections:

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
│  │  • professional → "professional yet approachable —       │   │
│  │    like a knowledgeable colleague"                       │   │
│  │  • casual → "casual and relaxed — like texting a         │   │
│  │    helpful friend who knows the business"                │   │
│  │  • enthusiastic → "upbeat and enthusiastic —             │   │
│  │    genuinely excited to help"                            │   │
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
│  SECTION 4b: CUSTOMER CONTEXT (DMs only, conditional)          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Only present when customerContext is available:          │   │
│  │                                                          │   │
│  │ "CUSTOMER CONTEXT: Customer name: محمد.                  │   │
│  │  Returning customer (8 previous messages,                │   │
│  │  last active 2 days ago, past topics: QUESTION)."        │   │
│  │                                                          │   │
│  │ GPT uses this as information — no forced greeting        │   │
│  │ behavior. The AI naturally incorporates the name         │   │
│  │ and returning status when appropriate.                   │   │
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
| **Comment Too Long** | Word count > 50 for comment replies (AI Worker flags it; backend separately truncates at 280 chars for public mode) | Adds `comment_too_long` flag |
| **Language Mismatch** | Reply language differs from input language | Adds `language_mismatch` flag |
| **Hedge Words** | Detects "let me check", "سأتحقق", etc. with high/medium confidence | **Downgrades to LOW** + adds `info_not_in_kb` |
| **DM Deflection** | DM reply says "contact us" / "message us" | Adds `info_not_in_kb` + downgrades confidence |
| **Low Confidence Flag** | Low confidence without `info_not_in_kb` flag | **Auto-adds** `info_not_in_kb` flag |

### Valid Flags

| Flag | Meaning |
|------|---------|
| `info_not_in_kb` | Answer not found in knowledge base |
| `price_not_in_kb` | Reply mentions a price not in KB (hallucination!) |
| `angry_customer` | Customer seems angry/frustrated (structured 6-point trigger list, v19+) |
| `offensive_or_abusive` | Insults, profanity, threats |
| `low_confidence` | AI is uncertain about reply quality |
| `redirect_to_human` | Advised customer to contact human |
| `language_mismatch` | Reply language differs from input |
| `comment_too_long` | Public comment exceeded 50 words |
| `invalid_json` | AI returned non-JSON (parsing fallback) |

### Prompt Version History

| Version | Date | Key Changes | Eval Accuracy |
|---------|------|-------------|---------------|
| **v18** | 2026-03-02 | Customer awareness: pass customer name + returning status as context to GPT. Sharpened style descriptions. Natural behavior rules (vary structure, mirror dialect, emoji mirroring). | 98.3% |
| **v19** | 2026-03-05 | Structured `angry_customer` flag with explicit 5-point trigger list (strong words, refund demands, ignored complaints, exclamation marks, escalation threats). Added confidence rule: reply style changes TONE only, must NOT affect confidence. Added Arabic vague follow-up examples ("وش المدة؟"). | 99.6% |
| **v20** | 2026-03-06 | Made `angry_customer` trigger list non-exhaustive — added catch-all point (6): "any expression of strong dissatisfaction — use your judgment". Added Arabic colloquial examples (زفت/فشل). Clarified: polite complaint alone ≠ angry_customer. | 99.6% |
| **v21** | 2026-03-15 | Prompt tuning for eval accuracy and edge case handling. Workspace-scoped context. | 99.6% |
| **v22–v26** | 2026-03-29 – 2026-04-03 | Iterative prompt refinements and edge case tuning. | 99.6% (last measured at v19) |

### Fallback Classifier (when AI Worker is down)

When the AI worker circuit breaker opens, the 3-tier fallback chain activates:
1. **Tier 2 — Claude Haiku** (`AI_FALLBACK_MODEL=claude-haiku-4-5-20251001`): attempts LLM classification via Anthropic SDK
2. **Tier 3 — keyword classifier** (`fallbackClassifier.ts`): if Claude also fails, a zero-cost keyword-based classifier provides basic metadata (intent, confidence, flags) instead of returning empty data

The keyword classifier detects:
- Spam/irrelevant (emoji-only, mentions, spam keywords EN/AR/Franco, punctuation-only)
- Compliments (Arabic + English patterns, compliment emoji)
- Basic intent classification via keyword matching

This ensures pipeline metrics and downstream guards still function even without the AI worker.

## عربي

### ما الذي يُرسل بالضبط إلى OpenAI

يتكون الـ System Prompt من **3,000+ كلمة** مقسمة إلى 9 أقسام:

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

**القسم 4ب: سياق العميل** (للرسائل المباشرة فقط، اختياري)
- يظهر فقط عند توفر سياق العميل
- مثال: "اسم العميل: محمد. عميل عائد (8 رسائل سابقة، آخر نشاط قبل يومين)"
- GPT يستخدم هذه المعلومات بشكل طبيعي — بدون إجبار على التحية

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
| تعليق طويل | عدد الكلمات > 50 لردود التعليقات (AI Worker يعلّم؛ الخادم يقتطع منفصلاً عند 280 حرف في الوضع العام) | إضافة علم `comment_too_long` |
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
| **commentsAutoReply** | boolean | true | If false, ignore comments silently (no away message) |
| **messagesAutoReply** | boolean | true | If false, send away message (language-matched, first msg only) |
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
| **notificationsEnabled** | boolean | true | Push/in-app notifications. SSE badge/toast are skipped for disabled or disconnected pages. See Notification Channels below |
| **dashboardLanguage** | enum | 'ar' | UI language preference for dashboard |
| **aiModel** | string | gpt-4.1-mini | AI model selection (locked to DEFAULT_AI_MODEL) |
| **dualReplyNudgeMulti** | JSONB | {} | `{ar: "...", en: "..."}` - translated nudge messages |
| **dualReplyNudgeVariations** | JSONB | {} | `{ar: [...], en: [...]}` - anti-spam nudge variations per language |
| **brandVoiceNotesMulti** | JSONB | {} | `{ar: "...", en: "..."}` - translated brand voice notes |

### Notification Channels

| Channel | Status | Details |
|---------|--------|---------|
| **In-app (polling)** | Implemented | `NotificationBell` component polls unread count every 60 seconds |
| **SSE (Server-Sent Events)** | Implemented | Real-time dashboard updates — badge/toast for new messages, flagged replies |
| **Push (Capacitor native)** | Implemented | Native push notifications on iOS/Android via `@capacitor/push-notifications` |
| **E-commerce SMS notifications** | Implemented | Abandoned cart, order confirmed/shipped/delivered, review request — SMS via Vonage, BullMQ queue, per-store templates, Arabic/English auto-detected from phone prefix |

### Mobile / Capacitor

| Item | Details |
|------|---------|
| **Framework** | Capacitor 8 (native wrapper around Next.js) |
| **Platforms** | iOS (`frontend/ios/`) + Android (`frontend/android/`) |
| **Native features** | Push notifications, voice recording, biometric auth guards |
| **Published** | Not yet — pending Facebook App Review + app store submissions |

### Comments UI

Comments dashboard groups conversations by commenter + post, so all replies from the same person on the same post appear as a thread.

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
| **الرد التلقائي على التعليقات** | منطقي | مفعّل | إذا مُعطّل، تجاهل التعليقات بصمت (بدون رسالة غياب) |
| **الرد التلقائي على الرسائل** | منطقي | مفعّل | إذا مُعطّل، إرسال رسالة الغياب (أول رسالة فقط) |
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
| **لغة لوحة التحكم** | اختيار | عربي | لغة واجهة المستخدم |
| **نموذج AI** | نص | gpt-4.1-mini | نموذج الذكاء الاصطناعي |
| **نص التنبيه المترجم** | JSONB | {} | `{ar: "...", en: "..."}` - نصوص تنبيه الرد المزدوج |
| **تنويعات نص التنبيه** | JSONB | {} | `{ar: [...], en: [...]}` - صيغ متعددة لتجنب كشف السبام |
| **ملاحظات صوت العلامة المترجمة** | JSONB | {} | `{ar: "...", en: "..."}` - ملاحظات صوت العلامة بلغتين |

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
| **Zid** | **Active** | OAuth 2.0 | ~1 year (auto-refresh via Redis lock) | REST, paginated |

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
- **زد (Zid)**: نشط، OAuth 2.0، التوكن ينتهي بعد ~سنة (تجديد تلقائي بقفل Redis)

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

### Voice KB Input (Merchant Side)

Merchants can add KB content via voice recording in addition to typing:
- **UI**: `VoiceRecordButton.tsx` in the knowledge-base components
- **Transcription**: `backend/src/services/transcription.ts` — audio sent to GPT-4o-mini-transcribe
- **Flow**: Voice recording → upload → transcribe → transcription text inserted into KB text field → normal chunking/embedding pipeline

### File Upload for KB

Merchants can extract text from documents and images to populate KB content:

| Feature | Details |
|---------|---------|
| **Component** | `FileUploadButton.tsx` in `frontend/src/components/knowledge-base/` |
| **Backend** | `POST /kb/extract-text` — `backend/src/routes/kb-upload.ts` |
| **Extractor** | `backend/src/services/kb/file-extractor.ts` |
| **Formats** | PDF, Word (.docx), images (JPEG, PNG, WebP) |
| **Size limit** | 5MB per file |
| **PDF page limit** | First 5 pages only |
| **Text output cap** | 16,000 chars (same as KB limit) |
| **PDF/Word** | Free — `pdf-parse` v2 + `mammoth` (no API cost) |
| **Images/scanned PDFs** | GPT-4o-mini Vision — Business+ plans only |
| **Daily Vision quota** | Business: 10/day, Pro: 25/day (Redis counter) |
| **UX** | Paperclip icon next to mic icon in each KB section + onboarding |
| **Flow** | Upload → extract text → append to textarea → user reviews → save |

### Incoming Voice Messages (Customer Side)

When a customer sends a voice/audio message via Facebook Messenger or Instagram:
- **Handler**: `backend/src/services/reply/nonTextHandler.ts`
- **Flow**: Audio URL → GPT-4o-mini-transcribe → transcribed text → fed into AI reply pipeline (same as text message)
- **Fallback**: If transcription fails or message is non-audio (image, video, sticker) → store placeholder text + send nudge reply (e.g. "Please send a text message")
- **Non-text types handled**: voice, image, video, file, sticker

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

**الإدخال الصوتي لقاعدة المعرفة (من جانب التاجر):**
- `VoiceRecordButton.tsx` يتيح للتاجر تسجيل محتوى بصوته
- الصوت يُرسل إلى `backend/src/services/transcription.ts` ويُحوَّل نصاً عبر GPT-4o-mini-transcribe
- النص المحوَّل يدخل خط المعالجة المعتاد (تقطيع + تضمين)

**رسائل العميل الصوتية الواردة (من جانب العميل):**
- عند إرسال العميل رسالة صوتية عبر Messenger أو Instagram
- `nonTextHandler.ts` يتولى المعالجة: URL الصوت → GPT-4o-mini-transcribe → النص المحوَّل → خط معالجة AI كرسالة نصية عادية
- عند فشل التحويل أو وجود نوع آخر (صورة، فيديو، ملصق): تخزين نص بديل + إرسال رد توجيهي

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
│    PROMPT_VERSION +                  │
│    customerContext                   │
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
│  Skipped entirely for:               │
│    • PRICE intent                    │
│    • PURCHASE_INTENT intent          │
│    (exact answers required — only    │
│     exact hash cache remains active) │
│    • customerContext present         │
│    (personalized replies shouldn't   │
│     be served to other customers)    │
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
| Customer context differs | New keys (context in hash) | Skipped entirely |
| Prompt version bumped | New keys (version in hash) | Old entries filtered |

## عربي

### بنية الكاش ثلاثية الطبقات

**الطبقة 1: الكاش الدقيق (Redis)**
- مفتاح: SHA256 (التعليق + اللغة + معرف الصفحة + إصدار KB + المنشور + السياسات + الأسلوب + إصدار الأوامر + سياق العميل)
- القيمة: {الرد، النية، الثقة، الأعلام}
- مدة الصلاحية: 30 يوم
- احتياطي: PostgreSQL

**الطبقة 2: الكاش الدلالي (pgvector)**
- تضمين السؤال مقابل التضمينات المخزنة
- عتبات حسب النية: تحية=0.88، شكوى=0.95، افتراضي=0.93
- **يُتخطى بالكامل** لنوايا PRICE و PURCHASE_INTENT (تحتاج إجابات دقيقة)
- **يُتخطى بالكامل** عند وجود سياق عميل مخصص (ردود مخصصة لا يجب تقديمها لعملاء آخرين)

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
| Price hallucination (Tier A) | `price_not_in_kb` flag — currency-adjacent number not in KB (SAR/$/ريال etc.) | Replace with safe fallback | Yes |
| Price hallucination (Tier B) | `price_not_in_kb` flag — price-cue phrase + nearby number not in KB (e.g. "سعره 120", "only 50", "starts at 200") | Replace with safe fallback | Yes |
| Low confidence + hold | confidence=low + setting on | Don't send, flag for review | Yes |
| Angry customer | `angry_customer` flag | Send reply + notify merchant | Yes |
| AI worker down | Circuit breaker open | Lightweight fallback reply | No |
| Invalid JSON from AI | Parse error | Use raw text + `invalid_json` flag | No |
| Rate limit exceeded | >5/min (comments) or >10/min (messages) | Skip silently | No |

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
| هلوسة أسعار (الطبقة أ) | علم `price_not_in_kb` — رقم مجاور لعملة غير موجود في KB | استبدال بالرد الآمن | نعم |
| هلوسة أسعار (الطبقة ب) | علم `price_not_in_kb` — عبارة سعرية + رقم قريب غير موجود في KB (مثل "سعره 120"، "only 50") | استبدال بالرد الآمن | نعم |
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
Customer DMs at 21:00 Riyadh time:
→ Away message sent: "شكراً لتواصلك! سنرد عليك خلال ساعات العمل 🕐"
→ NO AI processing

Customer comments at 21:00 Riyadh time:
→ Comment stored in DB (visible in dashboard)
→ NO reply sent, NO away message (comments don't get away messages)
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
- الرسائل المباشرة: إرسال رسالة الغياب (أول رسالة فقط)، لا معالجة AI
- التعليقات: تُحفظ في قاعدة البيانات، لا رد ولا رسالة غياب

### السيناريو 6: قالب vs AI
- القوالب تُفحص أولاً = صفر تكلفة عند التطابق

### السيناريو 7: منتج غير موجود
- AI لا يقول "ما عندنا" (استنتاج وليس حقيقة!)
- يقول "خليني أتحقق" → ثقة منخفضة

---

# 11. Known Gaps
# فجوات معروفة ومخاوف

## English

### Current Gaps

| # | Gap | Severity | Impact |
|---|-----|----------|--------|
| ~~1~~ | ~~Zid e-commerce not implemented~~ | ~~RESOLVED~~ | Full Zid integration shipped — OAuth, sync, KB enrichment, AI agent tools, webhooks |
| ~~2~~ | ~~No scheduled product sync~~ | ~~RESOLVED~~ | Scheduled sync runs every 6 hours via `setInterval` in `index.ts` — **note**: `setInterval` doesn't survive process restart without external scheduler; acceptable for single-instance deploy |
| ~~3~~ | ~~No voice input for KB~~ | ~~RESOLVED~~ | Voice recording via VoiceRecordButton.tsx — transcribed via GPT-4o-mini-transcribe before KB ingestion |
| 4 | Single-language KB | Medium | Must mix both languages in one text |
| 5 | Templates not auto-translated | Low | Manual both-language maintenance |
| 6 | No visual regression tests | Medium | RTL/landscape may break silently (macOS baselines only) |
| 7 | One store per workspace | Low | Multi-store needs workaround |
| ~~8~~ | ~~No pluralization in i18n~~ | ~~RESOLVED~~ | Migrated to next-intl v4 with ICU Message Format support. Arabic uses all 6 CLDR plural forms (zero/one/two/few/many/other) |
| 9 | Inventory is point-in-time | Info | AI adds "verify before ordering" caveat |
| ~~10~~ | ~~E-commerce customer notifications (abandoned cart, order updates, review requests)~~ | ~~RESOLVED~~ | Shipped — SMS via Vonage, BullMQ worker, dedup by platformEventId, opt-in per template (is_enabled=false default) |

### System Resilience

| Failure Point | What Happens | User Impact |
|---------------|-------------|-------------|
| AI Worker down | Circuit breaker open → (Tier 2) Claude Haiku → (Tier 3) static reply + keyword classifier | Classified fallback replies (not empty metadata) |
| Redis down | Fail-open → bypass cache + lock | Higher cost, possible double-reply (rare) |
| PostgreSQL down | Fatal → service down | No replies |
| OpenAI API down | Timeout → fallback | Generic replies |
| Facebook API down | Webhook retries | Delayed replies |
| Salla token expires | Auto-refresh | Transparent |
| Reply lock stuck | TTL auto-expires after 60s | At most 60s delay for that sender |
| Page token compromised | AES-256-GCM encrypted at rest | Cannot read token from DB dump |

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
| Rate Limit (Comments) | 5/min per sender per page |
| Rate Limit (Messages) | 10/min per sender per page |
| Comment Reply Length | AI prompt: 40 words, flag: >50 words, hard truncate: >280 chars (public only) |
| Worker Concurrency | 5 jobs |
| Cache TTL | 30 days |
| Prompt Version | v26 |
| Pipeline Outcomes | 20 types x 4 pipelines |
| Eval Accuracy | 99.6% (measured at v19; current prompt is v26) |
| Scheduled Product Sync | Every 6 hours |
| Queue Retries | 3 (exponential backoff) |
| Handoff Pause | 15 minutes default |
| Reply Lock TTL | 60 seconds (Redis SET NX EX) |
| Reply Lock Key (DMs) | `reply_lock:{pageId}:{senderId}` |
| Reply Lock Key (comments) | `reply_lock:comment:{pageId}:{commentId}` |
| DB Migrations | 50 SQL files |
| DB Index | Composite: `(page_id, sender_id, direction, replied, created_at)` |
| Price Detection | Two-tier: Tier A (currency-adjacent) + Tier B (price-cue phrases) |
| Workspace Roles | owner (level 3), admin (level 2), member (level 1) |
| Page Token Encryption | AES-256-GCM at rest |
| E2E Spec Files | 19 Playwright spec files |

## عربي

### الفجوات الحالية

| # | الفجوة | الشدة | التأثير |
|---|--------|-------|---------|
| ~~1~~ | ~~تكامل زد غير مُنفذ~~ | ~~تم الحل~~ | تكامل زد كامل — OAuth، مزامنة، إثراء قاعدة المعرفة، أدوات AI، webhooks |
| ~~2~~ | ~~لا مزامنة تلقائية للمنتجات~~ | ~~تم الحل~~ | مزامنة تلقائية كل 6 ساعات عبر `setInterval` — **ملاحظة**: لا تنجو من إعادة تشغيل العملية؛ مقبول للنشر على خادم واحد |
| ~~3~~ | ~~لا إدخال صوتي لقاعدة المعرفة~~ | ~~تم الحل~~ | تسجيل صوتي عبر VoiceRecordButton.tsx — يُحوَّل نصاً عبر GPT-4o-mini-transcribe قبل الإضافة |
| 4 | قاعدة معرفة بلغة واحدة | متوسط | خلط اللغتين في نص واحد |
| 5 | القوالب لا تُترجم تلقائياً | منخفض | صيانة يدوية |
| 6 | لا اختبارات بصرية | متوسط | أعطال RTL قد لا تُكتشف |
| 7 | متجر واحد لكل مساحة عمل | منخفض | يتطلب حلاً بديلاً للمتعدد |
| ~~8~~ | ~~لا صيغ جمع في الترجمة~~ | ~~تم الحل~~ | تم الترحيل إلى next-intl v4 مع دعم ICU Message Format. العربية تستخدم جميع صيغ CLDR الستة |
| 9 | المخزون نقطة زمنية | معلوماتي | AI يضيف "تأكد قبل الطلب" |
| ~~10~~ | ~~إشعارات العملاء للتجارة الإلكترونية (سلة مهجورة، تحديثات الطلب، طلبات المراجعة)~~ | ~~تم الحل~~ | تم الشحن — SMS عبر Vonage، BullMQ worker، مكافحة التكرار بـ platformEventId، اشتراك اختياري لكل قالب |

### مرونة النظام

| نقطة الفشل | ماذا يحدث | التأثير |
|------------|-----------|---------|
| AI Worker معطل | قاطع الدائرة → مُصنّف احتياطي (تصنيف النية/الثقة/الأعلام بالكلمات المفتاحية) | ردود مُصنّفة (ليست بيانات فارغة) |
| Redis معطل | تجاوز الكاش + القفل | تكلفة أعلى، رد مزدوج ممكن (نادر) |
| PostgreSQL معطل | الخدمة تتوقف | لا ردود |
| OpenAI معطل | مهلة → رد احتياطي | ردود عامة |
| القفل معلق | ينتهي تلقائياً بعد 60 ثانية | تأخير 60 ثانية كحد أقصى لذلك المرسل |
| توكن الصفحة مُخترق | مشفر بـ AES-256-GCM في حالة السكون | لا يمكن قراءة التوكن من نسخة قاعدة البيانات |

---

# 12. Monitoring & Alerting
# المراقبة والتنبيهات

## English

### What's Already Instrumented

Jawab24 has a solid monitoring foundation across 5 layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                  OBSERVABILITY STACK                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  LAYER 1: PIPELINE METRICS (Redis counters)                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 20 outcome types × 4 pipelines = 80 counters            │   │
│  │ Endpoint: GET /health/pipeline-metrics                   │   │
│  │ Auth: x-cleanup-token header                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  LAYER 2: AI COST TRACKING (PostgreSQL)                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Every AI call: model, tokensIn, tokensOut, costUsd,      │   │
│  │ cached (bool), pipeline, userId, pageId                  │   │
│  │ Table: ai_usage_log (180-day retention)                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  LAYER 3: ERROR TRACKING (Sentry)                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ All 5xx errors, async failures, circuit breaker opens    │   │
│  │ Tags: service, context, action                           │   │
│  │ Trace sampling: 10% prod, 100% dev                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  LAYER 4: STRUCTURED LOGGING (Pino → stdout)                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Every pipeline step timed with lap timer (⏱ labels)      │   │
│  │ reply_sent event: method, intent, confidence, flags,     │   │
│  │ duration, consolidated count                             │   │
│  │ Auth headers auto-redacted in request logs               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  LAYER 5: HEALTH PROBES (HTTP endpoints)                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ GET /health        → full status (DB, Stripe, AI)        │   │
│  │ GET /health/live   → liveness (always 200)               │   │
│  │ GET /health/ready  → readiness (DB check)                │   │
│  │ GET /health/cache-stats → AI cache metrics               │   │
│  │ GET /health/pipeline-metrics → outcome counters          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Pipeline Metrics: All 20 Outcomes

These are tracked per pipeline (facebook_comment, instagram_comment, facebook_message, instagram_message, whatsapp_message):

| Outcome | What It Means | Severity |
|---------|--------------|----------|
| `success` | Reply sent successfully | Normal |
| `greeting_sent` | First-conversation greeting sent | Normal |
| `page_not_found` | Page doesn't exist in DB | Error |
| `no_user` | Page has no associated user | Error |
| `no_workspace` | Page has no associated workspace | Error |
| `auto_reply_disabled` | Platform auto-reply toggle off | Expected |
| `settings_disabled` | Workspace settings disabled | Expected |
| `post_disabled` | Post/media has auto-reply off | Expected |
| `media_disabled` | Instagram media auto-reply off | Expected |
| `debounce_skipped` | Newer message pending, skipped | Normal |
| `handoff_active` | Human agent pause active | Expected |
| `handoff_requeued` | Job re-enqueued after pause | Expected |
| `rate_limited` | Rate limit exceeded (5/min comments, 10/min messages) | Watch |
| `already_replied` | Already replied to this message | Normal |
| `lock_contention` | Redis lock held by another worker | Watch |
| `no_reply_generated` | AI/template failed to generate | Warning |
| `send_failed` | Generated but failed to send | Error |
| `skipped_risky` | Offensive/spam detected | Normal |
| `held_low_confidence` | AI reply held for review | Normal |
| `error` | Unhandled error in pipeline | Error |

### AI Cost Tracking

Every AI call logged to `ai_usage_log` table:

```
┌─────────────────────────────────────────────────────────┐
│  ai_usage_log row:                                      │
│  ┌───────────────────────────────────────────────────┐  │
│  │ userId:     who triggered                         │  │
│  │ pageId:     which page                            │  │
│  │ model:      gpt-4.1-mini                          │  │
│  │ tokensIn:   prompt tokens (0 if cached)           │  │
│  │ tokensOut:  completion tokens (0 if cached)       │  │
│  │ costUsd:    pre-computed USD cost                  │  │
│  │ cached:     true/false                             │  │
│  │ pipeline:   facebook_comment, etc.                │  │
│  │ createdAt:  timestamp                              │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  Cost computed by estimateCostUsd() from aiPricing      │
│  Fire-and-forget (never blocks reply pipeline)          │
│  On write failure: increments ai_usage_log.dropped      │
└─────────────────────────────────────────────────────────┘
```

### Cache Hit/Miss Events

| Log Event | Meaning |
|-----------|---------|
| `ai_cache_hit_with_metadata` | Redis exact cache hit (full metadata) |
| `ai_cache_hit_postgres` | Postgres fallback hit (Redis missed) |
| `ai_cache_miss_legacy_discarded` | Old format entry discarded |
| `ai_cache_miss_postgres_no_metadata` | Postgres row without metadata (skipped) |
| `ai_cache_miss` | Full miss, calling AI Worker |

### Circuit Breaker Observability

```
Normal operation: CLOSED
         │
    5 consecutive AI Worker failures
         │
         ▼
    OPEN (30 seconds)
    • Sentry warning on first open
    • Pipeline metric: circuit.ai_worker.opened
    • All requests get fallback reply via fallbackClassifier
    •   (keyword-based: detects spam, compliments, basic intents)
         │
    30s timeout expires
         │
         ▼
    HALF-OPEN (probe with Redis lock)
    • 1 request allowed through
    • Success → CLOSED
    • Failure → OPEN again

    Failure counter auto-resets after 300s idle
```

**Redis keys:**
- `cb:ai_worker:failures` — failure counter
- `cb:ai_worker:open` — open state with TTL
- `cb:ai_worker:probe_lock` — half-open probe lock
- `metrics:pipeline:circuit.ai_worker.opened` — total open count

**Config (env vars):**
- `CIRCUIT_BREAKER_FAILURE_THRESHOLD` (default: 5)
- `CIRCUIT_BREAKER_OPEN_DURATION_SECONDS` (default: 30)

### Sentry Integration Map

| Service | Error Tags | When |
|---------|-----------|------|
| Auth | `context: auth, action: create-*` | User/subscription creation |
| Pages | `service: kb-ingestion` | KB update, page sync |
| Facebook | `service: facebook` | Webhook, token refresh |
| Instagram | `service: instagram` | Webhook, token refresh |
| Shopify | `service: shopify` | Webhook registration |
| Salla | `service: salla` | Token refresh, webhooks |
| E-commerce | `service: {platform}` | Cache invalidation, claims |
| Settings | `context: settings` | Workspace sync failures |
| Notifications | `service: notifications` | Push send failures |
| Escalation | `service: escalation` | Sweep/notify failures |
| AI Worker | `circuit: ai_worker` | Circuit breaker opens |

**Sentry config:**
- Prod trace rate: 10%
- Error replay: 10% of errors
- Ignored: `Rate limit exceeded`, `ECONNREFUSED`, `ETIMEDOUT`, `ResizeObserver loop`

### Health Endpoints Detail

| Endpoint | Purpose | Auth | Status Codes |
|----------|---------|------|-------------|
| `GET /health` | Full service status (DB, Stripe, AI circuit) | None | 200 healthy/degraded, 503 unhealthy |
| `GET /health/live` | Liveness probe (Docker/K8s) | None | Always 200 |
| `GET /health/ready` | Readiness probe (DB connectivity) | None | 200 ready, 503 not ready |
| `GET /health/cache-stats` | AI cache: total entries, hits, age | x-cleanup-token | 200/403 |
| `GET /health/pipeline-metrics` | All 20×4 outcome counters | x-cleanup-token | 200/403 |
| `POST /health/cleanup` | Run DB cleanup (cache, logs, tokens) | x-cleanup-token | 200 |

### Database Cleanup Schedule

| Table | Retention | Batch Size | Trigger |
|-------|----------|------------|---------|
| `ai_cache` | 30 days (by `lastUsedAt`) | 1,000 rows | `POST /health/cleanup` |
| `logs` | 90 days | 1,000 rows | `POST /health/cleanup` |
| `ai_usage_log` | 180 days | 1,000 rows | `POST /health/cleanup` |
| `refresh_tokens` | Expired + revoked >7 days | All | `POST /health/cleanup` |

### Recommended Alert Thresholds

| Alert | Condition | Severity | Action |
|-------|-----------|----------|--------|
| **High error rate** | `error` outcome > 50 in 5 min | Critical | Check logs, likely infrastructure issue |
| **Circuit breaker open** | `circuit.ai_worker.opened` increments | High | AI Worker or OpenAI is down |
| **Send failures spike** | `send_failed` > 20 in 5 min | High | Facebook/Instagram API issue |
| **AI cost spike** | Daily costUsd > 2x baseline | Medium | Cache miss rate high, or traffic spike |
| **No-reply generated** | `no_reply_generated` > 100 in 1h | Medium | Template/AI both failing |
| **Rate limit storm** | `rate_limited` > 500 in 5 min | Medium | Bot/spam attack on a page |
| **Lock contention** | `lock_contention` > 50 in 5 min | Medium | Workers fighting over same sender |
| **Usage log drops** | `ai_usage_log.dropped` > 0 | Low | DB write issues (cost tracking gap) |
| **Cache hit rate low** | Exact cache hits < 30% of total | Low | Check if KB/products changed a lot |
| **Queue backlog** | BullMQ waiting > 10,000 jobs | Medium | Worker concurrency too low or stuck |
| **Held replies pile up** | `held_low_confidence` > 100/day | Low | KB may need updating (too many unknowns) |

### Structured Log Events: Complete Reference

#### Pipeline Timing (per message/comment)

Every pipeline step is timed with a lap timer:

```
[facebook_message] ⏱ 1-getPage           {ms: 2,  messageId: "..."}
[facebook_message] ⏱ 3-fetchSenderName    {ms: 45, messageId: "..."}
[facebook_message] ⏱ 4-storeMessage       {ms: 8,  messageId: "..."}
[facebook_message] ⏱ 5-debounce           {ms: 3,  messageId: "..."}
[facebook_message] ⏱ 6-isPaused           {ms: 2,  messageId: "..."}
[facebook_message] ⏱ 7-rateLimit          {ms: 1,  messageId: "..."}
[facebook_message] ⏱ 8-settingsCheck      {ms: 4,  messageId: "..."}
...
```

#### Reply Worker Lifecycle

```
[ReplyWorker] Starting job     {jobId, jobType, requestId, attemptNumber}
[ReplyWorker] Processing ...   {jobId, requestId, pageId, commentId|messageId}
[ReplyWorker] Job completed    {jobId, jobType, duration, replyMethod}
[ReplyWorker] Job failed       {jobId, jobType, duration, error, attemptsMade}
[ReplyWorker] Job stalled      {jobId}  ← watch for these!
```

#### Rate Limiting

```
[RateLimit] comment limit exceeded  {pageId, userId, count: 6, max: 5}  (warn)
[RateLimit] Redis error, allowing   {error: "ECONNREFUSED"}             (error)
```

### Analytics Queries Available

The `analytics` service computes these from live tables (30-day window):

```
{
  totals: { comments, messages, replied, unreplied, replyRate, flagged },
  byMethod: { template: 500, ai: 2500 },
  byIntent: { GREETING: 100, QUESTION: 800, OFFENSIVE: 5, ... },
  byLanguage: { en: 2000, ar: 1200 },
  byPlatform: { facebook: 2500, instagram: 700 },
  flags: { low_confidence: 45, offensive: 2, price_not_in_kb: 10 },
  responseTime: { avgSeconds: 2.3, p50: 1.5, p95: 5.2 }
}
```

### Monitoring Gaps — ALL RESOLVED

| Gap | Resolution |
|-----|------------|
| ~~No database query tracing~~ | Sentry auto-instruments postgres via `@sentry/node` v10+ (tracesSampleRate: 0.1) |
| ~~No Redis latency metrics~~ | Sentry auto-instruments ioredis + Redis PING latency in `/health` endpoint |
| ~~No external API latency tracking~~ | `tracedExternalCall()` in `utils/tracing.ts` — Sentry spans + prom-client histograms with p50/p95/p99 + success/error labels on all Facebook, Shopify, Salla, Translation calls |
| ~~No Prometheus /metrics endpoint~~ | `GET /health/metrics` via `prom-client` — default Node.js metrics (CPU, memory, event loop, GC) + pipeline counters + external API histograms + uptime |
| ~~No frontend RUM~~ | `@sentry/nextjs` with `tracesSampleRate: 0.1` in `sentry.client.config.ts` (LCP, FCP, CLS, route changes) |
| ~~No distributed tracing~~ | Both backend + AI worker use `@sentry/node` v10+ with tracing; trace headers auto-propagated on HTTP calls |

**Admin dashboard**: `/admin/observability` shows service status (DB/Redis/AI circuit latency), process metrics (RSS, heap, uptime), and external API latency table with p50/p95/p99.

## عربي

### ما هو مُراقَب حالياً

النظام يحتوي على 5 طبقات مراقبة:

**الطبقة 1: مقاييس خط الإنتاج (Redis)**
- 20 نتيجة × 4 خطوط إنتاج = 80 عداد
- نقطة وصول: `GET /health/pipeline-metrics`

**الطبقة 2: تتبع تكلفة AI (PostgreSQL)**
- كل استدعاء AI: النموذج، التوكنات، التكلفة بالدولار، مخزن مؤقت أم لا
- جدول: `ai_usage_log` (احتفاظ 180 يوم)

**الطبقة 3: تتبع الأخطاء (Sentry)**
- جميع أخطاء 5xx، الفشل غير المتزامن، فتح قاطع الدائرة
- وسوم: الخدمة، السياق، الإجراء

**الطبقة 4: السجلات المنظمة (Pino)**
- كل خطوة في خط الإنتاج مُوقتة
- حدث `reply_sent`: الطريقة، النية، الثقة، الأعلام، المدة

**الطبقة 5: فحوصات الصحة (HTTP)**
- `/health` → حالة كاملة (قاعدة بيانات، Stripe، دائرة AI)
- `/health/live` → فحص الحياة (Docker)
- `/health/ready` → فحص الجاهزية (اتصال قاعدة البيانات)

### نتائج خط الإنتاج (20 نتيجة)

| النتيجة | المعنى | الشدة |
|---------|--------|-------|
| `success` | الرد أُرسل بنجاح | طبيعي |
| `greeting_sent` | ترحيب أول محادثة | طبيعي |
| `page_not_found` | الصفحة غير موجودة | خطأ |
| `no_user` / `no_workspace` | صفحة بدون مستخدم/مساحة عمل | خطأ |
| `auto_reply_disabled` | الرد التلقائي مُعطّل | متوقع |
| `debounce_skipped` | رسالة أحدث قادمة | طبيعي |
| `handoff_active` | وكيل بشري نشط | متوقع |
| `rate_limited` | تجاوز حد المعدل | مراقبة |
| `lock_contention` | القفل محجوز من عامل آخر | مراقبة |
| `no_reply_generated` | فشل التوليد | تحذير |
| `send_failed` | فشل الإرسال | خطأ |
| `skipped_risky` | محتوى مسيء/سبام | طبيعي |
| `held_low_confidence` | محتجز للمراجعة | طبيعي |
| `error` | خطأ غير متوقع | خطأ |

### عتبات التنبيه المقترحة

| التنبيه | الشرط | الشدة |
|---------|-------|-------|
| **معدل أخطاء عالي** | `error` > 50 في 5 دقائق | حرج |
| **قاطع الدائرة مفتوح** | `circuit.ai_worker.opened` يزداد | عالي |
| **فشل إرسال مرتفع** | `send_failed` > 20 في 5 دقائق | عالي |
| **ارتفاع تكلفة AI** | التكلفة اليومية > 2× الأساس | متوسط |
| **لا رد مُولَّد** | `no_reply_generated` > 100 في ساعة | متوسط |
| **هجوم سبام** | `rate_limited` > 500 في 5 دقائق | متوسط |
| **تنافس على القفل** | `lock_contention` > 50 في 5 دقائق | متوسط |
| **تراكم ردود محتجزة** | `held_low_confidence` > 100/يوم | منخفض |

### فجوات المراقبة

### فجوات المراقبة — تم حل الجميع

| الفجوة | الحل |
|--------|------|
| ~~لا تتبع لاستعلامات قاعدة البيانات~~ | Sentry يتتبع استعلامات postgres تلقائياً عبر `@sentry/node` v10+ |
| ~~لا مقاييس Redis~~ | Sentry يتتبع ioredis تلقائياً + زمن PING في `/health` |
| ~~لا تتبع APIs خارجية~~ | `tracedExternalCall()` في `utils/tracing.ts` — Sentry spans + prom-client histograms مع p50/p95/p99 + تصنيف نجاح/خطأ على جميع استدعاءات Facebook وShopify وSalla وTranslation |
| ~~لا نقطة Prometheus~~ | `GET /health/metrics` عبر `prom-client` — مقاييس Node.js الافتراضية + عدادات خط الإنتاج + histograms APIs الخارجية + وقت التشغيل |
| ~~لا تتبع تجربة المستخدم (RUM)~~ | `@sentry/nextjs` مع `tracesSampleRate: 0.1` (LCP، FCP، CLS، تنقل الصفحات) |
| ~~لا تتبع موزع~~ | كلتا الخدمتين تستخدمان `@sentry/node` v10+ مع تتبع؛ رؤوس التتبع تُنشر تلقائياً |

**لوحة الإدارة**: `/admin/observability` تعرض حالة الخدمات (زمن استجابة DB/Redis/AI circuit)، مقاييس العملية (الذاكرة، heap، وقت التشغيل)، وجدول زمن استجابة APIs الخارجية مع p50/p95/p99.

---

# Launch Defaults (Single Source of Truth)
# القيم الافتراضية عند الإطلاق

These are the **actual production defaults** from the codebase (`workspaceSettings.ts`, `rate-limiter.ts`, `config.ts`, `shared/index.ts`).

هذه هي **القيم الافتراضية الفعلية في الإنتاج** من الكود المصدري.

| Parameter | Default | Source |
|-----------|---------|--------|
| **AI Model** | `gpt-4.1-mini` | `packages/shared` `DEFAULT_AI_MODEL` |
| **Prompt Version** | `v26` | `packages/shared` `PROMPT_VERSION` |
| **Temperature** | `0.3` | `ai-worker/config.ts` |
| **Max Output Tokens** | `300` | `ai-worker/config.ts` |
| **Comments Auto-Reply** | `true` | `workspaceSettings.ts` |
| **Messages Auto-Reply** | `true` | `workspaceSettings.ts` |
| **Comment Reply Mode** | `public` | `workspaceSettings.ts` |
| **Business Hours Only** | `false` (always active) | `workspaceSettings.ts` |
| **Business Hours** | `09:00–18:00` | `workspaceSettings.ts` |
| **Timezone** | `Asia/Damascus` | `workspaceSettings.ts` |
| **AI Enabled** | `true` | `workspaceSettings.ts` |
| **Reply Delay** | `0` seconds (instant) | `workspaceSettings.ts` |
| **Reply Style** | `professional` | `workspaceSettings.ts` |
| **Hold Low Confidence** | `false` | `workspaceSettings.ts` |
| **Auto Detect Language** | `true` | `workspaceSettings.ts` |
| **Default Reply Language** | `ar` | `workspaceSettings.ts` |
| **Rate Limit (Comments)** | `5/min` per sender per page | `rate-limiter.ts` |
| **Rate Limit (Messages)** | `10/min` per sender per page | `rate-limiter.ts` |
| **Comment Flag Threshold** | `> 50 words` → `comment_too_long` flag | `ai-worker/openai.ts` |
| **Comment Hard Truncate** | `> 280 chars` → truncate at sentence (public mode only) | `commentProcessor.ts` |
| **Cache TTL** | `30 days` | `ai.ts` |
| **Reply Lock TTL** | `60 seconds` | `replyLock.ts` |
| **Handoff Pause** | `15 minutes` | `workspaceSettings.ts` |
| **Circuit Breaker** | `5 failures → 30s open` | env vars |
| **Worker Concurrency** | `5 jobs` | `replyWorker.ts` |
| **KB Max** | `16,000 chars` | prompt builder |
| **Product Catalog** | `15 products, ~800 chars` | `ecommerce.ts` |
| **Product Sync** | every `6 hours` via `setInterval` | `index.ts` |

---

# 14. RBAC & Workspace System
# نظام الأدوار ومساحات العمل

## English

### Multi-Tenant Workspace Architecture

Jawab24 supports **multi-tenant workspaces** with role-based access control (RBAC). Each workspace is an isolated unit containing pages, rules, templates, stores, and team members.

```
┌─────────────────────────────────────────────────────────────────┐
│                    WORKSPACE ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  WORKSPACE (isolated tenant)                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ owner_id, name, slug, logo_url, settings (JSONB)        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  WORKSPACE MEMBERS                                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ workspace_id, user_id, role, joined_at, invited_by      │   │
│  │                                                          │   │
│  │ Roles (3-level hierarchy):                               │   │
│  │  • owner  (level 3): Full control, billing, delete       │   │
│  │  • admin  (level 2): Manage pages, rules, templates,     │   │
│  │                       settings, team members              │   │
│  │  • member (level 1): Read-only dashboard, view messages  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  WORKSPACE INVITES                                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ email, token_hash, role, expires_at, status              │   │
│  │ Token: 48-hour expiry, shareable invite link             │   │
│  │ Status: pending → accepted | expired | revoked           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  SCOPED RESOURCES (all have workspace_id column):               │
│  • pages                    • rules                             │
│  • templates                • ecommerce_stores                  │
│  • logs                     • ai_usage_log                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Backend Route Guards

```
Protected routes use requireRole('admin') middleware:
  POST/PUT/DELETE on /pages, /rules, /templates, /settings → admin+
  GET on /pages, /rules, /templates, /messages → member+
  POST /workspace/invite, DELETE /workspace/members → admin+
  DELETE /workspace → owner only
```

### Frontend RBAC UX

- **Route guards**: Protected pages check user role before rendering
- **Read-only mode**: Members see the dashboard but interactive elements are disabled
- **Permission tooltips**: Disabled buttons show "You need admin access" on hover
- **403 toast**: Unauthorized API calls show a toast notification
- **Team management UI**: Admins can invite members, assign roles, revoke access
- **Workspace context**: Set via `X-Workspace-Id` header; auto-selected if user has only 1 workspace

### Database Tables (Migration 0034+)

| Table | Key Columns |
|-------|-------------|
| `workspaces` | id, owner_id, name, slug, logo_url, settings (JSONB) |
| `workspace_members` | workspace_id, user_id, role, joined_at, invited_by |
| `workspace_invites` | email, token_hash, role, expires_at, status, workspace_id |

## عربي

### بنية مساحات العمل متعددة المستأجرين

Jawab24 يدعم **مساحات عمل متعددة المستأجرين** مع التحكم بالوصول حسب الأدوار (RBAC). كل مساحة عمل وحدة معزولة تحتوي على الصفحات والقواعد والقوالب والمتاجر وأعضاء الفريق.

**الأدوار (3 مستويات):**
- **مالك** (المستوى 3): تحكم كامل، الفواتير، الحذف
- **مدير** (المستوى 2): إدارة الصفحات، القواعد، القوالب، الإعدادات، أعضاء الفريق
- **عضو** (المستوى 1): قراءة فقط، عرض لوحة التحكم والرسائل

**نظام الدعوات:**
- رابط دعوة قابل للمشاركة مع صلاحية 48 ساعة
- الحالات: معلقة → مقبولة | منتهية | ملغاة

**حماية الواجهة الأمامية:**
- الأعضاء يرون لوحة التحكم لكن العناصر التفاعلية معطلة
- تلميحات الصلاحيات: الأزرار المعطلة تظهر "تحتاج صلاحية مدير"
- إشعار 403 عند محاولة إجراء غير مصرح

---

# 15. Security: Token Encryption
# الأمان: تشفير التوكنات

## English

### Authentication Architecture

**Identity model:** phone number = identity. Facebook/Instagram/WhatsApp = channels connected after login.

**Login methods:**
- **Phone OTP (primary)** — E.164 phone → 6-digit SMS code via Vonage → JWT + 60-day refresh token
- **Facebook OAuth (secondary)** — remains available; users prompted to add phone after login

**OTP security:**
- Codes bcrypt-hashed before storage (10 rounds)
- Dummy bcrypt compare on missing record (timing attack prevention)
- Max 3 attempts per OTP, 1 OTP per phone per 60s
- 5-minute expiry, automatic cleanup

**Session security:**
- Access token: 15-minute JWT (HMAC-SHA256, RFC 7519 — exp in seconds)
- Refresh token: 60-day opaque token, DB-stored, rotated on every use
- Cookies: HttpOnly + Secure + SameSite:strict
- Feature flag: `PHONE_AUTH_ENABLED` — phone routes hidden until enabled
- **Team phone invites**: Workspace members can be invited via phone number (same OTP flow)

---

### Page Token Encryption at Rest

Facebook page access tokens are now **encrypted at rest** using AES-256-GCM encryption.

```
┌─────────────────────────────────────────────────────────────┐
│                 TOKEN ENCRYPTION FLOW                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Facebook OAuth returns access_token                          │
│         │                                                     │
│         ▼                                                     │
│  ┌───────────────────────────────────────┐                    │
│  │  maybeEncryptPageToken(token)          │                    │
│  │  • If FACEBOOK_TOKEN_ENCRYPTION_KEY    │                    │
│  │    is configured → AES-256-GCM encrypt │                    │
│  │  • Store: "enc:iv:ciphertext:tag"     │                    │
│  │  • If no key → store plaintext         │                    │
│  └───────────────┬───────────────────────┘                    │
│                   │                                            │
│                   ▼                                            │
│  Stored in pages.access_token column                          │
│                                                               │
│  ─────────── ON READ ───────────                              │
│                                                               │
│  ┌───────────────────────────────────────┐                    │
│  │  maybeDecryptPageToken(stored)         │                    │
│  │  • If starts with "enc:" → decrypt    │                    │
│  │  • Otherwise → return as-is (legacy)  │                    │
│  │  • Transparent to all consumers       │                    │
│  └───────────────────────────────────────┘                    │
│                                                               │
│  E-commerce store tokens also encrypted:                      │
│  • Shopify: access_token + IV columns                         │
│  • Salla: access_token + refresh_token + IV columns           │
│                                                               │
│  Migration script: migrate-encrypt-page-tokens.ts             │
│  (one-time migration for existing plaintext tokens)           │
└─────────────────────────────────────────────────────────────┘
```

## عربي

### تشفير توكنات الصفحات في حالة السكون

توكنات الوصول لصفحات فيسبوك الآن **مشفرة في حالة السكون** باستخدام تشفير AES-256-GCM.

- **عند الحفظ**: إذا كان مفتاح التشفير مُعداً → تشفير AES-256-GCM، التخزين بصيغة `enc:iv:ciphertext:tag`
- **عند القراءة**: إذا كان يبدأ بـ `enc:` → فك التشفير، وإلا → إرجاع كنص عادي (للتوافق مع القديم)
- **شفاف تماماً** لجميع المستهلكين
- توكنات المتاجر الإلكترونية (Shopify/Salla) مشفرة أيضاً مع أعمدة IV
- سكريبت ترحيل لمرة واحدة للتوكنات الحالية: `migrate-encrypt-page-tokens.ts`

---

# 16. Content & SEO
# المحتوى وتحسين محركات البحث

## English

### Blog System

A full bilingual blog system was added for SEO and content marketing:

- **Data**: TSX data files at `frontend/src/data/blog-posts.ts`
- **Pages**: `frontend/src/pages/blog/index.tsx` (listing) + `frontend/src/pages/blog/[slug].tsx` (SSG per post)
- **Rendering**: Markdown with `remark-gfm` for tables, bilingual (EN + AR)
- **Articles**: 6+ bilingual articles targeting keywords like "auto reply Facebook", "Salla chatbot", "Shopify auto reply Arabic"

### Comparison Pages

Dynamic competitor comparison pages for SEO:

- **Route**: `frontend/src/pages/compare/[slug].tsx`
- **Competitors**: Tidio, Botpress (expandable via data file)
- **Content**: Feature comparison tables, FAQ sections, advantages — all translated EN + AR
- **Translations**: `compare` namespace in i18n files

### Admin Observability Dashboard

Internal dashboard for monitoring system health and AI costs:

- **Route**: `/admin/observability` (protected, admin+ access)
- **Metrics displayed**:
  - AI cost breakdown (by model, by day, cache hit rate)
  - Reply pipeline stats (reply rate, response times, flagged count)
  - Breakdowns by method, intent, platform
- **Data source**: Existing backend analytics endpoints

### SEO Infrastructure

| Feature | Status |
|---------|--------|
| Dynamic hreflang (page-aware) | Done |
| Dynamic `<html lang>` per locale | Done |
| Translated meta descriptions | Done |
| Structured data (JSON-LD) with 17 features | Done |
| Sitemap + robots.txt | Done |
| Canonical URLs | Done |
| "What is Jawab24" page (AI-discoverable) | Done |
| Blog system (6+ articles) | Done |
| Comparison pages (vs competitors) | Done |
| 39 E2E SEO regression tests | Done |
| Google Search Console verification | Done |
| Backlink campaign | Pending |

## عربي

### نظام المدونة

نظام مدونة ثنائي اللغة كامل لتحسين محركات البحث والتسويق بالمحتوى:
- ملفات بيانات TSX + صفحات SSG ثابتة
- 6+ مقالات ثنائية اللغة تستهدف كلمات بحث مثل "رد تلقائي فيسبوك"، "شات بوت سلة"

### صفحات المقارنة

صفحات مقارنة ديناميكية مع المنافسين:
- المسار: `/compare/[slug]`
- المنافسون: Tidio، Botpress (قابل للتوسيع)
- المحتوى: جداول مقارنة الميزات، أسئلة شائعة، مزايا — الكل مترجم

### لوحة المراقبة الإدارية

لوحة تحكم داخلية لمراقبة صحة النظام وتكاليف الذكاء الاصطناعي:
- المسار: `/admin/observability` (محمي، مدير+ فقط)
- تفصيل تكلفة AI حسب النموذج واليوم ومعدل إصابة الكاش
- إحصائيات خط الإنتاج: معدل الرد، أوقات الاستجابة، العدد المُعلَّم

### بنية SEO التحتية

- hreflang ديناميكي حسب الصفحة
- وصف ميتا مترجم + بيانات منظمة (JSON-LD) بـ 17 ميزة
- خريطة موقع + robots.txt + عناوين URL أساسية
- 39 اختبار E2E لضمان جودة SEO
- صفحة "ما هو Jawab24" محسّنة لاكتشاف الذكاء الاصطناعي

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
║  5a. Tier-2 fallback (circuit open) → Claude Haiku              ║
║  5b. Tier-3 fallback (Claude also fails) → keyword classifier   ║
║                                                                  ║
║  CONCURRENCY: Redis distributed lock (SET NX EX 60)              ║
║  DM key: reply_lock:{pageId}:{senderId}                          ║
║  Comment key: reply_lock:comment:{pageId}:{commentId}            ║
║  Release: Lua CAS script in finally block                        ║
║                                                                  ║
║  SAFETY CHAIN:                                                   ║
║  Input sanitization → AI generation → 6 post-checks →           ║
║  Offensive filter → Price hallucination (2-tier) →               ║
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
║  • Rate: 5/min comments, 10/min messages per sender              ║
║  • Token budget: 24,000 input tokens                             ║
║  • Cache: 30-day TTL, version-scoped                             ║
║                                                                  ║
║  PORTS: Frontend=3001 | Backend=3000 | AI Worker=3002            ║
║  MODEL: gpt-4.1-mini | PROMPT: v26 | TEMP: 0.3                  ║
║                                                                  ║
║  RBAC ROLES: owner (full) | admin (manage) | member (read-only) ║
║  ENCRYPTION: Page tokens AES-256-GCM at rest                     ║
║  MIGRATIONS: 50 SQL files                                        ║
╚══════════════════════════════════════════════════════════════════╝
```
