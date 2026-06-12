# Salla Launch — Ready-to-Use Actions

> Companion to `SALLA_LISTING_BRIEF.md`. Everything here is **drafted and ready to send/use** — it needs no further writing, just your action (send the email, paste the auto-responder, hand the kickoff to a designer). Created 2026-06-08.

---

## 1. Listing spec sheet — MOSTLY ANSWERED from Salla's docs (2026-06-08)

I searched Salla's docs before asking support. Most specs are public — and they **differ from the brief's assumptions** (the brief guessed Shopify-like values). Use these confirmed numbers; only 1 item genuinely needs Salla support (the icon question was answered by deeper doc research, 2026-06-12 — see below).

### ✅ Confirmed from Salla docs
| Listing field | Salla spec | Source |
|---|---|---|
| App name | AR + EN, **≤ 30 characters** | publishing standards |
| Short description | **≤ 200 characters** (AR + EN) | publishing standards |
| **App icon** | **upload at 512 × 512** (min 250 × 250, ratio 1:1), **PNG or JPEG, ≤ 1 MB**; symbol-only (no text), transparent **or** solid background, logo grid-aligned with empty space on all sides; Salla auto-scales down for placements | [Crafting the Perfect Salla App Icon](https://salla.dev/blog/crafting-the-perfect-salla-app-icon/) + Create-app docs ("Minimum width: 250 pixels, height: 250 pixels … ratio 1:1") |
| **App Gallery** (the "screenshots") | **3 images, 1366 × 768** | publishing standards |
| **Key Benefits** | **3 images, 1600 × 1600**, each with a title + description | publishing standards |
| Promotional video | **optional, YouTube link, ≤ 2 minutes** (NOT an uploaded file) | publishing standards |
| Privacy policy + FAQ | optional links | publishing standards |
| Publishing flow | 6 sections: Basic Info, App Configurations, App Features, Pricing, Contact, Service Trial | Create-app docs |

> ⚠️ Icon-spec trap: searching Arabic help.salla.sa for "أيقونة التطبيق" surfaces a **1024 × 1024 / auto-rounded-corners / 20% margin** spec — that is for **Salla App Maker** (merchants' own mobile apps on Google/Apple stores), NOT partner apps on the Salla App Store. Same for the help-center "سياسة نشر التطبيق" articles — all App Maker. Don't mix them up.

> ⚠️ **This corrects the brief.** The brief assumed 4–6 screenshots @1280×720, a 1920×1080 banner, and a 60–90s *uploaded* video (≤30 MB). Reality: **3 gallery images @1366×768 + 3 key-benefit images @1600×1600 + a ≤2-min YouTube video.** There is **no separate "banner"** in the documented fields — the gallery + key-benefit images are the visuals. The screenshot script (brief §4, 6 screens) and video script (brief §5, 60–90s) must be re-scoped to this format. See §3 below.

### ❓ Only this genuinely needs Salla support — short email
Sources checked exhaustively (2026-06-12): [Publishing standards](https://salla.dev/blog/standards-salla-apps-publications/) · [Publish App docs](https://docs.salla.dev/422990m0) · [Create your first App](https://docs.salla.dev/421410m0) + newer platform docs (439059m0, modified 2026-06-08) · [App Store FAQ](https://apps.salla.sa/en/faq) · [General policy](https://apps.salla.sa/en/general-policy) · [Partners apps policy](https://salla.partners/legal/apps-policy) · help.salla.sa · [Salla CLI](https://github.com/SallaApp/Salla-CLI). All publishing docs end at "submitted for publishing" — **the go-live mechanic (auto-publish on approval vs hold) is genuinely not documented publicly.** The icon question is answered (see table above) and was dropped from the email.

Related confirmed fact ([End Services of Salla Apps](https://salla.dev/blog/end-services-of-salla-apps-on-the-partners-portal/)): **taking a Live app off the store is NOT self-serve** — with active subscriptions it requires booking a meeting with the Salla team (or emailing support@salla.dev); only under-development (never-published) apps can be deleted directly. This raises the stakes on the publish-timing answer: once live, pulling back is a heavyweight process.

**Arabic (send this):**
```
السلام عليكم،

نحن بصدد نشر تطبيق "Jawab24" على متجر تطبيقات سلة. راجعنا التوثيق وبقي لدينا سؤال واحد:

التحكم في موعد النشر: هل يمكننا تقديم التطبيق للمراجعة والحصول على الموافقة مع إبقائه غير منشور، ثم نشره يدوياً في الوقت الذي نختاره؟ أم يُنشر تلقائياً فور الموافقة؟

شكراً لكم.
فريق Jawab24
```

**English (reference):**
```
Hello Salla Partners team,

We reviewed the docs; one question remains before we publish "Jawab24":

Publish-timing control: can we submit for review and get approved while keeping the app unpublished, then publish manually when we choose — or is it published automatically on approval?

Thank you.
The Jawab24 team
```

**Where to send:** Salla Partners portal support channel (`https://salla.partners`). The go-live answer decides the "submit-and-hold" vs "submit-when-ready" path. (The "can we unpublish later" sub-question was removed — answered by the End-Services article: yes, but only via a meeting with the Salla team once subscriptions exist.)

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
| App icon | **512 × 512 PNG or JPEG, ≤ 1 MB** (min 250×250, ratio 1:1 — confirmed from Salla docs, see §1) | Reuse the existing Jawab24 brand mark (Play/App Store/Facebook). Symbol only, no text; transparent or solid background; grid-aligned with breathing room on all sides. Readable when small. |
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

## Portal recon — live inspection of app 1565152053 (2026-06-12, Claude Chrome extension, read-only)

- **Publish flow**: one section, "Request to publish your App," with a single **"Start publishing your App"** button = the submit-for-review control (submitting agrees to the Apps T&C). No separate App Listing page or wizard reachable yet.
- **🚨 NEW BLOCKER — Partners ID verification**: clicking "Start publishing your App" opens an **"ID Verification Required"** modal before any listing form. You cannot reach the submission form until the Partners account identity is verified. Requirements ([internationals](https://salla.dev/blog/partners-account-verification-for-internationals/) / [locals](https://salla.dev/blog/salla-partners-account-verification-for-locals/)):
  - **Non-Saudi individual**: passport only — full name in English matching passport, passport number, issue/expiry dates, **bio-data page as PDF**. Certificates optional for Apps. Payout = **international bank account (outside KSA)** with bank name, holder name (matching passport, English), account number, currency, SWIFT, IBAN.
  - **Saudi individual**: National ID or passport (PDF) + **mandatory Saudi National Address** in Account Settings + **Freelancer Certificate** required for Apps products.
  - Path: Partners portal → dropdown by your name → Account Settings → Verify My Account.
- **App status field**: header shows only `Status: Development` (Type: Public). No draft/in-review/approved/published state machine exposed.
- **No go-live control**: no scheduling, hold, or publish toggle anywhere on the page. Only a "Preview At App Store" button. Observable flow is request → Salla review → (implied) publish.
- **Icon upload field**: accepts `.jpg, .png, .gif` (file-input `accept` attr); **no dimensions stated inline** — sizing guidance only via the "Learn more about App Icon" doc link (consistent with the 512×512 spec in §1).

## Launch strategy (decided 2026-06-08; REVISED 2026-06-12 after portal recon)

Do **not** wait for WhatsApp. But the portal shows **no approved-but-unpublished control**, so until Salla support says otherwise, **assume auto-publish on approval** and plan the **submit-when-ready** path:
- "Approve but don't launch" = **submit only when you're ready to be live**. All prep (ID verification, assets, copy, support inbox) happens now so submission is a same-day action whenever you decide.
- If the support answer reveals a hold mechanism inside the post-verification listing flow, revert to submit-early-hold.

WhatsApp is a fast-follow **v1.1** update (gated on Meta Embedded Signup, weeks out) — it slots into the same "قريباً → shipped" cadence the copy already uses. FB/IG is the launch wedge.

## Critical path recap
1. **Complete Partners ID verification** (gates the submission form; needs passport PDF + payout bank details — see portal recon above). Start now; verification review time unknown.
2. Send §1 to Salla support → the publish-control answer (decides submit-when-ready vs submit-early-hold).
3. Get marketing sign-off on §1–2 copy (brief).
4. Hand §3 + the brief to the designer → produce assets (the long pole).
5. Set up support inbox + paste §2 auto-responder.
6. Submit on the Partners portal → 5–10 day review → go-live per the strategy above.
