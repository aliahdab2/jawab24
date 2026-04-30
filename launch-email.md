# Jawab24 Launch Announcement — Waitlist Email

> Paste the Subject and Body below into the **Compose email** modal on
> `/admin/waitlist`. Use the **Audience** selector to choose who receives it:
> waitlist subscribers, registered users, or both (deduped). Globally
> unsubscribed addresses are excluded automatically. The existing
> `waitlistEmailTemplate` will auto-detect RTL from the Arabic content and
> render a teal Jawab24-branded HTML email with a per-recipient unsubscribe
> link appended automatically.

---

## Subject

```
جواب24 متاح الآن | Jawab24 is now live
```

---

## Body

```
مرحباً،

بعد انتظارك الطويل، يسعدنا إخبارك أن جواب24 أصبح متاحاً رسمياً اليوم.

المنصة جاهزة للعمل، ويمكنك الدخول والبدء بإدارة الردود التلقائية الذكية على تعليقات ورسائل صفحات فيسبوك الخاصة بك.

ما يميّز جواب24:
• ردود ذكية فورية على تعليقات ورسائل عملائك
• ردود مخصصة لكل منشور تُحوّل التفاعل إلى مبيعات
• دعم كامل للعربية والإنجليزية مع تحكّم في نبرة الرد
• إعداد سريع وإدارة مركزية لكل صفحاتك

ابدأ الآن من: https://jawab24.com

قريباً — تطبيقات الجوال
نضع اللمسات الأخيرة على تطبيقَي أندرويد و iOS، وسنُعلمك فور إطلاقهما على Google Play و App Store.

قريباً أيضاً — تكامل المتاجر الإلكترونية
نعمل على تكامل مباشر مع سلّة وشوبيفاي وزِد، ليقرأ جواب24 منتجاتك وطلباتك ويردّ على عملائك بمعلومات دقيقة وفورية.

شكراً لثقتك منذ اليوم الأول — نتطلع لرؤيتك داخل المنصة.

— فريق جواب24
jawab24.com

──────────────────────────────

Hi there,

After your patience, we're excited to share that Jawab24 is officially live today.

The platform is ready for you. Sign in and start managing AI-powered auto replies for your Facebook page comments and messages — crafted in your voice, in Arabic and English.

What Jawab24 brings you:
• Instant AI replies to customer comments and DMs
• Per-post reply triggers that turn engagement into sales
• Full Arabic and English support with tone control
• Fast setup and a single dashboard for all your pages

Get started now: https://jawab24.com

Coming soon — mobile apps
Our Android and iOS apps are in final release. We'll let you know the moment they're on Google Play and the App Store.

Coming soon — e-commerce integrations
Native integrations with Salla, Shopify, and Zid are on the way. Jawab24 will read your products and orders directly from your store and answer customers with accurate, real-time information.

Thank you for trusting us from day one — see you inside.

— The Jawab24 team
jawab24.com
```

---

## Pre-send checklist

- [ ] `RESEND_API_KEY` is set in production env (otherwise the send short-circuits with a warn log).
- [ ] `RESEND_FROM_EMAIL` points to a verified domain in Resend (usually `hello@jawab24.com` or similar).
- [ ] Do a test send first: leave **Audience = Waitlist**, clear all selections, paste your own email into **Extra recipients**, send to 1 address only, confirm the rendered HTML in your inbox.
- [ ] For the launch send, switch **Audience** to **Both** (waitlist + registered users) so existing customers also see the announcement. The backend dedupes overlap and excludes anyone in `email_unsubscribes`.
- [ ] After sending, verify the success/failure counts in the result banner and the audit row in `waitlist_email_sends`.

## Notes on rendering

- The template picks ONE direction per email. Because the Arabic block is first and Arabic characters are >30% of the body, the email will render `dir="rtl"`. The body `<td>` uses `dir="auto"`, so individual lines still read correctly, but the English block will be right-aligned. This is acceptable for bilingual MENA launches — if you'd prefer perfect alignment, send two separate emails (Arabic-only first, English-only second).
- URLs auto-link in Gmail, Outlook, Apple Mail, and all modern clients — no HTML anchors needed.
- The unsubscribe link is appended by the template, per recipient, with a signed token.
