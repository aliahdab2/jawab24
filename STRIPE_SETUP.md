# نظام الدفع - Stripe Integration

## ✅ تم التنفيذ

تم إضافة نظام الدفع الإلكتروني بالكامل مع Stripe. إليك ما تم إنجازه:

### Backend (Node.js/Fastify)

#### ملفات جديدة:
- ✅ `backend/src/types/payment.ts` - أنواع TypeScript للدفع
- ✅ `backend/src/services/stripe.ts` - خدمة Stripe API
- ✅ `backend/src/controllers/payment.ts` - معالج طلبات الدفع
- ✅ `backend/src/routes/payment.ts` - مسارات API

#### تحديثات:
- ✅ `backend/src/db/schema.ts` - إضافة حقول Stripe للجداول
- ✅ `backend/src/config/index.ts` - إضافة Stripe config
- ✅ `backend/src/index.ts` - تسجيل payment routes
- ✅ `backend/package.json` - إضافة stripe package

### Frontend (Next.js/React)

#### صفحات جديدة:
- ✅ `frontend/src/pages/checkout.tsx` - صفحة الدفع
- ✅ `frontend/src/pages/payment/success.tsx` - صفحة نجاح الدفع
- ✅ `frontend/src/pages/payment/cancel.tsx` - صفحة إلغاء الدفع

#### تحديثات:
- ✅ `frontend/src/i18n/en.json` - ترجمات انجليزية
- ✅ `frontend/src/i18n/ar.json` - ترجمات عربية
- ✅ `frontend/package.json` - إضافة @stripe/stripe-js

---

## 🔧 الإعداد المطلوب

### 1. إنشاء حساب Stripe

1. اذهب إلى [stripe.com](https://stripe.com)
2. سجل حساب جديد
3. أكمل معلومات شركتك (Enskild Näringsverksamhet)
4. اربط حساب Revolut Business أو البنك السويدي

### 2. الحصول على API Keys

من [Dashboard > Developers > API Keys](https://dashboard.stripe.com/apikeys):

```
Publishable key (starts with pk_): للاستخدام في Frontend
Secret key (starts with sk_):  للاستخدام في Backend
```

### 3. إضافة Environment Variables

#### Backend (`env/backend.env`):
```bash
# Stripe Payment
STRIPE_SECRET_KEY=sk_test_51xxxxx  # من Stripe Dashboard
STRIPE_PUBLISHABLE_KEY=pk_test_51xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx  # سنحصل عليه بعد setup webhook

# Frontend URL
FRONTEND_URL=http://localhost:3001  # أو https://jawab24.com
```

#### Frontend (`.env.local` في مجلد frontend):
```bash
NEXT_PUBLIC_API_URL=http://localhost:3000/api
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_51xxxxx
```

### 4. إنشاء Products & Prices في Stripe

يجب إنشاء المنتجات والأسعار في Stripe Dashboard:

1. اذهب إلى [Products](https://dashboard.stripe.com/products)
2. اضغط "Create product"
3. أنشئ 3 منتجات:

**Basic Plan**:
- Name: Jawab24 - Basic
- Description: Basic plan for small businesses
- Price: $5/month (recurring)
- نسخ Price ID: `price_xxxxx`

**Pro Plan**:
- Name: Jawab24 - Pro
- Description: Professional plan for growing businesses  
- Price: $49/month (recurring)
- نسخ Price ID: `price_yyyyy`

**Enterprise Plan**:
- Name: Jawab24 - Enterprise
- Description: Enterprise plan for large businesses
- Price: $199/month (recurring)
- نسخ Price ID: `price_zzzzz`

### 5. تحديث قاعدة البيانات

يجب إضافة `stripePriceId` لكل خطة في جدول `plans`:

```sql
-- افتح قاعدة البيانات وشغل:
UPDATE plans 
SET stripe_price_id = 'price_xxxxx' 
WHERE slug = 'basic';

UPDATE plans 
SET stripe_price_id = 'price_yyyyy' 
WHERE slug = 'pro';

UPDATE plans 
SET stripe_price_id = 'price_zzzzz' 
WHERE slug = 'enterprise';
```

أو أنشئ migration جديدة.

### 6. إعداد Webhook في Stripe

للاستماع لأحداث الدفع:

1. اذهب إلى [Webhooks](https://dashboard.stripe.com/webhooks)
2. اضغط "Add endpoint"
3. أدخل URL:
   ```
   https://jawab24.com/api/payment/webhook
   ```
4. اختر الأحداث:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. انسخ `Signing secret` وضعه في `STRIPE_WEBHOOK_SECRET`

---

## 📱 API Endpoints

### POST `/api/payment/create-checkout-session`
Creates a Stripe Checkout session

**Request:**
```json
{
  "planId": "uuid-of-plan",
  "successUrl": "https://jawab24.com/payment/success",
  "cancelUrl": "https://jawab24.com/payment/cancel"
}
```

**Response:**
```json
{
  "sessionId": "cs_test_xxxxx",
  "url": "https://checkout.stripe.com/pay/cs_test_xxxxx"
}
```

### GET `/api/payment/subscription-status`
Get current subscription status

**Response:**
```json
{
  "id": "sub-uuid",
  "status": "active",
  "planId": "plan-uuid",
  "planName": "Pro",
  "currentPeriodStart": "2025-01-01T00:00:00Z",
  "currentPeriodEnd": "2025-02-01T00:00:00Z",
  "cancelAtPeriodEnd": false,
  "trialEndsAt": "2025-01-08T00:00:00Z"
}
```

### POST `/api/payment/cancel-subscription`
Cancel subscription at period end

### POST `/api/payment/billing-portal`
Create Stripe billing portal session

**Response:**
```json
{
  "url": "https://billing.stripe.com/session/xxxxx"
}
```

### POST `/api/payment/webhook`
Stripe webhook endpoint (no auth, verified by signature)

---

## 🧪 الاختبار

### 1. Test Mode

استخدم Stripe Test Mode للاختبار:

**بطاقات اختبار:**
```
نجاح: 4242 4242 4242 4242
فشل: 4000 0000 0000 0002
3D Secure: 4000 0025 0000 3155

CVC: أي 3 أرقام
التاريخ: أي تاريخ مستقبلي
```

### 2. اختبار Webhooks محلياً

استخدم Stripe CLI:

```bash
# تثبيت Stripe CLI
brew install stripe/stripe-cli/stripe

# تسجيل الدخول
stripe login

# إعادة توجيه webhooks للـ local
stripe listen --forward-to localhost:3000/api/payment/webhook

# سيعطيك webhook signing secret
# ضعه في STRIPE_WEBHOOK_SECRET
```

### 3. اختبار كامل للـ Flow

1. ✅ سجل دخول للموقع
2. ✅ اذهب `/pricing`
3. ✅ اختر خطة واضغط "Get Started"
4. ✅ يجب أن ينقلك لـ `/checkout?planId=xxx`
5. ✅ اضغط "Continue to Payment"
6. ✅ يجب أن ينقلك لـ Stripe Checkout
7. ✅ أدخل بطاقة test
8. ✅ أكمل الدفع
9. ✅ يجب أن يرجعك لـ `/payment/success`
10. ✅ تحقق من Dashboard أن الاشتراك مفعّل

---

## 🎯 الخطوات التالية

### قبل Go Live:

1. ⚠️ تفعيل Stripe **Live Mode**
2. ⚠️ استبدال Test Keys بـ Live Keys
3. ⚠️ تحديث Webhook URL للـ production
4. ⚠️ اختبار دفعة حقيقية واحدة
5. ⚠️ إضافة الـ Terms of Service & Privacy Policy

### مميزات إضافية (اختيارية):

- ✅ إضافة PayPal كخيار ثاني
- ✅ كوبونات الخصم (Stripe Coupons)
- ✅ فواتير PDF
- ✅ استرداد الأموال (Refunds)
- ✅ تقارير مالية

---

## 🐛 Troubleshooting

### المشكلة: "Plan does not have a Stripe Price ID"
**الحل:** تأكد من إضافة `stripePriceId` للخطة في قاعدة البيانات.

### المشكلة: "Webhook verification failed"
**الحل:** تأكد من `STRIPE_WEBHOOK_SECRET` صحيح ومطابق لـ Stripe Dashboard.

### المشكلة: "Unauthorized" عند إنشاء checkout session
**الحل:** تأكد من تسجيل الدخول وأن التوكن صحيح.

### المشكلة: البطاقة مرفوضة
**الحل:** في Test Mode، استخدم بطاقات الاختبار المذكورة أعلاه.

---

## 📞 الدعم

إذا واجهت أي مشاكل:
1. تحقق من Stripe Dashboard > Logs
2. تحقق من Backend logs
3. تحقق من Browser Console

---

**🎉 تهانينا! نظام الدفع جاهز للاستخدام.**

