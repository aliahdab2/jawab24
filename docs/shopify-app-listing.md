# Shopify App Store Listing — Reference Guide

> **Purpose**: Everything needed to submit Jawab24 to the Shopify App Store.
> Copy-paste ready content for Shopify Partners dashboard.
>
> **Billing model**: Shopify **App Pricing** (billed inside Shopify) per **D-054** —
> Shopify forbids off-platform billing for listed apps. Stripe never touches App Store
> installs. Implementation details: `docs/integrations/shopify.md` §Billing.

---

## 1. App Metadata

| Field | Value |
|-------|-------|
| **App Name** | Jawab24 |
| **Tagline** (max 70 chars) | AI auto-replies for Facebook & Instagram in Arabic and English |
| **Category (Primary)** | Customer support |
| **Category (Secondary)** | Marketing |
| **App URL** | `https://jawab24.com/shopify/auth` |
| **Callback URL** | `https://jawab24.com/shopify/auth/callback` |
| **Privacy Policy** | `https://jawab24.com/en/privacy` |
| **Terms of Service** | `https://jawab24.com/en/terms` |
| **Support URL / FAQ** | `https://jawab24.com/en/what-is-jawab24` |
| **Pricing** | Shopify App Pricing — plans configured in the Partner Dashboard (§12) |
| **App handle** | Assigned by Shopify when the listing is created → set `SHOPIFY_APP_HANDLE` in `env/backend.env` (frontend hides the "manage plan" deep link until it exists) |

> ⚠️ **Distribution is irreversible.** Before anything else, verify the prod app's
> distribution method is **unselected or "Shopify App Store"**. If "Custom
> distribution" was ever selected, a NEW app is required (env swap + store
> migration). This is founder day-0 check V1.

---

## 2. Key Benefits (4 bullets, max 80 chars each)

1. AI replies to comments and DMs on Facebook & Instagram, 24/7
2. Syncs your Shopify catalog for accurate product answers
3. Built for Arabic — understands 6 dialect families naturally
4. Templates + AI smart replies + away messages, 3-layer system

---

## 3. Detailed Description — English

### Copy (paste into Shopify Partners "Detailed description" field):

Jawab24 is an AI-powered auto-reply platform that connects to your Facebook Pages, Instagram business accounts, and Shopify store. It reads incoming comments and direct messages, and automatically replies to customers in their language — Arabic or English — 24 hours a day, 7 days a week.

**How the Shopify Integration Works**

Connect your Shopify store in 2 minutes. Jawab24 automatically syncs your product catalog — names, prices, variants, and stock status — every 6 hours. When a customer asks "How much is the blue shirt?" the AI looks up the exact price from your catalog and replies with accurate information. If a product isn't in your catalog, the AI says "let me check" instead of guessing — it never makes up a price.

Two-tier price hallucination detection verifies every number adjacent to currency symbols (SAR, $, etc.) against your actual catalog, and catches price-cue phrases like "starts at" followed by unverified numbers.

**Arabic-First, Bilingual by Design**

Built specifically for Arabic-speaking and bilingual businesses. The AI understands 6 Arabic dialect families: Gulf (Saudi, Emirati, Kuwaiti), Egyptian, Levantine (Syrian, Lebanese, Jordanian), Maghrebi (Moroccan, Tunisian, Algerian), Iraqi, and Modern Standard Arabic. It detects which dialect the customer uses and replies naturally in the same dialect. It also handles Franco-Arabic and mixed Arabic-English messages.

**3-Layer Reply System**

- **Layer 1 — Template Replies**: Create keyword-based reply rules. When a customer's message matches a keyword, the system sends your pre-written reply. Fast, predictable, and free of AI cost.
- **Layer 2 — Smart Replies (AI)**: If no template matches, the AI generates a custom reply based on your Business Info, product catalog, store policies, and conversation history.
- **Layer 3 — Away Messages**: Outside business hours, the system sends a friendly away message so customers know you're not ignoring them.

**Safety & Accuracy**

In internal testing across 125 real-world scenarios — including Arabic dialects, sarcasm detection, price questions, complaints, and edge cases — Jawab24 achieved 99.6% evaluation accuracy.

- Three-level confidence scoring (high, medium, low) — low-confidence replies are automatically held for human review
- Full conversation context — the AI reads previous messages and consolidates rapid-fire messages into a single reply
- Customer awareness — recognizes returning customers by name and adjusts responses accordingly

**Business Info**

Add your business info — return policy, shipping details, FAQs, product descriptions — and the AI uses this to generate accurate replies. The system finds the most relevant context for each question. Your Shopify product catalog is automatically included.

**Getting Started**

1. Install the app and pick a plan — billing is handled securely by Shopify
2. Sign up with your Facebook account
3. Connect your Facebook Pages and Instagram accounts
4. Add your business info
5. Turn on auto-reply — Jawab24 handles the rest

Free trial included. You won't be charged until the trial ends, and you can cancel anytime from your Shopify admin.

---

## 4. Detailed Description — Arabic

### Copy (paste into Shopify Partners Arabic localized listing):

جواب24 منصة رد تلقائي بالذكاء الاصطناعي تتصل بصفحات فيسبوك وحسابات إنستغرام التجارية ومتجرك على شوبيفاي. تقرأ التعليقات والرسائل المباشرة الواردة، وترد تلقائياً على العملاء بلغتهم — عربي أو إنجليزي — على مدار الساعة، 7 أيام في الأسبوع.

**كيف يعمل تكامل شوبيفاي**

اربط متجرك على شوبيفاي في دقيقتين. جواب24 يزامن تلقائياً كتالوج منتجاتك — الأسماء والأسعار والمتغيرات وحالة المخزون — كل 6 ساعات. عندما يسأل عميل "بكم القميص الأزرق؟" يبحث الذكاء الاصطناعي عن السعر الدقيق من كتالوجك ويرد بمعلومات دقيقة. إذا لم يكن المنتج في كتالوجك، يقول الذكاء الاصطناعي "دعني أتحقق" بدلاً من التخمين — لا يختلق سعراً أبداً.

كشف هلوسة الأسعار بطبقتين يتحقق من كل رقم مجاور لرموز العملات (ريال، $، إلخ) مقابل كتالوجك الفعلي، ويلتقط عبارات الأسعار مثل "يبدأ من" متبوعة بأرقام غير موثقة.

**عربي أولاً، ثنائي اللغة بالتصميم**

مصمم خصيصاً للأعمال الناطقة بالعربية وثنائية اللغة. الذكاء الاصطناعي يفهم 6 عائلات لهجات عربية: خليجية (سعودية، إماراتية، كويتية)، مصرية، شامية (سورية، لبنانية، أردنية)، مغاربية (مغربية، تونسية، جزائرية)، عراقية، والعربية الفصحى الحديثة. يكتشف اللهجة التي يستخدمها العميل ويرد بشكل طبيعي بنفس اللهجة. كما يتعامل مع الفرانكو عربي والرسائل المختلطة عربي-إنجليزي.

**نظام رد ثلاثي الطبقات**

- **الطبقة 1 — ردود القوالب**: أنشئ قواعد رد بكلمات مفتاحية. عندما تطابق رسالة العميل كلمة مفتاحية، يرسل النظام ردك المعد مسبقاً. سريع، متوقع، وبدون تكلفة ذكاء اصطناعي.
- **الطبقة 2 — الردود الذكية (AI)**: إذا لم يتطابق أي قالب، يولّد الذكاء الاصطناعي رداً مخصصاً بناءً على معلومات نشاطك التجاري وكتالوج المنتجات وسياسات المتجر وتاريخ المحادثة.
- **الطبقة 3 — رسائل الغياب**: خارج ساعات العمل، يرسل النظام رسالة غياب ودية ليعرف عملاؤك أنك لم تتجاهلهم.

**الأمان والدقة**

في الاختبارات الداخلية عبر 125 سيناريو واقعي — تشمل اللهجات العربية وكشف السخرية وأسئلة الأسعار والشكاوى والحالات الحدية — حقق جواب24 دقة تقييم 99.6%.

- تقييم ثقة ثلاثي المستويات (عالي، متوسط، منخفض) — الردود منخفضة الثقة تُحتجز تلقائياً للمراجعة البشرية
- سياق محادثة كامل — الذكاء الاصطناعي يقرأ الرسائل السابقة ويدمج الرسائل المتتالية في رد واحد
- وعي بالعميل — يتعرف على العملاء العائدين بالاسم ويعدّل ردوده وفقاً لذلك

**معلومات نشاطك التجاري**

أضف معلومات نشاطك التجاري — سياسة الإرجاع، تفاصيل الشحن، الأسئلة الشائعة، أوصاف المنتجات — ويستخدمها الذكاء الاصطناعي لتوليد ردود دقيقة. يعثر النظام على السياق الأكثر صلة بكل سؤال. كتالوج منتجات شوبيفاي يُضاف تلقائياً.

**ابدأ الآن**

1. ثبّت التطبيق واختر خطة — الفوترة تتم بأمان عبر شوبيفاي
2. سجّل بحساب فيسبوك
3. اربط صفحات فيسبوك وحسابات إنستغرام
4. أضف معلومات نشاطك التجاري
5. فعّل الرد التلقائي — جواب24 يتكفل بالباقي

تجربة مجانية مضمّنة. لن تُحاسَب حتى تنتهي فترة التجربة، ويمكنك الإلغاء في أي وقت من لوحة تحكم شوبيفاي.

---

## 5. Screenshot Plan

Capture 6 screenshots at **1600x900** (16:9 ratio), **English AND Arabic** versions for
the localized listing. Asset pipeline: `docs/store-listing/shopify/` (framed finals
rendered from `sources/` — same approach as the shipped Salla set,
`docs/store-listing/salla/`).

| # | Screen | URL / How to capture | Annotation overlay (EN / AR) |
|---|--------|---------------------|-------------------|
| 1 | Landing page hero | `jawab24.com/en/landing` — hero section with chat demo | "AI Auto-Reply in Action" / «الرد الذكي أثناء العمل» |
| 2 | Shopify onboarding wizard | `localhost:3001/en/shopify/onboarding` — step 2 (products synced) | "2-Minute Setup" / «إعداد في دقيقتين» |
| 3 | Dashboard overview | `localhost:3001/en/dashboard` — stats and activity | "Monitor Everything from One Dashboard" / «تابع كل شيء من لوحة واحدة» |
| 4 | Comments with AI reply | `localhost:3001/en/comments` — conversation with Smart Reply badge and product data | "Smart Replies with Real Product Prices" / «ردود ذكية بأسعار منتجاتك الحقيقية» |
| 5 | Integrations page | `localhost:3001/en/integrations` — connected Shopify store with sync status | "Shopify Connected & Synced" / «شوبيفاي متصل ومتزامن» |
| 6 | Rules / Business Info | `localhost:3001/en/rules` or Business Info editor — template rules with keywords | "Full Control Over Your Replies" / «تحكم كامل في ردودك» |

**How to capture (the Salla recipe, adapted):**
1. Start the dev stack: `/shopify-dev` (ngrok + backend + frontend) with the Shopify dev
   store connected and products synced — the gallery shots must show REAL app UI with
   real synced catalog data (never mock the UI in HTML)
2. Capture raw shots with Playwright Chromium at deviceScaleFactor 2, viewport 16:9
3. Drop raw captures into `docs/store-listing/shopify/sources/` and wire them into the
   `shot-*.html` frames (brand-teal canvas + caption, Cairo font for AR)
4. `cd docs/store-listing/shopify/sources && node render.js` → finals at exact
   1600×900, move up one level
5. Hard rules from the Salla shoot: never screenshot real customers (seed synthetic
   conversations, delete after); فصحى only in overlay copy; dialect only inside
   customer bubbles; «رد ذكي» labels come from the product UI

---

## 6. Demo Video Script (60-90 seconds)

**Format**: Screen recording with text overlays. No voiceover for v1.
**Resolution**: 1920x1080 (or 1600x900)
**Upload to**: YouTube (unlisted) or Vimeo

| Timestamp | Scene | What to show | Text overlay |
|-----------|-------|-------------|-------------|
| 0:00–0:05 | Title card | Jawab24 logo on brand gradient | "AI Auto-Reply for Your Shopify Store" |
| 0:05–0:10 | Problem statement | Quick montage: notification badges, unanswered messages | "Your customers are waiting..." |
| 0:10–0:25 | Connect Shopify | Integrations page → enter store domain → OAuth redirect → products syncing animation → "Connected!" | "Connect in 2 minutes" |
| 0:25–0:40 | Customer asks product question | Facebook comment: "How much is the leather bag?" → AI typing indicator → reply appears with correct price from catalog | "AI replies with real prices from your store" |
| 0:40–0:55 | Arabic dialect conversation | Instagram DM in Gulf Arabic → AI replies naturally in same dialect with product recommendation | "Understands Arabic dialects natively" |
| 0:55–1:05 | Dashboard overview | Quick pan of dashboard: stats cards, recent activity, confidence badges, reply type breakdown | "Monitor everything from one dashboard" |
| 1:05–1:15 | Closing card | Logo + CTA | "Start your free trial" + jawab24.com |

**Recording tools**: QuickTime (macOS) or OBS Studio
**Editing tools**: CapCut, iMovie, or DaVinci Resolve (free)
**Music**: Royalty-free background track (subtle, upbeat)

---

## 7. Asset Requirements

### App Icon
- **Required**: 1200x1200 PNG
- **No transparency**, no pre-rounded corners (Shopify rounds them)
- **Deliverable**: `docs/store-listing/shopify/icon-1200.png` — rendered from
  `frontend/public/brand/icon-vector.svg` on a solid background
  (`sources/icon.html` + `node render.js`)
- Note: `frontend/public/brand/app-icon.png` (1024×922, transparent) fails this spec —
  do not upload it

### Screenshots
- **Required**: 4–8 images
- **Size**: 1600x900 PNG (16:9 ratio)
- **No device frames** — Shopify adds their own
- EN + AR sets (localized listing)

### Video
- **Optional** but strongly recommended
- **Format**: YouTube or Vimeo URL
- **Length**: 30–120 seconds

---

## 8. OAuth Scopes

All 5 scopes are actively used in `backend/src/services/shopify.ts`
(configured in `backend/src/config/index.ts`):

| Scope | Why |
|-------|-----|
| `read_products` | Sync product catalog (names, prices, variants, images) for AI replies |
| `read_content` | Sync store policies (shipping/refund) into Business Info for accurate AI replies |
| `read_orders` | Look up order status when customers ask "where is my order?" |
| `read_fulfillments` | Provide shipping/tracking information in AI replies |
| `read_inventory` | Check stock availability for "is this in stock?" questions |

---

## 9. Protected Customer Data (Level 2) — REQUIRED before approval

`read_orders` / `read_fulfillments` expose customer fields (name, phone, address),
which Shopify gates behind **Protected Customer Data access**. Field-level access
(name, phone) is **Level 2** — it must be requested in the Partner Dashboard
(App → API access → Protected customer data access) and approved before the app
review can pass. **This is the longest-lead founder action — request it day 0.**

What to declare in the questionnaire (all answers derivable from shipped code):

| Question | Answer |
|----------|--------|
| Which fields | Customer **name**, **phone**, and **shipping city/province** (order-status replies read `shippingAddress { city province }` to say where a shipment is headed — `services/shopify.ts` `lookupOrder`/`getShipmentTracking`). No street address; customer email is not read from orders |
| Why | Merchants' customers ask "where is my order?" in DMs; the AI answers with the order's status and destination city. Order/fulfillment webhooks trigger customer SMS notifications (confirmed / shipped / delivered) |
| Storage | Access tokens encrypted at rest with AES-256-GCM (`ecommerceCrypto.ts`); order data is fetched on demand — persisted only as the notification log row (phone, name, order number, rendered message), plus a short-TTL Redis cache for the order-lookup identity challenge. Address fields are never persisted to the database |
| Retention / deletion | GDPR webhooks fully implemented: `customers/data_request`, `customers/redact`, `shop/redact` (see §10). `shop/redact` deletes store data and cancels the local billing mirror |

> **V5 caveat (verify in dogfood):** whether prod stores already redact phone/name
> from webhook payloads BEFORE PCD approval. If yes, order SMS notifications are
> silently broken for App Store installs until approval lands — making the day-0
> request more urgent, not less.

---

## 10. GDPR Webhook Endpoints

Already implemented in `backend/src/routes/shopify.ts` (HMAC-verified, timing-safe):

| Endpoint | Purpose |
|----------|---------|
| `POST /shopify/gdpr/customers/data_request` | Customer data request |
| `POST /shopify/gdpr/customers/redact` | Customer data deletion |
| `POST /shopify/gdpr/shop/redact` | Shop data deletion (on uninstall) — also cancels the local App Pricing billing mirror (D-054) |

> ⚠️ These three URLs are **not API-registrable** — the founder must TYPE them into
> the Partner Dashboard (App setup → Compliance webhooks):
> `https://jawab24.com/shopify/gdpr/customers/data_request`, `…/customers/redact`,
> `…/shop/redact`.

---

## 11. Embedded App Status

Jawab24 is **not embedded** in the Shopify admin — merchants use the standalone
dashboard at jawab24.com (App URL redirects into OAuth, then to the dashboard).
App Pricing does NOT require an embedded app (external redirect URLs are first-class).

Strategy per plan V2: submit as standalone with a written justification (below), and
open a Partner support ticket for an embedded-requirement exemption if review asks.
**Do not build an embedded shell speculatively** — let review force that fork.

Justification for the reviewer notes: Jawab24's primary surfaces are Facebook/
Instagram/WhatsApp inboxes and a mobile app (Android/iOS); the Shopify store is a
data source (catalog, orders) rather than the workspace. An embedded iframe would
duplicate a full existing product UI without adding merchant value.

---

## 12. Pricing — Shopify App Pricing (D-054)

Shopify owns billing for App Store installs. Plans are configured in the Partner
Dashboard (App → Pricing); the local subscription row is a verify-and-reconcile
mirror — see `docs/integrations/shopify.md` §Billing and DECISIONS.md D-054.

### Plans to create in the Partner Dashboard

**Plan handles MUST equal the local plan slugs verbatim** (`starter`, `business`,
`pro`) — `backend/src/config/shopifyBilling.ts` maps handle/name → slug and
**fails loud on anything unknown** (no activation + Sentry). Display names must
lowercase to the same slugs (keep them as below).

| Handle (= slug) | Display name | Price | Highlights (from `backend/src/config/plans.ts`) |
|---|---|---|---|
| `starter` | Starter | $15/month | 1 page, 1,500 AI replies/mo, Facebook + Instagram |
| `business` | Business | $39/month | 2 pages, 4,500 AI replies/mo, + WhatsApp + e-commerce |
| `pro` | Pro | $79/month | 5 pages, 10,000 AI replies/mo, priority support |
| `starter-test` *(private)* | Starter | $0/month | Private test plan for dev-store dogfood (§O) — never public. Its **display name must be a billable one** ("Starter"): activation resolves the AppSubscription NAME, so a plan named "Test $0" can never activate (fail-loud by design). The handle is free to differ — handles only arrive as untrusted triggers |

Also configure on **every** plan:
- **Redirection (return) URL**: `https://jawab24.com/shopify/billing/return`
  (query params are untrusted triggers only; the server verifies via Admin API)
- **Trial days**: see the open decision below — Shopify's trial clock is
  authoritative for Shopify installs (the local mirror copies it)

### Open owner decisions (blockers for creating the plans)

| Decision | Options | Recommendation |
|----------|---------|----------------|
| Trial length | Old listing copy said 7d; Stripe config gives Starter 14d (Business/Pro 0, D-118) | **14 days on all three Shopify plans** — marketplace norm; one number everywhere |
| Scale tiers (`scale-20k`/`scale-30k`) on Shopify? | Add as private plans / cap Shopify merchants at Pro | Cap at Pro for launch. If added later: add the slugs to `SHOPIFY_BILLABLE_PLAN_SLUGS` in `config/shopifyBilling.ts` FIRST, else activation fails loud by design |
| Free plan | None exists in config | Trial-only for launch (no free plan) |

### Listing-facing pricing copy

- Free trial on every plan (length per decision above)
- **Starter**: For small pages — 1 page, 1,500 AI replies/month
- **Business** (Most Popular): For growing businesses — 2 pages, 4,500 AI replies/month, WhatsApp included
- **Pro**: For high-volume businesses — 5 pages, 10,000 AI replies/month, priority support

Template replies (keyword-based) are always free on all plans.

### How billing behaves (for reviewer notes / support)

- Merchant picks a plan inside Shopify; charges appear on their Shopify invoice
- Plan changes and cancellation happen in the Shopify admin (the app deep-links to
  `admin.shopify.com/store/{store}/charges/{app_handle}/pricing_plans`)
- Shopify-billed merchants are hard-blocked from all Stripe surfaces server-side
  (400 `SHOPIFY_BILLED`); after uninstall the block lifts so a returning merchant
  can subscribe directly
- Uninstalling the app cancels the subscription (Shopify-side) and the local mirror

---

## 13. Technical Checklist (before submission)

Founder day-0 (ordered by lead time — items 1–3 gate everything downstream):
- [ ] **V1**: verify distribution method is unselected or "Shopify App Store" (2 min, irreversible if wrong)
- [ ] **PCD Level 2 request** submitted (§9 — longest lead)
- [ ] 3 GDPR webhook URLs typed into the Partner Dashboard (§10)
- [ ] App Pricing plans created: handles `starter`/`business`/`pro` + private $0 test plan (display name "Starter" — §12), return URL `https://jawab24.com/shopify/billing/return`, trial days per owner decision (§12)
- [ ] `SHOPIFY_APP_HANDLE` set in `env/backend.env` once the listing exists

Engineering / assets:
- [x] App icon regenerated at 1200x1200 (no alpha) — `docs/store-listing/shopify/icon-1200.png`
- [ ] 6 screenshots captured at 1600x900 (EN + AR) and framed via `docs/store-listing/shopify/sources/`
- [ ] Demo video recorded, edited, and uploaded to YouTube
- [ ] All production URLs verified:
  - [ ] `https://jawab24.com/en/privacy` — loads without auth
  - [ ] `https://jawab24.com/en/terms` — loads without auth
  - [ ] `https://jawab24.com/shopify/auth` — initiates OAuth
  - [ ] `https://jawab24.com/shopify/auth/callback` — handles callback
  - [ ] All 3 GDPR endpoints respond to POST requests
  - [ ] `https://jawab24.com/shopify/billing/return` — redirects into the app after plan selection
- [ ] Description finalized (EN + AR)
- [ ] Scope justifications documented (§8) + PCD questionnaire answered (§9)
- [ ] Dogfood gate green: `docs/testing/SHOPIFY_TEST_PLAN.md` §A–L + §O (billing)

---

## 14. Submission Steps

1. Go to **Shopify Partners** → Apps → Jawab24 → **App setup**
2. Verify App URL, callback URL, GDPR compliance webhooks, and PCD access are set
3. Go to **Distribution** → select **Shopify App Store** (⚠️ irreversible — verify V1 first)
4. Configure **Pricing** (App → Pricing): the three public plans + private $0 test plan per §12
5. Fill in **Listing information**:
   - App name, tagline (copy from Section 1)
   - Detailed description (copy from Section 3 for EN, Section 4 for AR)
   - Key benefits (copy from Section 2)
6. Upload **App icon** (1200x1200) and **Screenshots** (6 images, 1600x900, EN + AR)
7. Add **Video URL** (YouTube unlisted link)
8. Fill in **Support**:
   - Support email
   - FAQ URL: `https://jawab24.com/en/what-is-jawab24`
   - Privacy policy: `https://jawab24.com/en/privacy`
9. **Submit for review** — typically 5–10 business days

### Reviewer Testing Notes
Include in your submission:
- Reviewers need a **Facebook Page** to test the OAuth flow (a test page + credentials are provided in the reviewer kit)
- Demo mode is available: after OAuth, seeded data appears automatically
- The app is **not embedded** in Shopify Admin — merchants use the Jawab24 dashboard at jawab24.com (justification in §11)
- Billing can be tested end-to-end with the private $0 test plan (or free plan selection on a development store)
- All product data syncs automatically after connecting the store

---

## Source Files Reference

| What | File path |
|------|-----------|
| EN description source | `frontend/src/i18n/en/about.json` |
| AR description source | `frontend/src/i18n/ar/about.json` |
| EN landing copy | `frontend/src/i18n/en/landing.json` |
| AR landing copy | `frontend/src/i18n/ar/landing.json` |
| Brand assets directory | `frontend/public/brand/` |
| Icon SVG source | `frontend/public/brand/icon-vector.svg` |
| Listing asset pipeline | `docs/store-listing/shopify/` |
| Shopify integration docs | `docs/integrations/shopify.md` |
| Billing design ruling | `DECISIONS.md` D-054 |
| Billing vocabulary / plan mapping | `backend/src/config/shopifyBilling.ts` |
| Billing sync/reconcile service | `backend/src/services/shopifyBilling.ts` |
| Plan definitions (prices, limits) | `backend/src/config/plans.ts` |
| OAuth scopes config | `backend/src/config/index.ts` |
| GDPR endpoints | `backend/src/routes/shopify.ts` |
| Shopify service (scope usage) | `backend/src/services/shopify.ts` |
| Test plan (dogfood gate) | `docs/testing/SHOPIFY_TEST_PLAN.md` |
