# Salla portal — field-by-field paste map

> **What this is:** a map from each field of the Salla publish wizard to the file that already
> holds its content, plus the decisions the existing drafts do **not** cover. It deliberately
> copies no prose — the copy lives in `.planning/SALLA_LISTING_BRIEF.md` and `benefits.md`, and
> duplicating it here would guarantee the two drift.
>
> **Portal state it was written against:** app `665811310`, read 2026-08-20. `Status: Development`,
> publish wizard an unsubmitted draft. Fill and **Save Draft** — see the runbook's readiness gate
> before anyone presses *Submit for Review*.

## 1. Basic Info

| Field | Source | State 2026-08-20 |
|---|---|---|
| App Name | `Jawab24` | ✅ filled |
| Short Description | `SALLA_LISTING_BRIEF.md` §2 — **v2** (the one naming واتساب) | ⚠️ EN present; **confirm the Arabic field carries v2 too**. v1 was saved against the *dev* app `1565152053`, so this app may never have had the AR string at all |
| App Description (long) | `SALLA_LISTING_BRIEF.md` §2 — Arabic ~250w, English ~230w | ❌ empty. ⚠️ still marked *awaiting marketing sign-off* — get that before pasting |
| App Logo | `icon-512.png` (512×512, 58 KB) | ❌ empty |
| Educational Video | `SALLA_LISTING_BRIEF.md` §5 has the 60–90s script; no video is produced | ❌ empty — optional, ship without it |
| Categories | see **Sub-category correction** below | ❌ empty |
| Supported Countries | **decided 2026-08-20: SA · UAE · KW** — see below | ❌ empty |
| Search Terms (0/20) | **paste-ready list below** | ❌ empty |

### Sub-category correction

The app currently sits under `Category: General App` → `Sub Category: **Cross-sell / Upsell**`.
That describes a merchandising widget, not a reply assistant, and it is what a merchant browsing
the store will filter on. The brief (§2) leans **Marketing / Sales (التسويق / المبيعات)** over
Customer Service to match the sales-rep positioning. Pick from Salla's live taxonomy at fill time
and record what was chosen here — the brief lists this as open question §9.1.

### Search Terms — paste these 20

Arabic first (that is how Salla merchants search), English after for the EN-side surface. Order
matters only in that the first terms are the highest-intent ones.

```
ردود تلقائية, رد آلي, خدمة العملاء, ذكاء اصطناعي, واتساب, انستغرام, فيسبوك, رسائل, تعليقات,
مندوب مبيعات, ردود ذكية, دعم فني, أتمتة, chatbot, whatsapp, instagram, facebook, ai-agent,
customer service, sales assistant
```

⚠️ Two constraints already ruled on, do not undo them:
- **`ai-agent` is an English-side SEO keyword only** (D-014). It appears in this list and **nowhere
  in the Arabic copy** — not in the name, description, or benefits.
- «رد آلي» is acceptable **as a search term only** — merchants type it. It must never appear in the
  product copy, where the terminology is «الردود الذكية» (AI_INSTRUCTIONS §6, and the founder rule
  against calling Jawab24 a bot).

### Supported Countries — **Saudi Arabia · UAE · Kuwait** (owner-decided 2026-08-20, **D-088**)

Tick the three countries where Salla **registers merchants**: 🇸🇦 Saudi Arabia, 🇦🇪 UAE, 🇰🇼 Kuwait.

⛔ **Do not tick Qatar, Bahrain, or Oman on the strength of shipping support.** Salla supports
selling and shipping *into* those markets, but that describes where a Saudi or Emirati merchant's
**customers** live — not where the installing merchant's store is registered, which is what this
field governs. ⚠️ The field's exact semantics are **unverified**: confirm the wizard's wording at
fill time and correct this note if it turns out to mean market reach rather than merchant registration.

⏳ **One open check before ticking UAE and Kuwait:** confirm WhatsApp Cloud API messaging is
available for a sender registered in those countries. Our own records bar exactly one country
(Syria, `project_whatsapp_syria_barred`) and no GCC country appears in them — but that is our
record, not Meta's policy, so verify it against Meta's docs (AI_INSTRUCTIONS §10.12).

Widening later is a portal edit; retracting a country after merchants install is not.

#### ⛔ Superseded reasoning — do not restore

An earlier revision recommended **Saudi-only** on two grounds that do not hold:

- «Syria is barred on WhatsApp» is a real constraint on our own direct signups, but Salla does not
  onboard Syrian merchants, so **Syria never appears in this picker**. Irrelevant to this field.
- «Salla's base is overwhelmingly KSA» describes where the merchants are; it is not a reason to
  exclude the ones who are not. Excluding UAE and Kuwait does not improve KSA service, and the
  launch tier is **free**, so there is no per-country pricing exposure either.

Only the third ground survives — a country we cannot serve is a support burden and a review risk —
and it is what the open check above discharges.

## 2. App Configuration

✅ Already mirrors live config (scopes, webhook URL `https://jawab24.com/salla/webhooks`, Security
Strategy = Token). **One gap:** `shipping.read` is not ticked — see the runbook, Phase 2.5. The
portal is the whole grant; `config.salla.scopes` has zero effect in Easy Mode.

## 3. Features & Media

| Slot | File | Note |
|---|---|---|
| Screenshots (min 3) | `gallery-1.png`, `gallery-2.png`, `gallery-3.png` | 1366×768, already the exact required count and size |
| Key Benefits ×3 | `benefit-1..3.png` + titles/descriptions in `benefits.md` | 1600×1600 |
| Promotional Banner | ❌ **not produced** | Check whether the wizard hard-requires it; if so this is the one asset still owed |
| Embedded App Banner | ❌ not produced | Only needed for embedded apps — we are headless, expect optional |

⚠️ `README.md` §"Compromises" flags that the screenshots show dev fixtures (“Test User / Test
Workspace”, «متجر تجريبي»). Decide whether that is acceptable before upload — re-rendering is
`cd sources && node render.js`.

### ⛔ Two bullets in the brief's draft must NOT be pasted

`SALLA_LISTING_BRIEF.md` §2 "Feature bullets" is a 2026-07-05 draft. Two of its seven lines cannot
go into a live listing as written:

1. **«ويُدعم بفريق سعودي» — this is not true.** The company and its founder are registered in
   **Sweden** (the Partners verification ran the non-Saudi Individual path, Swedish bank, Swedish
   registration). Claiming a Saudi team in a Saudi marketplace listing is a false statement of
   origin to merchants and to Salla's reviewer. **Delete the clause.** If a locality signal is
   wanted, the honest one is «دعم بالعربية» — which is true and is the actual benefit.
2. **«يتابع العربات المتروكة … (قريباً — Phase 3)»** — a "coming soon" promise in a listing is an
   over-claim, and this specific feature is not verified: the `abandoned.cart` event string has
   never been confirmed by a real delivery (`SALLA_LAUNCH_VALIDATION.md`). **Delete the bullet**;
   add it when it ships and is proven.

The remaining five bullets describe shipped, demonstrable behaviour and are fine.

## 4. App Pricing — set **Free**, not the current `One-Time / 0`

The wizard is sitting on untouched defaults (`Pricing Type: One-Time`, price 0, trial unchecked).
`One-Time` with a zero price is not the same statement as *free*, and it is the wrong shape for a
subscription product.

⛔ **Do not configure any paid tier at launch.** Salla apps-policy **Article 5** requires paid apps
to bill through Salla, and Salla-managed billing is **NOT IMPLEMENTED** — the code path that would
drive a `'salla'` subscription source from `app.subscription.*` webhooks does not exist. Our Stripe
surfaces are guarded to *refuse* Salla-sourced merchants (D-065), so a paid listing would advertise
a purchase no rail can complete. Launch free-tier-only, exactly as decided 2026-05-30.

## 5. Contact Info — founder-owed, blocks submission

All fields empty. Needed: Notification Email, Submission Email, Support Email, Support Phone,
Privacy Policy URL.

- **Support email — recommend `support@jawab24.com`** for all three fields (notification,
  submission, support). The brief §7 left this `[TBD]` between that and a routed
  `salla-support@jawab24.com`; a per-platform alias buys queue routing we do not need at zero
  installs, and it is one more inbox to forget to monitor. Route by tag inside one inbox instead.
  ⛔ Whichever is chosen must be a **real, monitored inbox with an auto-responder** before
  submission — the reviewer may test it, and an unanswered support address is a rejection reason.
- ✅ **Privacy Policy URL — `https://jawab24.com/privacy`, ready to paste.**
  ⚠️ An earlier version of this file said the page carried "zero Salla/processor content" and had to
  be rewritten first. **That was wrong** — it repeated the brief's 2026-05-07 gap analysis without
  checking the source. Re-verified 2026-08-20: the policy has a full **§7 E-commerce Store
  Integrations** section naming سلة, token encryption at rest, catalog sync, data minimisation,
  webhook handling and deletion-on-disconnect, plus PDPL, EU residency with cross-border consent,
  and ten named processors — in both locales. The one real omission, **Stripe**, was added the same
  day. Nothing here blocks submission.

## 6. Service Trial — founder-owed, blocks review

Service URL, Test Username, Test Password, Additional Instructions — all empty. Salla's reviewer
uses these to exercise the app.

Owed: a **dedicated review account** on jawab24.com with a connected Salla demo store and synced
products. ⛔ Do not hand over a real merchant's account, and do not use the founder's own.

**Service URL:** `https://jawab24.com/login`

**Additional Instructions — paste as-is (Arabic; the reviewer reads Arabic):**

```
مرحباً بفريق مراجعة سلة،

بعد تسجيل الدخول بالبيانات أعلاه:

1. من القائمة الجانبية اختر «المتاجر» — ستجد المتجر التجريبي مرتبطاً، مع عدد المنتجات
   المزامنة وتاريخ آخر مزامنة.
2. اضغط «مزامنة المنتجات» للتأكد من قراءة المنتجات والأسعار مباشرةً من سلة.
3. من صفحة «الإعدادات» افتح «اختبار الرد الذكي» واكتب سؤالاً مثل: «كم سعر ...؟»
   — سيأتي الرد مقتبساً اسم المنتج وسعره الحقيقي من كتالوج المتجر.

جواب24 تطبيق يعمل خارج واجهة المتجر: يقرأ منتجات المتجر وأسعارها ليجيب عملاءكم على
واتساب وفيسبوك وإنستغرام. لا يضيف أي عنصر إلى واجهة المتجر ولا يعدّل عليها.

لأي استفسار: support@jawab24.com
```

⚠️ The instructions describe steps 1–3 exactly as the app behaves today; re-check them against the
build in production before submitting, since the reviewer will follow them literally.

> This same demo store is what Tier 3 of `docs/SALLA_TEST_PLAN.md` needs — including the
> `track_shipment` gate that has never been run. Create it once, use it for both.
