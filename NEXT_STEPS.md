# ✅ نظام الدفع جاهز! الخطوات التالية

## 🎉 ما تم إنجازه

تم إضافة نظام دفع كامل مع Stripe:
- ✅ Backend API جاهز (Checkout, Webhooks, Subscriptions)
- ✅ Frontend Pages جاهزة (Checkout, Success, Cancel)
- ✅ Database Schema محدّث
- ✅ Translations جاهزة (عربي + إنجليزي)
- ✅ Documentation شامل

---

## 🚀 الخطوات التالية (بالترتيب)

### 1. إنشاء حساب Stripe ⏱️ 10 دقائق

1. اذهب إلى https://stripe.com
2. اضغط "Sign up"
3. املأ المعلومات:
   - Business type: Individual (Enskild Näringsverksamhet)
   - Country: Sweden
   - Business details: Jawab24

4. اربط حساب **Revolut Business**:
   - Business settings > Bank accounts
   - Add bank account
   - استخدم IBAN من Revolut

---

### 2. الحصول على API Keys ⏱️ 2 دقيقة

من Stripe Dashboard:
1. اذهب: Developers > API Keys
2. انسخ:
   - **Publishable key** (يبدأ بـ `pk_test_`)
   - **Secret key** (يبدأ بـ `sk_test_`)

---

### 3. إضافة Keys للـ Environment Variables ⏱️ 5 دقائق

#### Backend (`env/backend.env`):
```bash
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxx  # سنحصل عليه لاحقاً
FRONTEND_URL=http://localhost:3001
```

#### Frontend (أنشئ `.env.local`):
```bash
NEXT_PUBLIC_API_URL=http://localhost:3000/api
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxx
```

---

### 4. إنشاء المنتجات في Stripe ⏱️ 10 دقائق

1. اذهب: Products > Create product

**منتج 1: Basic**
- Name: Jawab24 - Basic
- Price: $5 USD / month (recurring)
- انسخ Price ID: `price_xxxxxx`

**منتج 2: Pro**
- Name: Jawab24 - Pro  
- Price: $49 USD / month (recurring)
- انسخ Price ID: `price_yyyyyy`

**منتج 3: Enterprise**
- Name: Jawab24 - Enterprise
- Price: $199 USD / month (recurring)
- انسخ Price ID: `price_zzzzzz`

---

### 5. تحديث قاعدة البيانات ⏱️ 3 دقائق

```bash
# شغل migration
cd backend
npm run db:migrate

# أو شغل SQL مباشرة:
psql jawab24 -c "
UPDATE plans SET stripe_price_id = 'price_xxxxxx' WHERE slug = 'basic';
UPDATE plans SET stripe_price_id = 'price_yyyyyy' WHERE slug = 'pro';
UPDATE plans SET stripe_price_id = 'price_zzzzzz' WHERE slug = 'enterprise';
"
```

---

### 6. تشغيل المشروع محلياً ⏱️ 2 دقيقة

```bash
# Terminal 1: Backend
cd backend
npm run dev

# Terminal 2: Frontend  
cd frontend
npm run dev
```

---

### 7. الاختبار ⏱️ 5 دقائق

1. افتح http://localhost:3001/pricing
2. اضغط "Get Started" على أي خطة
3. استخدم بطاقة تجريبية:
   ```
   Card: 4242 4242 4242 4242
   Date: أي تاريخ مستقبلي
   CVC: 123
   ZIP: 12345
   ```
4. أكمل الدفع
5. يجب أن يرجعك لصفحة النجاح ✅

---

### 8. إعداد Webhook ⏱️ 5 دقائق

#### للاختبار المحلي:

```bash
# ثبت Stripe CLI
brew install stripe/stripe-cli/stripe

# سجل دخول
stripe login

# وجه webhooks للـ local
stripe listen --forward-to localhost:3000/api/payment/webhook

# انسخ webhook signing secret وضعه في:
# STRIPE_WEBHOOK_SECRET=whsec_xxxxx
```

#### للـ Production:

1. Stripe Dashboard > Webhooks > Add endpoint
2. URL: `https://jawab24.com/api/payment/webhook`
3. Events to send:
   - checkout.session.completed
   - customer.subscription.updated
   - customer.subscription.deleted
   - invoice.payment_succeeded
   - invoice.payment_failed
4. انسخ Signing secret

---

## 🎯 قبل Go Live

- ⚠️ تفعيل **Live Mode** في Stripe
- ⚠️ استبدال Test Keys بـ Live Keys
- ⚠️ تحديث Webhook URL
- ⚠️ اختبار دفعة حقيقية واحدة

---

## 📚 مراجع مفيدة

- ✅ [STRIPE_SETUP.md](./STRIPE_SETUP.md) - دليل شامل
- ✅ [Stripe Docs](https://stripe.com/docs)
- ✅ [Stripe Dashboard](https://dashboard.stripe.com)

---

## 💬 هل تحتاج مساعدة؟

إذا واجهت أي مشكلة، تحقق من:
1. Backend logs
2. Stripe Dashboard > Logs
3. Browser Console

**🎊 بالتوفيق!**

