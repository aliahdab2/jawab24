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

### Positioning direction (DECIDED 2026-05-30)
**Frame Jawab24 as an AI _sales rep_ (مندوب مبيعات), not a customer-service auto-reply tool.** It doesn't just answer — it recommends products, quotes live prices, follows up, and drives the customer toward buying (checkout completes in the merchant's Salla store). This shifts the lead framing from "يردّ" (replies) to the sales-rep identity, pushes the category toward Marketing/Sales over Customer Service, and should propagate beyond this listing (landing page, other app-store listings) for brand consistency — tracked as a follow-up, not in this PR.

> **Honesty guardrail (2026-07-03):** keep "مندوب مبيعات / sales rep" as the *identity*, but avoid transact **verbs** — the software does not itself sell or complete a purchase. Use "يقنع / يوصي / يقود للشراء" (persuade / recommend / drive to purchase), not "يبيع / يُتمّ البيع" (sells / closes the sale). Checkout always happens in the merchant's Salla store. "AI agent" is NOT the frame — see `DECISIONS.md` D-014.

> Term choice: `مندوب مبيعات` (sales rep — stronger commerce resonance) vs `موظف مبيعات` (sales employee — literal). Leaning `مندوب مبيعات`; confirm with marketing.

### Value proposition (one-liner, Arabic-first) — DRAFT, sales-rep reframe (honesty-checked; WhatsApp promoted 2026-07-05)
**مندوب مبيعات بالذكاء الاصطناعي يعرّف عملاءك بمنتجات متجرك في سلة وأسعارها، ويقنعهم بالشراء عبر واتساب وفيسبوك وإنستغرام طوال اليوم بلا توقّف.**

(English fallback for international merchants: *An AI sales rep that pitches your Salla products and answers customers on WhatsApp, Facebook + Instagram 24/7.*)

> **⚠️ WhatsApp go-live precondition (decided 2026-07-05):** the copy claims WhatsApp as SHIPPED. WhatsApp is live on `main` (#392) but behind a founder canary (`WHATSAPP_ALLOWLIST` + `NEXT_PUBLIC_WHATSAPP_CANARY_ADMIN_ONLY`). **Before the listing goes live, the canary MUST be opened** (clear the allowlist, unset the admin-only flag, `NEXT_PUBLIC_WHATSAPP_CONFIG_ID` set in prod) — otherwise the listing over-claims. Tracked on the submission-day checklist in `SALLA_LAUNCH_ACTIONS.md`.

### What sets Jawab24 apart from other Salla apps
1. **Arabic-first AI** — not English translated to Arabic. Trained on Gulf + Levantine + Egyptian dialects.
2. **Real catalog awareness** — answers reference actual product titles, prices, stock from Salla, not generic chatbot fluff.
3. **WhatsApp + Facebook + Instagram in one app** — competitors (LetsBot, Javna) are WhatsApp-only; Jawab24 answers all three channels from one dashboard (WhatsApp shipped 2026-07-04, #392).
4. **3 reply modes** — public comment reply, private DM, or both. Merchant-configurable per page.
5. **Already shipped:** product sync, RAG-powered answers, hallucinated-price guard, multi-language detection.

---

## 2. Listing copy (Arabic — primary)

> **All copy below is draft. Run through marketing review before publishing.**

### App name (شاشة العرض)
**Jawab24 — جواب24**

### Short tagline (~50 chars Arabic) — DRAFT, sales-rep reframe (WhatsApp-first for the Saudi audience)
**مندوب مبيعاتك الذكي على واتساب وفيسبوك وإنستغرام**

### Short description / App description — v1 LIVE in portal; v2 (adds WhatsApp) NEEDS a portal re-save
Sales-rep positioning; claims only what the product truly does ("answers"). It does NOT transact — the sale closes in the merchant's Salla store, so no "يبيع نيابةً عنك"/transact claim. No "رد آلي".

- **v1 — live in Salla app 1565152053 since 2026-06-08:**
  - **Arabic (111 chars):** مندوب مبيعات بالذكاء الاصطناعي يقرأ منتجات متجرك في سلة وأسعارها، فيجيب عملاءك على فيسبوك وإنستغرام طوال اليوم.
  - **English (120 chars):** An AI sales rep that reads your Salla products and prices and answers your customers on Facebook and Instagram, all day.
- **v2 — WhatsApp promoted (2026-07-05); re-save in the portal before submission (founder action, ≤200-char limit OK):**
  - **Arabic (120 chars):** مندوب مبيعات بالذكاء الاصطناعي يقرأ منتجات متجرك في سلة وأسعارها، فيجيب عملاءك على واتساب وفيسبوك وإنستغرام طوال اليوم.
  - **English (130 chars):** An AI sales rep that reads your Salla products and prices and answers your customers on WhatsApp, Facebook and Instagram, all day.

### Long description (Arabic, ~250 words) — DRAFT, sales-rep frame (awaiting marketing sign-off)

> ✅ Honesty pass DONE (2026-07-03, re-applied 2026-07-05): transact verbs softened throughout — `ليُتمّ عملية البيع` → `يقود عميلك نحو إتمام الشراء في متجرك`; the bullet `يبيع…` → `يقنع ويردّ…`; closer `يرد ويبيع` → `يرد ويقنع عملاءك`. EN mirrors (sells/close the sale → persuades/guide toward buying). WhatsApp promoted to shipped (2026-07-05, founder decision — see the go-live precondition in §1). Still awaiting marketing sign-off.

> Wedge: lead on Arabic-first AI depth + live Salla catalog (verified shipped). Proactive order/cart features held as "قريباً" until Phase 4.2 validates their Salla wiring (see A2/A3 in the launch plan). Arabic is canonical; English below is the translation.

```
هل تقضي ساعاتك في الرد على نفس الأسئلة؟ "كم السعر؟"، "هل المنتج متوفر؟"، "وين وصل طلبي؟". كل رسالة يتأخر الرد عليها قد تعني عميلاً يذهب إلى متجر آخر.

Jawab24 هو مندوب مبيعاتك الذكي الذي لا ينام. يربط متجرك في سلة برقم واتساب أعمالك وصفحاتك على فيسبوك وإنستغرام، ويرد على رسائل عملائك وتعليقاتهم تلقائياً — بأسعار ومنتجات متجرك الحقيقية، طوال اليوم.

ما الذي يميّز Jawab24؟ إنه يفهم العربية كما يتحدثها عملاؤك — الفصحى واللهجات الخليجية والمصرية والشامية — لا ترجمة آلية. يقرأ منتجاتك وأسعارك مباشرة من سلة، فيجيب بمعلومات دقيقة بدل الردود العامة، ويقترح المنتج المناسب ويقود عميلك نحو إتمام الشراء في متجرك. وإذا لم يجد الإجابة في معلومات متجرك، ينبّهك بدل أن يخمّن.

أهم المزايا:
• ردود فورية على رسائل واتساب ورسائل وتعليقات فيسبوك وإنستغرام
• يرد على تعليقات منشوراتك العامة — وليس الرسائل الخاصة فقط
• يقرأ منتجاتك وأسعارك من سلة، ويزامنها تلقائياً عند أي تحديث
• يقنع ويردّ بالعربية الفصحى أو بلهجة عميلك
• يقترح المنتجات المناسبة من متجرك
• ثلاث طرق للرد: تعليق عام، رسالة خاصة، أو الاثنان معاً
• تأكيد الطلبات وتذكير العملاء بالعربات المتروكة (قريباً)

آمن وموثوق: نشفّر بيانات الدخول إلى متجرك، ولا نشارك بيانات عملائك. متوافق مع نظام حماية البيانات الشخصية (PDPL).

ابدأ مجاناً اليوم — بدون بطاقة ائتمان. دع Jawab24 يرد ويقنع عملاءك، وتفرّغ أنت لتنمية متجرك.
```

### Long description (English fallback, ~230 words) — DRAFT (translation of the canonical Arabic)

```
Tired of answering the same questions all day? "How much is this?", "Is it in stock?", "Where's my order?" Every slow reply is a customer who might buy somewhere else.

Jawab24 is your AI sales rep that never sleeps. It connects your Salla store to your WhatsApp Business number and your Facebook and Instagram pages, and replies to customer messages and comments automatically — with your store's real products and prices, around the clock.

What makes Jawab24 different? It understands Arabic the way your customers actually speak it — Modern Standard plus Gulf, Egyptian, and Levantine dialects — not clumsy machine translation. It reads your products and prices straight from Salla, so it answers with accurate details instead of generic chatbot replies, and recommends the right product to guide the customer toward buying in your Salla store. When it can't find an answer in your store info, it flags you instead of guessing.

Key features:
• Instant replies to WhatsApp messages and Facebook & Instagram messages and comments
• Replies on your public post comments — not just DMs
• Reads your Salla products and prices, auto-syncing on every update
• Persuades and replies in Modern Standard Arabic or your customer's dialect
• Recommends the right products from your catalog
• Three reply modes: public comment, private DM, or both
• Order confirmations & abandoned-cart reminders (coming soon)

Safe and trusted: your store credentials are encrypted and we never share your customers' data. PDPL-compliant.

Start free today — no credit card required. Let Jawab24 reply and persuade, so you can focus on growing your store.
```

### Feature bullets (Arabic, 5–7 items, ≤8 words each) — DRAFT, sales-rep reframe (persuasion verbs, honesty-checked; WhatsApp promoted 2026-07-05)
- ✅ يقترح المنتجات المناسبة من متجرك ويقود للشراء
- ✅ يجيب فوراً عن الأسعار والتوفّر من منتجات متجرك في سلة
- ✅ يقنع ويردّ بالعربية الفصحى أو بلهجة عملائك
- ✅ يتابع العربات المتروكة ويذكّر العميل بإكمال طلبه (قريباً — Phase 3)
- ✅ يزامن منتجاتك وأسعارك من سلة تلقائياً
- ✅ يعمل طوال اليوم دون توقّف على واتساب وفيسبوك وإنستغرام
- ✅ يدعم العربية والإنجليزية، ومدعوم بفريق سعودي

### Categories / tags (Salla taxonomy)
- Primary category: lean **Marketing / Sales (التسويق / المبيعات)** over Customer Service, to match the sales-rep positioning — pending confirmation of Salla's actual taxonomy (open question §9.1).
- Tags: `sales`, `chatbot`, `whatsapp`, `facebook`, `instagram`, `AI`, `ai-agent`, `arabic`, `social-commerce`, `cart-recovery` — leading with sales/commerce intent over `customer-service`
  - `ai-agent` is an **English-side SEO keyword only** (high-intent search term) — NOT the headline framing, and NOT translated into the Arabic copy. See [`DECISIONS.md`](../DECISIONS.md) D-014.

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

> ⭐ **Rows 1–3 are SHOT and shipped** at `docs/store-listing/salla/gallery-{1,2,3}.png`
> (re-shot 2026-09-04). The «Arabic copy overlay» column below records what was
> APPROVED; the «As shipped» column records what is actually on the PNG, because the
> two drifted and the divergence needs a sign-off, not a silent edit. Rows 4–6 were
> never shot — the listing takes exactly 3 gallery images.

| # | Screen | What it shows | Arabic copy overlay (approved) | As shipped 2026-09-04 | Notes |
|---|---|---|---|---|---|
| 1 | `/integrations` connected state | Connected Salla store card with green "متصل" badge, page-link chips, product count | "اربط متجرك في سلة بصفحاتك في دقيقة" | ⚠️ "اربط متجرك في سلة بواتساب وفيسبوك وإنستغرام في دقيقة" — names the three channels | ⛔ `/integrations` is ADMIN-ONLY in production, so this shot shows a screen a Salla merchant cannot open. Needs the gate dropped or a re-shoot — see `docs/store-listing/salla/README.md` |
| 2 | `/admin/playground` with Salla product context | Real Salla product question + AI reply quoting actual price | "الذكاء الاصطناعي يقرأ منتجاتك مباشرة" | ⚠️ "يقرأ منتجاتك وأسعارك من سلة، ويجيب عملاءك على واتساب وفيسبوك وإنستغرام" | Shot on the in-app «اختبار الرد الذكي» modal, not `/admin/playground`. Real catalog, real price |
| 3 | Comments page with auto-reply on a real FB post | Customer comment **in Arabic** + AI reply showing product detail | "يرد على تعليقات فيسبوك وإنستغرام تلقائياً" | ✅ caption matches | ⛔ The shipped crop shows two ENGLISH pairs — violates "in Arabic". `sources/capture.js` now fails the shoot on this rather than letting it ship |
| 4 | Settings — knowledge base | KB editor showing Arabic store info | "يفهم سياساتك ويستخدمها في الردود" | — not shot |  |
| 5 | Settings — auto-reply mode toggle | The 3 reply modes (public, DM, both) | "اختر طريقة الرد المناسبة لك" | — not shot |  |
| 6 | Mobile view of comments on the iOS app | The Capacitor mobile app showing the same comment + reply | "تابع الردود من جوالك" | — not shot | Optional — only if listing supports 6 |

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
| 4 | 0:32–0:48 | Comments page showing AI reply on a Facebook post belonging to the test page, then a DM thread (both synthetic) | "يرد على التعليقات والرسائل في فيسبوك وإنستغرام، تلقائياً." |  |  |
| 5 | 0:48–0:60 | Knowledge base editor briefly + Settings → reply mode toggle, both at `/ar/...` paths | "تحكم كامل: متى يرد، وكيف يرد." |  |  |
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

## 6. Privacy policy — ✅ GAP CLOSED (re-verified 2026-08-20)

⚠️ **The 2026-05-07 analysis below was true when written and is now STALE.** It said
`frontend/src/pages/privacy.tsx` was "generic … no Salla-specific or processor-specific content".
Re-verified against the source on 2026-08-20: the policy now carries **§7 E-commerce Store
Integrations** naming Shopify, Salla and Zid, plus ten named processors, PDPL, EU data residency
with cross-border consent, retention, children's data and deletion — in **both** locales.

Item-by-item, against the original required list:

| Required | State |
|---|---|
| Salla data scope | ✅ `shareItem5` + `ecommerceText` — products, orders, abandoned carts, webhooks, per authorized scopes |
| Token storage encrypted at rest | ✅ `ecommerceItem1` — AES-256-GCM, decrypted only at the outbound call |
| Customer data retention + deletion on disconnect | ✅ `ecommerceItem5`, `retentionText`, `deletionText` |
| Third-party processors named | ✅ OpenAI, Meta, Shopify, Salla, Zid, Vonage, Resend, Sentry, Google — **plus Stripe, added 2026-08-20** (it was the one genuine omission: subscription payments were processed but the processor was unnamed) |
| Data residency | ✅ `residencyText` — dedicated EU servers (Germany/Finland) |
| PDPL | ✅ named in `residencyText`, with explicit cross-border-transfer consent |
| Right to deletion | ✅ `deletionText` |
| Children's data | ✅ `childrenText` |
| Arabic version | ✅ both locales, key-for-key (`translation:validate` enforces parity) |

**Nothing blocks submission on the privacy policy.** ⛔ Do not re-run this analysis from the
2026-05-07 text — verify against `frontend/src/i18n/{en,ar}/privacy.json`, which is the source.

## 7. Support + business decisions

### Support email
✅ **DECIDED 2026-09-03 (owner): `support@jawab24.com`** — one inbox for all three portal fields
(notification, submission, support), tag-routed rather than split into a per-platform
`salla-support@` alias we would have to remember to monitor at zero installs.

Receiving is verified against live DNS (Namecheap forwarding MX + matching SPF) and confirmed by
the owner. ⛔ Still owed before **Submit**: an auto-responder (forwarding provides none, and a
Gmail vacation reply would answer from the owner's personal address). See
`docs/store-listing/salla/PORTAL_FIELD_MAP.md` §5 for the full verification and the two gaps.

### Pricing model
Salla supports two billing models:
- **(A) Salla-managed billing** — Jawab24 charges through Salla's billing API, Salla takes a cut, merchant pays in SAR through their existing Salla payment relationship. Lower friction, lower margin.
- **(B) External billing** — Jawab24 has its own subscription page; merchant signs up there. Higher friction (two payment relationships), full margin.

✅ **DECIDED 2026-05-30: (A) Salla-managed billing for launch.** Rationale: first-100-merchant adoption friction matters more than per-merchant margin; merchant pays in SAR through their existing Salla payment relationship. Revisit margin trade-off after launch traction.

### Free tier strategy
✅ **DECIDED 2026-05-30: free tier capped to the jawab24.com free plan (~100 AI replies/month), then paid tiers through Salla billing.** Lowers the trial barrier on a price-sensitive Salla audience.
- Free tier prevalence on the Salla App Store [TBD — verify by browsing the live listings; the original draft cited "~30%" without a source].

### Pricing tiers (if Salla-managed billing)
- [TBD — sync with Jawab24.com plan structure]

---

## 8. Final asset inventory checklist (for submission day)

When every box below is ticked, Phase 5 is done.

> **Specs re-scoped 2026-07-09 to Salla's confirmed requirements** (see `SALLA_LAUNCH_ACTIONS.md` §1, confirmed from Salla docs 2026-06-08 — the original list below guessed Shopify-like values). Confirmed format: icon **512×512** PNG/JPEG ≤1 MB (symbol-only, 1:1); **3 App Gallery images @1366×768**; **3 Key Benefits images @1600×1600** (each with title + description); video is an **optional YouTube link ≤2 min** (not an uploaded file); **no separate banner field exists**.

### Required
- [ ] App icon **512×512** PNG/JPEG ≤1 MB, symbol-only, 1:1 (min 250×250; Arabic-readable when scaled down)
- [ ] ~~Banner / hero image~~ — no banner field in Salla's listing; visuals = gallery + key-benefit images
- [ ] **3 App Gallery images, 1366×768** — Arabic set (English variants if the portal supports per-locale assets)
- [ ] **3 Key Benefits images, 1600×1600** + title + description each, both languages
- [ ] Demo video — **optional YouTube link, ≤2 min**, Arabic narration, Arabic + English captions
- [ ] Listing copy (name, tagline, long description) in **Arabic** — final, marketing-approved
- [ ] Listing copy in **English** — final
- [ ] Feature bullets in both languages
- [x] Privacy policy URL points to a live page covering Section 6 checklist — `/privacy` covers Salla (سلة) + PDPL + processors (OpenAI/Stripe) in EN **and** AR (verified 2026-06-07; merged PR #176)
- [x] Terms of service URL — `/terms` exists and references Salla in EN (×2) and AR (سلة ×3) (verified 2026-06-07)
- [ ] Support email — set up, monitored, auto-responder configured
- [x] Salla App Store category + tags chosen — direction decided (Marketing/Sales lead; tags in §2); exact Salla taxonomy still to confirm in portal (§9.1)
- [x] Pricing model decision documented — Salla-managed billing (decided 2026-05-30, §7)
- [x] Free tier policy documented — capped to jawab24.com free plan (~100 AI replies/mo), then paid via Salla (decided 2026-05-30, §7)

### Nice-to-have (not blocking)
- [ ] Press kit page (`jawab24.com/press` or similar)
- [ ] 1-page PDF case study from a Salla merchant beta tester (if any)
- [ ] Comparison table vs LetsBot / Javna for international Salla merchants

---

## 9. Open questions for the team

Before locking copy/assets, confirm:

1. **Salla App Store exact spec sheet** — banner dimensions, video size cap, screenshot count limits. Browse the Partners portal or contact Salla developer support. ⏳ STILL OPEN.
2. **Marketing approval on Arabic copy** — who signs off? Get it in writing before assets are produced. ⏳ STILL OPEN — copy is draft-complete, blocked only on sign-off.
3. **Designer availability** — icon refresh + screenshots + video are 1-2 days of design work. Booked in? ⏳ STILL OPEN — the long pole.
4. ✅ **Demo store access — RESOLVED.** Use the Phase 4.2 dev store `salla.sa/dev-jkgsyu3w6pzzfrzw` (merchant 2108580704). Caveat: its storefront is stuck in maintenance mode (admin toggle UI broken), so storefront screenshots are hard — admin/product/playground screens are fine; consider a separate "marketing" store only if a live storefront shot is required.
5. **Beta merchant testimonials** — any existing Jawab24 users on Salla we can quote (with permission)? ⏳ OPEN (nice-to-have).
6. ✅ **Billing model — DECIDED 2026-05-30: (A) Salla-managed billing.** No longer a blocker.

> **Phase 4.2 outcome (2026-06-07):** the order-notification wiring the copy gated behind "قريباً" is now **code-validated against real Salla payloads and merged** (PR #267 parser fix + #268 refactor; order.created/shipped/delivered confirmed; S3 HMAC passed). **Copy decision for the team:** order-confirmation/shipped/delivered notifications could be promoted from "قريباً" to a shipped feature IF the in-product enable path is merchant-ready; keep abandoned-cart as "قريباً". Confirm feature-enabled state before changing the description.
>
> **Update 2026-07-09 (post PR #411, merged 07-07):** two facts in the earlier note are superseded. (1) There **IS** a separate shipment webhook now — the app subscribes to `order.shipment.created` (`backend/src/services/salla.ts`), fixed in #411 alongside the Salla shipment-payload parser. (2) The abandoned-cart topic is `abandoned.cart` (not `cart.abandoned`) and it is fully wired — webhook → `abandoned_cart` notification scheduling (`controllers/salla.ts`). It remains **unvalidated against a live cart** (Salla dev-store maintenance-toggle blocker), so abandoned-cart stays "قريباً" in copy. Notification dedup hardened in #411 (unique index, migration 0130) and audit PRs #421/#422 are merged.

---

## What this brief does NOT cover

- The Phase 4.2 launch validation execution (separate doc: `SALLA_LAUNCH_VALIDATION.md`)
- The actual Salla Partners app config (production credentials, callback URL, scopes — covered in `SALLA_LAUNCH_VALIDATION.md` Section 7)
- Phase 3 features (DM cart recovery, order notifications) — explicitly listed as "coming soon" in the long description; they ship as v1.1 after launch
- Localization beyond Arabic + English (hold for v1.x)
