# 🚀 كيف تبدأ - خطوة بخطوة

## ⏱️ **الوقت الإجمالي: 30-40 دقيقة**

---

## 📋 **الخطوة 1: إنشاء حساب Stripe** (10 دقائق)

### ما تحتاجه:
- ✅ حساب Swedbank (Business Account)
- ✅ معلومات شركتك (Enskild Näringsverksamhet)
- ✅ IBAN من Swedbank

### الخطوات:
1. افتح: https://stripe.com
2. اضغط **"Sign up"**
3. املأ المعلومات:
   ```
   - Business type: Individual
   - Country: Sweden
   - Business name: Jawab24
   - Email: بريدك الإلكتروني
   ```
4. اربط حساب Swedbank:
   - اذهب: **Settings > Bank accounts**
   - اضغ **"Add bank account"**
   - أدخل IBAN من Swedbank
   - **ملاحظة:** Stripe سيحول الأموال إلى SEK تلقائياً

---

## 🔑 **الخطوة 2: نسخ API Keys** (2 دقيقة)

1. من Stripe Dashboard، اذهب: **Developers > API Keys**
2. انسخ المفاتيح (في Test Mode):
   ```
   ✅ Publishable key: pk_test_xxxxxxxxxxxxx
   ✅ Secret key: sk_test_xxxxxxxxxxxxx
   ```
3. **احتفظ بهم** - سنستخدمهم في الخطوة التالية

---

## 🛠️ **الخطوة 3: إضافة Keys للمشروع** (5 دقائق)

### أ) Backend:

افتح الملف: `env/backend.env`

أضف هذه الأسطر:
```bash
# Stripe Payment Gateway
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxx  # ضع المفتاح من Stripe
STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxx  # ضع المفتاح من Stripe
STRIPE_WEBHOOK_SECRET=  # اتركه فارغاً الآن

# Frontend URL
FRONTEND_URL=http://localhost:3001
```

### ب) Frontend:

أنشئ ملف جديد: `frontend/.env.local`

أضف هذه الأسطر:
```bash
NEXT_PUBLIC_API_URL=http://localhost:3000/api
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxx  # ضع المفتاح من Stripe
```

---

## 💳 **الخطوة 4: إنشاء المنتجات في Stripe** (10 دقائق)

1. من Stripe Dashboard، اذهب: **Products**
2. اضغط **"+ Create product"**

### أنشئ 3 منتجات:

#### المنتج 1: Starter
```
Name: Jawab24 - Starter
Description: Auto-reply to 1 Facebook/Instagram page
Pricing: $5 USD
Billing period: Monthly
```
✅ بعد الإنشاء، انسخ **Price ID** (يبدأ بـ `price_`)

#### المنتج 2: Business
```
Name: Jawab24 - Business
Description: Auto-reply to 3 Facebook/Instagram pages
Pricing: $30 USD
Billing period: Monthly
```
✅ انسخ **Price ID**

#### المنتج 3: Pro
```
Name: Jawab24 - Pro
Description: Auto-reply to 10 Facebook/Instagram pages
Pricing: $70 USD
Billing period: Monthly
```
✅ انسخ **Price ID**

---

## 🗄️ **الخطوة 5: تحديث قاعدة البيانات** (3 دقائق)

### افتح Terminal وشغّل:

```bash
cd backend

# شغّل الـ migration لإضافة حقول Stripe
npm run db:migrate
# أو
psql -h localhost -p 5433 -U postgres -d autoreply -f drizzle/0004_add_stripe_fields.sql
```

### ثم حدّث الخطط بـ Price IDs من Stripe:

```sql
-- استبدل price_xxxxx بالـ Price IDs من Stripe
psql -h localhost -p 5433 -U postgres -d autoreply -c "
UPDATE plans SET stripe_price_id = 'price_xxxxx' WHERE slug = 'starter';
UPDATE plans SET stripe_price_id = 'price_yyyyy' WHERE slug = 'business';
UPDATE plans SET stripe_price_id = 'price_zzzzz' WHERE slug = 'pro';
"
```

---

## 🚀 **الخطوة 6: تشغيل المشروع** (2 دقيقة)

### Terminal 1 - Backend:
```bash
cd backend
npm run dev
```
✅ يجب أن يشتغل على: `http://localhost:3000`

### Terminal 2 - Frontend:
```bash
cd frontend
npm run dev
```
✅ يجب أن يشتغل على: `http://localhost:3001`

---

## 🧪 **الخطوة 7: الاختبار** (5 دقائق)

### جرّب النظام:

1. ✅ افتح: http://localhost:3001/pricing
2. ✅ اختر أي خطة واضغط **"Get Started"**
3. ✅ يجب أن ينقلك لصفحة Checkout
4. ✅ اضغط **"Continue to Payment"**
5. ✅ استخدم بطاقة اختبار Stripe:
   ```
   Card number: 4242 4242 4242 4242
   Expiry date: 12/34 (أي تاريخ مستقبلي)
   CVC: 123
   ZIP: 12345
   ```
6. ✅ أكمل الدفع
7. ✅ يجب أن تظهر صفحة **"Payment Successful!"**

---

## 🎯 **الخطوة 8 (اختيارية): إعداد Webhooks** (5 دقائق)

### للاختبار المحلي (Local Development):

```bash
# ثبّت Stripe CLI
brew install stripe/stripe-cli/stripe

# سجل دخول
stripe login

# وجّه webhooks لمشروعك المحلي
stripe listen --forward-to localhost:3000/api/payment/webhook
```

✅ انسخ **webhook signing secret** (يبدأ بـ `whsec_`)
✅ ضعه في `env/backend.env`:
```bash
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
```

✅ أعد تشغيل Backend

---

## ✅ **انتهيت! النظام جاهز**

الآن عندك:
- ✅ نظام دفع كامل
- ✅ 3 خطط جاهزة
- ✅ صفحات Checkout + Success + Cancel
- ✅ كل شيء متصل بـ Stripe

---

## 📞 **إذا واجهت مشكلة:**

### مشكلة 1: "Failed to load plan details"
**الحل:**
- تأكد من أن Backend شغال
- تأكد من أنك حدّثت `stripe_price_id` في قاعدة البيانات

### مشكلة 2: "STRIPE_SECRET_KEY is required"
**الحل:**
- تأكد من أنك أضفت المفاتيح في `env/backend.env`
- أعد تشغيل Backend

### مشكلة 3: "Cannot connect to database"
**الحل:**
- تأكد من أن PostgreSQL شغال
- تأكد من أن المعلومات في `env/backend.env` صحيحة

---

## 🎊 **مبروك!**

الآن لديك نظام دفع إلكتروني كامل. العملاء يستطيعون:
- ✅ اختيار خطة
- ✅ الدفع ببطاقة البنك
- ✅ الحصول على اشتراك تلقائي

---

## 📈 **الخطوات التالية (للنشر على Production):**

1. ⚠️ احصل على **Live API Keys** من Stripe
2. ⚠️ استبدل Test Keys بـ Live Keys
3. ⚠️ أنشئ Webhook في Stripe يوجّه لـ: `https://jawab24.com/api/payment/webhook`
4. ⚠️ جرّب دفعة حقيقية واحدة للتأكد

**🚀 بالتوفيق!**

