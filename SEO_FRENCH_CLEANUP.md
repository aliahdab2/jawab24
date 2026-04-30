# تنظيف محتوى WordPress الفرنسي القديم من فهرس Google

> الهدف: إزالة المقالات الفرنسية المتبقية من فهرس Google (Vikings، أقمار نبتون، إنفلونزا...) المرتبطة بالموقع القديم "Sujet24" قبل ما يصير الدومين Jawab24.

---

## 1) ما تم إنجازه على مستوى الكود

تم تعديل `nginx/nginx.conf` لإضافة قواعد تنظيف SEO ضمن الـ HTTPS server block (قبل قواعد `/api/`):

| القاعدة | المسار | النتيجة |
|---|---|---|
| 1 | `/YYYY/...` (أي مسار يبدأ بسنة 1900–2099) | **410 Gone** + صفحة HTML مع رابط للرئيسية |
| 2 | `/les-…`, `/la-…`, `/le-…`, `/des-…`, `/du-…`, `/un(e)-…`, `/qu-…`, `/comment-…`, `/pourquoi-…`, `/combien-…` | **410 Gone** |
| 3 | `/category/…`, `/tag/…`, `/author/…`, `/feed[/]`, `/comments-feed[/]` | **410 Gone** |
| 4 | `/wp-admin`, `/wp-includes`, `/wp-content`, `/wp-json` | **410 Gone** |
| 5 | `/wp-login.php`, `/xmlrpc.php`, `/wp-config.php` | **410 Gone** |
| 6 | `/les-lunes-de-neptune` (مع ولا بدون `/`) | **301** إلى `https://jawab24.com/` |

**ليش 410 وليس 404؟** Google يعامل الـ 410 (Gone) كإشارة دائمة بأن الصفحة محذوفة وما رح ترجع، فيشيلها من الفهرس أسرع بكتير من الـ 404. الـ 404 يبقى مفهرس لأشهر لأن Google بيفترض أنه قد يكون خطأ مؤقت.

تم التحقق من صحة syntax الـ nginx عبر crossplane parser وتم اختبار الـ regex patterns ضد جميع المسارات الشرعية (`/blog/*`, `/login`, `/leads`, `/landing`, `/en/*`, إلخ) للتأكد من عدم وجود تعارض.

---

## 2) خطوات النشر (Deployment)

### أ) نشر تغييرات nginx

```bash
# على السيرفر (أو محلياً قبل push)
docker compose exec nginx nginx -t          # تأكد من صحة الـ config
docker compose restart nginx                 # أو reload عبر:
docker compose exec nginx nginx -s reload    # reload بدون downtime
```

### ب) اختبار سريع بعد النشر

```bash
# يجب أن ترجع 410:
curl -I https://jawab24.com/2022/04/23/les-vikings-qui-etaient-ils-et-dou-venaient-ils/
curl -I https://jawab24.com/feed
curl -I https://jawab24.com/wp-login.php
curl -I https://jawab24.com/comment-creer-un-site

# يجب أن ترجع 301 → https://jawab24.com/:
curl -I https://jawab24.com/les-lunes-de-neptune

# يجب ألا تتأثر (200 أو الـ status الطبيعي):
curl -I https://jawab24.com/blog
curl -I https://jawab24.com/login
curl -I https://jawab24.com/landing
curl -I https://jawab24.com/leads
```

---

## 3) خطوات Google Search Console (يدوية)

هاي الخطوات لازم تعملها أنت لأنها تتطلب تسجيل دخول لحسابك.

### الخطوة 1 — طلب إزالة الروابط الفرنسية (الأسرع)

1. افتح [Google Search Console](https://search.google.com/search-console).
2. اختر property `jawab24.com` (أو `https://jawab24.com/`).
3. من القائمة اليسرى: **Indexing → Removals → New Request**.
4. اختر **Temporarily remove URL** ← **Remove this URL only** أو **Remove all URLs with this prefix** للـ patterns.
5. أدخل كل من الروابط/البادئات التالية واحدة بواحدة:

   ```
   https://jawab24.com/2022/
   https://jawab24.com/les-lunes-de-neptune/
   https://jawab24.com/les-lunes-de-neptune
   https://jawab24.com/2022/04/23/les-vikings-qui-etaient-ils-et-dou-venaient-ils/
   https://jawab24.com/2022/04/21/combien-damericains-meurent-de-la-grippe-chaque-annee/
   https://jawab24.com/category/
   https://jawab24.com/tag/
   https://jawab24.com/feed
   ```

   > **ملاحظة**: استخدم خيار "Remove all URLs with this prefix" مع `https://jawab24.com/2022/` و `https://jawab24.com/category/` و `https://jawab24.com/tag/` لتغطية كل المحتوى تحتها بطلب واحد.

6. هاد بيخفي الروابط من نتائج البحث خلال **24 ساعة** بشكل مؤقت (6 أشهر). لكن الـ 410 الذي ضفناه فوق يخلي الإزالة دائمة.

### الخطوة 2 — إعادة تقديم الـ Sitemap

1. من نفس القائمة: **Indexing → Sitemaps**.
2. إذا الـ sitemap موجود مسبقاً (`sitemap.xml`)، اضغط على الزر بجانبه لإعادة الـ submit.
3. إذا غير موجود، أدخل: `sitemap.xml` واضغط **Submit**.

هاد بيخلي Google يعيد crawl للموقع الجديد ويتأكد إنه ما في صفحات فرنسية مرتبطة فيه.

### الخطوة 3 — متابعة تقرير التغطية

1. **Indexing → Pages**.
2. ابحث عن قسم **"Why pages aren't indexed"** أو **"Not found (404)"** أو **"Excluded"**.
3. خلال 2-4 أسابيع، الروابط الفرنسية رح تنقل تدريجياً من "Indexed" إلى "Excluded → Page with redirect" أو "Removed (410)".

---

## 4) جدول زمني متوقع

| الزمن | الحالة المتوقعة |
|---|---|
| فوراً بعد النشر | nginx يرجع 410 لكل الروابط الفرنسية |
| خلال 24 ساعة | بعد طلبات GSC Removal، الروابط مخفية من نتائج البحث |
| 1-2 أسبوع | Googlebot أعاد crawl لمعظم الروابط ورأى الـ 410 |
| 4-8 أسابيع | إزالة كاملة من الفهرس |

---

## 5) إذا اكتشفت روابط فرنسية ما اتعالجت

إذا لقيت رابط فرنسي قديم لم يتم تغطيته بالـ patterns (مثلاً مقال بدون بادئة فرنسية واضحة):

1. أضف `location` صريح له في `nginx/nginx.conf`:
   ```nginx
   location = /slug-fransi-ghair-mughatta {
       return 410;
   }
   ```
2. أو وسّع الـ regex pattern رقم 2 ليشمل البادئة الجديدة.
3. أعد تشغيل nginx: `docker compose exec nginx nginx -s reload`.
4. قدّم طلب Removal جديد في GSC.

---

## 6) مرجع: قائمة الأنماط النهائية في nginx.conf

موقع التعديلات: `nginx/nginx.conf` بين الـ Security Headers (السطر ~126) و الـ `location = /api/auth/refresh` (السطر ~178).

تم اختبار الـ patterns ضد:
- ✅ كل المسارات الشرعية الحالية في `frontend/src/pages/`
- ✅ المسارات بعدة لغات (`/`, `/en/`)
- ✅ صفحات Blog (`/blog/auto-reply-facebook-setup-guide`)
- ✅ Compare pages (`/compare/manychat`, `/compare/tidio`)
- ✅ ملفات SEO (`/sitemap.xml`, `/robots.txt`, `/llms.txt`)

لا توجد false positives.
