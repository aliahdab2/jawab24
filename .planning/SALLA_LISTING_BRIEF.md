# Salla Partners — Jawab24 Listing Brief

> **Status:** Drafted 2026-05-07. Working doc — fill in `[TBD]` placeholders as
> answers arrive.
> **Owner:** Marketing / design (asset production), engineering (privacy
> policy + technical correctness review).
> **Goal:** Have every asset listed in Section 8 *production-ready* the day
> Salla Launch Validation (Phase 4.2) passes, so submission is just upload.
>
> **Stop point:** if more than half of the `[TBD]` placeholders are still
> open when design/marketing kicks off, this brief is too thin — pause and
> resolve them first. A brief with 12+ unanswered questions is a
> questionnaire, not a spec, and produces rework.
>
> **Related docs:**
> - [`SALLA_LAUNCH_VALIDATION.md`](./SALLA_LAUNCH_VALIDATION.md) — engineering's pre-submission validation track.
> - [`ECOMMERCE_LAUNCH_VALIDATION.md`](./ECOMMERCE_LAUNCH_VALIDATION.md) — shared template behind it.
> - Project memory file (Salla local-dev section) — credentials, dev-store domain, ngrok pattern. Designers benefit from the same workflow when capturing screenshots.

---

## 1. Audience + positioning

### Target merchant (Salla App Store browser)
- Saudi / Gulf / Egyptian / Levantine SME e-commerce store owner
- Already running a Salla store; gets DMs and comments on Facebook + Instagram
- Spends 1–4 hours/day manually answering "كم سعر؟", "هل متوفر؟", "أين شحنة طلبي؟"
- Limited team — no dedicated CX agent
- Reads Arabic first; product UI in Arabic is **table stakes**

### Value proposition (one-liner, Arabic-first)
**ذكاء اصطناعي عربي يرد على عملائك في فيسبوك وإنستغرام بأسعار ومنتجات متجرك في سلة — تلقائياً 24/7.**

(English fallback for international merchants: *Arabic-first AI replies on Facebook + Instagram using your live Salla catalog — 24/7.*)

### What sets Jawab24 apart from other Salla apps
1. **Arabic-first AI** — not English translated to Arabic. Trained on Gulf + Levantine + Egyptian dialects.
2. **Real catalog awareness** — answers reference actual product titles, prices, stock from Salla, not generic chatbot fluff.
3. **Facebook + Instagram, not just WhatsApp** — competitors (LetsBot, Javna) focus on WhatsApp; Jawab24 owns FB/IG DMs.
4. **3 reply modes** — public comment reply, private DM, or both. Merchant-configurable per page.
5. **Already shipped:** product sync, RAG-powered answers, hallucinated-price guard, multi-language detection.

---

## 2. Listing copy (Arabic — primary)

> **All copy below is draft. Run through marketing review before publishing.**

### App name (شاشة العرض)
**Jawab24 — جواب24**

### Short tagline (~50 chars Arabic)
**ردود ذكية على فيسبوك وإنستغرام بمنتجاتك من سلة**

### Long description (Arabic, ~300 words)

```
[TBD — marketing draft]

Suggested structure:
1. هل تقضي ساعات في الرد على رسائل عملائك؟ (hook)
2. Jawab24 يربط متجرك في سلة بصفحات فيسبوك وإنستغرام (what it does)
3. الذكاء الاصطناعي يفهم العربية ويرد بأسعار ومنتجات متجرك الفعلية (why it's different)
4. خواص: مزامنة تلقائية للمنتجات، رد على التعليقات والرسائل، رسائل التذكير بالعربة المتروكة، تتبع الطلبات
5. آمن وموثوق: لا يخزن بيانات عملائك، توكنات مشفرة، متوافق مع GDPR
6. CTA: ابدأ الآن مجاناً — لا تحتاج بطاقة ائتمان
```

### Long description (English fallback, ~250 words)

```
[TBD — marketing draft]

Same structure. Translate AFTER Arabic is finalized — the Arabic is canonical.
```

### Feature bullets (Arabic, 5–7 items, ≤8 words each)
- ✅ ردود فورية على رسائل وتعليقات فيسبوك وإنستغرام
- ✅ يقرأ منتجاتك وأسعارك من سلة مباشرة
- ✅ يرد بالعربية الفصحى أو اللهجة المحلية
- ✅ مزامنة تلقائية عند تحديث المنتجات
- ✅ رسائل العربة المتروكة وتأكيد الطلبات (قريباً — Phase 3)
- ✅ يدعم اللغتين العربية والإنجليزية
- ✅ مدعوم بفريق سعودي

### Categories / tags (Salla taxonomy)
- Primary category: **[TBD — confirm Salla's category list]** (likely "تطبيقات التسويق" / Marketing or "خدمة العملاء" / Customer Service)
- Tags: `chatbot`, `auto-reply`, `facebook`, `instagram`, `AI`, `arabic`, `customer-service`, `social-commerce`

---

## 3. Visual identity

### App icon — required for store listing
- **Spec:** 1024×1024 PNG, transparent or opaque background, no rounded corners (Salla applies them)
- **Source of truth:** existing Jawab24 brand mark — same one used for the app stores (Play / App Store) and Facebook listing
- **Delivery:** designer commits the file in a separate follow-up PR (`feat/salla-listing-assets`), not in this brief PR. Reviewers can preview by checking out that branch.
- **Designer notes:** the icon must be readable at 64×64 (Salla's listing tile size). Test by zooming out — if the wordmark becomes unreadable, use the symbol-only variant.

### Banner / hero image
- **Spec:** [TBD — confirm exact size from Salla Partners docs; Shopify is 1920×1080, Salla is likely similar]
- **Direction:** show the integration card moment — a Salla store icon connected to a Facebook page icon, with a phone mockup showing an Arabic AI reply. Avoid stock photos.
- **Localization:** Arabic primary; English version optional for international Salla merchants.

### Brand colors + fonts
- Brand teal/green: from `frontend/src/styles/globals.css` `brand-*` tokens
- Headings: **Outfit** (English) / **Cairo** or **Tajawal** (Arabic)
- Body: **DM Sans** (English) / Cairo (Arabic)
- Accent orange: surface highlights, "new" pills

---

## 4. Screenshot script (Arabic + English versions of each)

Screenshot count [TBD — verify Salla Partners spec sheet]. Draft list assumes 4–6:

| # | Screen | What it shows | Arabic copy overlay | Notes |
|---|---|---|---|---|
| 1 | `/integrations` connected state | Connected Salla store card with green "متصل" badge, page-link chips, product count | "اربط متجرك في سلة بصفحاتك في دقيقة" | Use a fake-but-realistic store domain like `mystore.salla.sa` |
| 2 | `/admin/playground` with Salla product context | Real Salla product question + AI reply quoting actual price | "الذكاء الاصطناعي يقرأ منتجاتك مباشرة" | Use a real catalog from a dev store; show price + currency |
| 3 | Comments page with auto-reply on a real FB post | Customer comment in Arabic + AI reply showing product detail | "يرد على تعليقات فيسبوك وإنستغرام تلقائياً" | Anonymize commenter name |
| 4 | Settings — knowledge base | KB editor showing Arabic store info | "يفهم سياساتك ويستخدمها في الردود" | |
| 5 | Settings — auto-reply mode toggle | The 3 reply modes (public, DM, both) | "اختر طريقة الرد المناسبة لك" | |
| 6 | Mobile view of comments on the iOS app | The Capacitor mobile app showing the same comment + reply | "تابع الردود من جوالك" | Optional — only if listing supports 6 |

**Production rules:**
- **Synthetic conversations only.** Never screenshot a real customer's Facebook DM or comment, even anonymized. Set up two test accounts and stage the conversation. Real-customer screen-grabs raise Meta ToS and Saudi PDPL exposure.
- Real Salla product titles/prices are fine — use a Salla dev store you control, or the partner-test store referenced in the project memory. Don't use a real merchant's live catalog without explicit written permission.
- Hide the merchant's email + phone in every screenshot. Hide test-account real names too.
- All UI elements must be in Arabic for the Arabic set (use `/ar/...` URLs); English for the English set (`/en/...`). Do NOT mix.
- 1280×720 minimum (Salla spec [TBD — verify in Salla Partners docs]).
- **Salla brand assets:** if any screenshot or asset includes the Salla logo or wordmark, review [Salla's brand guidelines](https://salla.partners/) first. Misuse of the platform logo is a common reason for app-marketplace rejection.
- **Accessibility:** screenshots delivered to design must come with descriptive alt text (Arabic + English) so the listing meets WCAG when uploaded to Salla Partners.

---

## 5. Demo video script (60–90s, Arabic-narrated)

Salla App Store listings benefit from a short demo video. Draft script:

### Scene-by-scene (Arabic narration)

| Scene | Duration | Visual | Voiceover (Arabic) |
|---|---|---|---|
| 1 | 0:00–0:08 | Stress montage — phone buzzing, merchant reading message after message | "كل يوم، نفس الأسئلة..." |
| 2 | 0:08–0:18 | **`/ar/integrations`** — click Connect Salla, OAuth screen, 3-step onboarding wizard | "اربط متجرك في سلة بـ Jawab24 في دقيقة." |
| 3 | 0:18–0:32 | DM thread between two **test accounts** (synthetic conversation, not a real customer) — Arabic question about a real product → AI reply with correct price + product link | "الذكاء الاصطناعي يقرأ متجرك ويرد بأسعار ومنتجات حقيقية." |
| 4 | 0:32–0:48 | Comments page showing AI reply on a Facebook post belonging to the test page, then a DM thread (both synthetic) | "يرد على التعليقات والرسائل في فيسبوك وإنستغرام، تلقائياً." |
| 5 | 0:48–0:60 | Knowledge base editor briefly + Settings → reply mode toggle, both at `/ar/...` paths | "تحكم كامل: متى يرد، وكيف يرد." |
| 6 | 0:60–0:72 | Mobile view on iPhone — same `/ar/...` flow on the road | "تابع كل شيء من جوالك." |
| 7 | 0:72–0:85 | Hero screen + URL `jawab24.com` + "ابدأ مجاناً" CTA | "Jawab24 — جوابك الذكي على فيسبوك وإنستغرام، من متجرك في سلة." |

**Critical:** every screen capture in the Arabic-narrated video must show the `/ar/...` URL with Arabic UI. Mixing Arabic narration with English UI is a credibility-killer.

### Production notes
- Voiceover in **Modern Standard Arabic with a neutral Saudi accent** (avoid heavy Egyptian/Levantine for broadest reach across Salla's MENA base)
- Captions in Arabic + English (so an international Salla merchant can follow without sound)
- Background music: subtle, MENA-friendly (avoid Western pop/EDM)
- Branding: end card with Jawab24 logo, `jawab24.com`, and "ابدأ مجاناً — Try free"
- File format: MP4, H.264, 1920×1080, ≤30 MB if Salla has a size cap

---

## 6. Privacy policy — gap analysis (2026-05-07)

**Current state:** [`frontend/src/pages/privacy.tsx`](../frontend/src/pages/privacy.tsx) exists but the copy is generic — driven by `t('introText')`, `t('collectText')` etc. translation keys with no Salla-specific or processor-specific content. Verified by grep: no mentions of Salla, AES, encryption, OpenAI, Sentry, Resend, or PDPL.

This means the privacy policy must be **updated**, not just verified, before submission. Treat each item below as required content the policy must explicitly include:

- [ ] **Salla data scope** — name Salla as a data source: products, store info, customer details that arrive via cart/order webhooks
- [ ] **Token storage** — state that platform access/refresh tokens are encrypted at rest (AES-256-GCM via `services/ecommerceCrypto.ts`)
- [ ] **Customer data retention** — how long DMs/comments are stored; deletion path on disconnect
- [ ] **Third-party processors** — name each: OpenAI (AI generation), Resend (transactional email), Sentry (error tracking), and any image hosting / CDN actually in use (verify against `package.json` before naming)
- [ ] **Data residency** — where the database is hosted (per project memory: production runs on the user's own server, not a managed cloud DB)
- [ ] **PDPL compliance** — Saudi Personal Data Protection Law applies to most Salla merchants and their end customers; even though Salla doesn't require GDPR endpoints, PDPL data-subject rights must be honored
- [ ] **Right to deletion** — explicit path: merchant emails support, all data is purged within X days
- [ ] **Children's data** — state no targeting of users <13 (NA in a B2B context but reviewers ask)
- [ ] **Localization** — Arabic version of the privacy policy must exist alongside English; both must say the same thing. Currently driven by `next-intl` keys, so both locales render the same content — but the keys themselves need to be filled in for both languages.

Update path:
1. Edit `frontend/src/i18n/{en,ar}/privacy.json` (or whatever namespace `privacy.tsx` reads from) to add the new sections.
2. Run `npm run translation:validate` per `AI_INSTRUCTIONS.md` rule 5.
3. Verify the page renders correctly at `/en/privacy` and `/ar/privacy` (RTL).
4. Commit with the matching listing-asset PR so the policy and the listing go live together.

---

## 7. Support + business decisions

### Support email
- [TBD — recommend `support@jawab24.com` or platform-specific `salla-support@jawab24.com` for queue routing]

### Pricing model
Salla supports two billing models:
- **(A) Salla-managed billing** — Jawab24 charges through Salla's billing API, Salla takes a cut, merchant pays in SAR through their existing Salla payment relationship. Lower friction, lower margin.
- **(B) External billing** — Jawab24 has its own subscription page; merchant signs up there. Higher friction (two payment relationships), full margin.

[TBD — decide.] *Recommendation, not decided:* (A) for launch — first-100-merchant adoption friction matters more than per-merchant margin. Validate by checking what comparable Salla apps in the same category do.

### Free tier strategy
- *Recommendation, not decided:* free tier with caps matching the Jawab24.com plan (e.g. 100 AI replies/month), then paid plans through Salla billing.
- Free tier prevalence on the Salla App Store [TBD — verify by browsing the live listings; the original draft cited "~30%" without a source].
- Decision: [TBD]

### Pricing tiers (if Salla-managed billing)
- [TBD — sync with Jawab24.com plan structure]

---

## 8. Final asset inventory checklist (for submission day)

When every box below is ticked, Phase 5 is done.

### Required
- [ ] App icon 1024×1024 PNG (Arabic-readable at 64×64)
- [ ] Banner / hero image at Salla-required dimensions (verify in Salla Partners docs)
- [ ] 4–6 screenshots, **Arabic version**, 1280×720 or higher
- [ ] 4–6 screenshots, **English version**
- [ ] Demo video, 60–90s, Arabic narration, Arabic + English captions, ≤30 MB
- [ ] Listing copy (name, tagline, long description) in **Arabic** — final, marketing-approved
- [ ] Listing copy in **English** — final
- [ ] Feature bullets in both languages
- [ ] Privacy policy URL points to a live page covering Section 6 checklist
- [ ] Terms of service URL — verify exists and references Salla
- [ ] Support email — set up, monitored, auto-responder configured
- [ ] Salla App Store category + tags chosen
- [ ] Pricing model decision documented
- [ ] Free tier policy documented

### Nice-to-have (not blocking)
- [ ] Press kit page (`jawab24.com/press` or similar)
- [ ] 1-page PDF case study from a Salla merchant beta tester (if any)
- [ ] Comparison table vs LetsBot / Javna for international Salla merchants

---

## 9. Open questions for the team

Before locking copy/assets, confirm:

1. **Salla App Store exact spec sheet** — banner dimensions, video size cap, screenshot count limits. Browse the Partners portal or contact Salla developer support.
2. **Marketing approval on Arabic copy** — who signs off? Get it in writing before assets are produced.
3. **Designer availability** — icon refresh + screenshots + video are 1-2 days of design work. Booked in?
4. **Demo store access** — assets need to show realistic Salla data. Use the dev store from Phase 4.2 or a separate "marketing" store?
5. **Beta merchant testimonials** — any existing Jawab24 users on Salla we can quote (with permission)?
6. **Decision on billing model (A vs B)** — calendar-time blocker for any pricing screen.

---

## What this brief does NOT cover

- The Phase 4.2 launch validation execution (separate doc: `SALLA_LAUNCH_VALIDATION.md`)
- The actual Salla Partners app config (production credentials, callback URL, scopes — covered in `SALLA_LAUNCH_VALIDATION.md` Section 7)
- Phase 3 features (DM cart recovery, order notifications) — explicitly listed as "coming soon" in the long description; they ship as v1.1 after launch
- Localization beyond Arabic + English (hold for v1.x)
