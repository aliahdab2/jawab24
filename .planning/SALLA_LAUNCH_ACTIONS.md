# Salla Launch — Ready-to-Use Actions

> Companion to `SALLA_LISTING_BRIEF.md`. Everything here is **drafted and ready to send/use** — it needs no further writing, just your action (send the email, paste the auto-responder, hand the kickoff to a designer). Created 2026-06-08.

---

## 1. Listing spec sheet — MOSTLY ANSWERED from Salla's docs (2026-06-08)

I searched Salla's docs before asking support. Most specs are public — and they **differ from the brief's assumptions** (the brief guessed Shopify-like values). Use these confirmed numbers; only 2 items genuinely need Salla support.

### ✅ Confirmed from Salla docs
| Listing field | Salla spec | Source |
|---|---|---|
| App name | AR + EN, **≤ 30 characters** | publishing standards |
| Short description | **≤ 200 characters** (AR + EN) | publishing standards |
| **App Gallery** (the "screenshots") | **3 images, 1366 × 768** | publishing standards |
| **Key Benefits** | **3 images, 1600 × 1600**, each with a title + description | publishing standards |
| Promotional video | **optional, YouTube link, ≤ 2 minutes** (NOT an uploaded file) | publishing standards |
| Privacy policy + FAQ | optional links | publishing standards |
| Publishing flow | 6 sections: Basic Info, App Configurations, App Features, Pricing, Contact, Service Trial | Create-app docs |

> ⚠️ **This corrects the brief.** The brief assumed 4–6 screenshots @1280×720, a 1920×1080 banner, and a 60–90s *uploaded* video (≤30 MB). Reality: **3 gallery images @1366×768 + 3 key-benefit images @1600×1600 + a ≤2-min YouTube video.** There is **no separate "banner"** in the documented fields — the gallery + key-benefit images are the visuals. The screenshot script (brief §4, 6 screens) and video script (brief §5, 60–90s) must be re-scoped to this format. See §3 below.

### ❓ Only these genuinely need Salla support — short email
Sources: [Publishing standards](https://salla.dev/blog/standards-salla-apps-publications/) · [Publish App docs](https://docs.salla.dev/422990m0) · [Create your first App](https://docs.salla.dev/421410m0). The icon px and the go-live mechanic aren't documented publicly.

**Arabic (send this):**
```
السلام عليكم،

نحن بصدد نشر تطبيق "Jawab24" على متجر تطبيقات سلة. راجعنا التوثيق وبقي لدينا سؤالان:

1. أيقونة التطبيق: ما الأبعاد بالبكسل والصيغة والحد الأقصى لحجم الملف؟ وهل تُطبّق سلة الزوايا الدائرية تلقائياً؟
2. التحكم في موعد النشر: هل يمكننا تقديم التطبيق للمراجعة والحصول على الموافقة مع إبقائه غير منشور، ثم نشره يدوياً في الوقت الذي نختاره؟ أم يُنشر تلقائياً فور الموافقة؟ وهل يمكن إيقاف نشره لاحقاً؟

شكراً لكم.
فريق Jawab24
```

**English (reference):**
```
Hello Salla Partners team,

We reviewed the docs; two questions remain before we publish "Jawab24":

1. App icon: exact pixel dimensions, format, and max file size? Does Salla auto-apply rounded corners?
2. Publish-timing control: can we submit for review and get approved while keeping the app unpublished, then publish manually when we choose — or is it published automatically on approval? Can we unpublish later?

Thank you.
The Jawab24 team
```

**Where to send:** Salla Partners portal support channel (`https://salla.partners`). The go-live answer (Q2) is the one that decides the "submit-and-hold" vs "submit-when-ready" path.

---

## 2. Support-email auto-responder (paste into your mail provider)

Set this on the Salla support inbox (the address you'll list on the Partners page — confirm it in `SALLA_LISTING_BRIEF.md` §7). Bilingual, sets a one-business-day expectation.

### Subject
```
وصلتنا رسالتك / We received your message — Jawab24
```

### Body
```
مرحباً،

شكراً لتواصلك مع فريق دعم Jawab24. وصلتنا رسالتك وسنرد عليك خلال يوم عمل واحد.

للأسئلة الشائعة وطريقة ربط متجرك في سلة، تجد المساعدة هنا: https://jawab24.com/help
لمزيد عن الخصوصية وحماية البيانات: https://jawab24.com/privacy

نقدّر صبرك،
فريق Jawab24

——

Hello,

Thank you for contacting Jawab24 support. We've received your message and will reply within one business day.

For common questions and how to connect your Salla store, see: https://jawab24.com/help
For privacy and data protection: https://jawab24.com/privacy

We appreciate your patience,
The Jawab24 team
```

> Adjust the help/privacy URLs if they differ. If `jawab24.com/help` doesn't exist yet, point both lines to `/privacy` + a contact line, or create a minimal help page before submission.

---

## 3. Designer kickoff (hand this to the designer)

Everything the designer needs. **These are Salla's real specs** (from the docs — see §1), which differ from the brief's older guesses. The brief's §4 shot-list and §5 video script are good *content*, but must be re-fit to the counts/sizes below.

### Deliverables (exact Salla format)
| Asset | Salla spec | Notes |
|---|---|---|
| App icon | high-res square PNG (deliver 1024×1024; **confirm exact px via §1 email**) | Reuse the existing Jawab24 brand mark (Play/App Store/Facebook). Readable when small. |
| **App Gallery — exactly 3 images, 1366 × 768** | the main "screenshots" | Pick the 3 strongest from brief §4 (suggest: #1 connected integration, #2 playground AI reply with real price, #3 comments auto-reply). All-Arabic UI (`/ar/...`). |
| **Key Benefits — exactly 3 images, 1600 × 1600** | square; each needs a **title + short description** | Three core value props, e.g. "يقرأ منتجاتك من سلة" / "يرد بالعربية بلهجة عميلك" / "يرد على فيسبوك وإنستغرام تلقائياً". Square composition, not landscape. |
| Promotional video | **optional, YouTube link, ≤ 2 minutes** | NOT an uploaded file — host on YouTube, paste the link. Re-cut the brief §5 script to ≤2 min. Arabic narration. |
| English-language set | only if Salla confirms 2 language versions are supported (§1) | Otherwise produce the Arabic set only; the listing copy carries the English. |

> **No separate banner/hero asset** is in Salla's documented fields — don't produce a 1920×1080 banner. The gallery + key-benefit images are the visuals.

### Brand
- Teal/green from `frontend/src/styles/globals.css` `brand-*` tokens; accent orange for highlights.
- Fonts: Outfit (EN headings) / Cairo or Tajawal (AR); DM Sans (EN body) / Cairo (AR body).

### Hard production rules (rejection-risk if ignored)
- **Synthetic conversations only** — set up two test accounts; never screenshot a real customer's DM/comment (Meta ToS + PDPL exposure), even anonymized.
- Real Salla product titles/prices are fine — use the Phase 4.2 dev store (`salla.sa/dev-jkgsyu3w6pzzfrzw`). Note its storefront is in maintenance mode, so use **admin / product / playground** screens, not the live storefront.
- Hide merchant email + phone, and test-account real names, in every shot.
- If any asset shows the **Salla logo**, follow Salla's brand guidelines first (common rejection cause).
- Deliver each screenshot with **AR + EN alt text** (WCAG for the listing upload).

---

## 4. Listing copy — status

- ✅ **Short description / app description — FINAL and live** in the Salla app (1565152053) since 2026-06-08, AR + EN:
  - AR: مندوب مبيعات بالذكاء الاصطناعي يقرأ منتجات متجرك في سلة وأسعارها، فيجيب عملاءك على فيسبوك وإنستغرام طوال اليوم.
  - EN: An AI sales rep that reads your Salla products and prices and answers your customers on Facebook and Instagram, all day.
  - Honesty note: positions as a sales rep but claims only "answers" — it does NOT transact (the sale closes in the merchant's Salla store). No "رد آلي", no "يبيع نيابةً عنك".
- ⏳ Long description + feature bullets: draft in `SALLA_LISTING_BRIEF.md` §2, **awaiting marketing sign-off** — and need an **honesty pass** to soften transact-implying wording (`ليُتمّ عملية البيع`, `يبيع…`) to persuade/recommend/drive-to-purchase, matching the final short description.

One copy decision flagged for the team: the description hedges order-confirmation/shipped/delivered notifications as "قريباً". Phase 4.2 validated that wiring (merged #267/#268). If the in-product enable path is merchant-ready, promote those from "قريباً" to a shipped feature; keep abandoned-cart as "قريباً". Confirm feature-enabled state before changing.

---

## Launch strategy: submit early, hold the go-live (decided 2026-06-08)

Do **not** wait for WhatsApp. Get the app **reviewed + approved in parallel** with WhatsApp work, then control the public go-live:
- **If Salla supports approved-but-unpublished** (confirm via §1 Q7): submit as soon as assets are ready → get approved → **hold publishing** until you choose (e.g. alongside the WhatsApp v1.1 moment).
- **If Salla auto-publishes on approval** (§1 Q7 says yes): then "approve but don't launch" = **submit only when you're ready to be live**. The prep (assets, copy, support inbox) still happens now so submission is a same-day action whenever you decide.

WhatsApp is a fast-follow **v1.1** update (gated on Meta Embedded Signup, weeks out) — it slots into the same "قريباً → shipped" cadence the copy already uses. FB/IG is the launch wedge.

## Critical path recap
1. Send §1 to Salla support → get exact specs **+ the publish-control answer (Q7)**.
2. Get marketing sign-off on §1–2 copy (brief).
3. Hand §3 + the brief to the designer → produce assets (the long pole).
4. Set up support inbox + paste §2 auto-responder.
5. Submit on the Partners portal → 5–10 day review → **approved, hold go-live per Q7 answer**.
