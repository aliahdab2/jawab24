# Salla portal — field-by-field paste map

> **What this is:** a map from each field of the Salla publish wizard to the file that already
> holds its content, plus the decisions the existing drafts do **not** cover. It deliberately
> copies no prose — the copy lives in `.planning/SALLA_LISTING_BRIEF.md` and `benefits.md`, and
> duplicating it here would guarantee the two drift.
>
> **Portal state it was written against:** app `665811310`, read 2026-08-20. `Status: Development`,
> publish wizard an unsubmitted draft. Fill and **Save Draft** — see the runbook's readiness gate
> before anyone presses *Submit for Review*.

## Where the fill session stopped — 2026-08-20

**Filled and verified:** short description AR (v2), long description AR + EN, Categories = `Marketing`,
App Themes ×3, Supported Countries = Saudi Arabia only, Search Terms 20/20, all three contact emails,
Privacy Policy URL. Nothing was submitted; `Save Draft` has **not** succeeded yet.

**Three things stand between here and a saved draft**, in the order they should be cleared:

| # | Blocker | Owner | Note |
|---|---|---|---|
| 1 | 🔴 **App Pricing has no "Free" option** and demands a charge ≥ 1 | needs a **Salla support answer** | ⛔ never enter a price — see §4 for why it would charge merchants for nothing |
| 2 | 🔴 **Educational Video is required** and blocks the save | needs a 60–90s screencast (script exists, §5 of the brief) | ⛔ never paste a placeholder URL |
| 3 | ⏳ **Image uploads** — logo, 3 screenshots, 3 benefit images | human drag-and-drop | files staged at `~/Downloads/salla-listing/`; an automation extension cannot open a file picker |

**Not a blocker, contrary to an earlier prediction:** the Service Trial fields (and therefore the
reviewer account and demo store) are required only at *Submit*, not to save a draft — see §6.

⚠️ **The wizard re-renders and resizes between clicks**, and during the fill session it accepted
several mis-clicks (two extra countries, a `Chat` category, two unwanted themes — all reverted and
visually re-checked). Treat a visual read-back of Basic Info as part of finishing, not as paranoia.

## 1. Basic Info

| Field | Source | State 2026-08-20 |
|---|---|---|
| App Name | `Jawab24` | ✅ filled |
| Short Description | `SALLA_LISTING_BRIEF.md` §2 — **v2** (the one naming واتساب) | ✅ AR replaced with v2 in the fill session; EN present |
| App Description (long) | `SALLA_LISTING_BRIEF.md` §2 — Arabic ~250w, English ~230w | ✅ AR + EN pasted, **minus the «العربات المتروكة (قريباً)» bullet** (unshipped claim — see §3) and with no «فريق سعودي» clause. Owner signed off in session |
| App Logo | `icon-512.png` (512×512, 58 KB) | ⏳ required; upload is a human drag-and-drop — the extension cannot open a file picker. Staged at `~/Downloads/salla-listing/` |
| Educational Video | `SALLA_LISTING_BRIEF.md` §5 has the 60–90s script; **no video is produced** | 🔴 empty and **BLOCKING** — starred required AND confirmed to fail Save Draft (`Educational Video URL: Invalid url`). This map previously called it "optional, ship without it"; that was wrong. Now a hard prerequisite |
| Categories | see **Sub-category correction** below | ✅ set to **Marketing** (the wrong `Cross-sell / Upsell` is gone) |
| App Themes (1–3, required) | see **App Themes** below | ✅ the three chosen are set in the portal |
| Supported Countries | owner decision — **Saudi Arabia only** | ✅ set to Saudi Arabia |
| Search Terms (20/20) | **paste-ready list below** | ✅ all 20 entered in order |

### Sub-category correction

The app currently sits under `Category: General App` → `Sub Category: **Cross-sell / Upsell**`.
That describes a merchandising widget, not a reply assistant, and it is what a merchant browsing
the store will filter on. The brief (§2) leans **Marketing / Sales (التسويق / المبيعات)** over
Customer Service to match the sales-rep positioning. Pick from Salla's live taxonomy at fill time
and record what was chosen here — the brief lists this as open question §9.1.

### App Themes — required, 1–3 of 14. RESOLVED 2026-08-20

Field text: *"Choose 1 to 3 themes that reflect the merchant value your app delivers."* Required —
`Field must contain at least 1 element`. The full live taxonomy, read from the portal 2026-08-20:

> Attract new visitors · Convert visitors into buyers · Increase AOV · Recover abandoned carts ·
> Turn buyers into loyal customers · Reach customers wherever they are · Ship faster and cheaper ·
> Build trust after the sale · Sell in more places · Automate daily operations · Know your numbers ·
> Control inventory & accounting · Design without a developer · Grow with AI

**✅ The three to tick:**

| Theme | Why it is true of this app |
|---|---|
| **Reach customers wherever they are** | The most literal fit: WhatsApp + Messenger + Instagram answered by one assistant. Note there is **no customer-service/communication theme** in the taxonomy — this is its stand-in |
| **Convert visitors into buyers** | Matches the decided sales-rep positioning (brief §1, 2026-05-30) and the `Marketing` category |
| **Grow with AI** | The honest differentiator — Arabic + dialect comprehension is an AI capability, not a template |

**⛔ Never tick `Recover abandoned carts`.** It is precisely the claim deleted from the listing prose
for being unshipped and unverified (the `abandoned.cart` event has never been confirmed by a real
delivery). A merchant who filters on it arrives looking for the one thing we cannot do.

**Two considered and rejected — record the reasoning so it is not re-litigated:**
- `Automate daily operations` — true, but it shelves us beside inventory and accounting tools and
  delivers a merchant shopping for back-office ops. Same failure mode as the `Cross-sell / Upsell`
  sub-category error.
- `Build trust after the sale` — we do answer "where is my order", but the shipment-tracking path
  has **never been exercised against a live Salla API** (test plan Tier 3.8). Do not advertise a
  capability whose only evidence is documentation.

General rule that produced these picks: a theme is a browse filter, so a false one delivers
merchants who bounce. Fewer true themes beat three with a wrong one — the field accepts 1.

### ⚠️ Save Draft is NOT a free-form parking space — it validates

Measured 2026-08-20: pressing **Save Draft** with required fields empty refuses with *"Please fix the
errors before submitting"*. So the reassurance elsewhere in this map that "the entire listing can be
built and saved without submitting anything" holds only once **every required field** is filled —
drafting is safe, but it is not incremental. **Go in with every asset in hand.**

**The validator's literal blocking set** (captured from a real Save Draft attempt, after Basic Info
text, categories, themes, countries, search terms and the three contact emails were already filled):

| Step | Errors named |
|---|---|
| Basic Info | `App Logo: This field is required` · `Educational Video URL: Invalid url` |
| Features & Media | `Screenshot 1/2/3 - Image` · `Benefit 1/2/3 - Image` · `Benefit 1/2/3 - Title in English / in Arabic` · `Benefit 1/2/3 - Description in English / in Arabic` — all "This field is required" |
| App Pricing | `Price: Charge must be at least 1.` — see §4, this one is a **policy** blocker, not a form one |
| Contact Info | `Contact Method: This field is required` · `FAQ URL: Invalid url` |
| App Configuration | ✅ none |
| Service Trial | ✅ none — **despite all four fields being starred** (see §6) |

Two things this table settles: the **Promotional Banner and Embedded App Banner are explicitly
labelled Optional** (so the "one asset still owed" worry in §3 is closed — nothing is owed), and
**Support Phone carries no star**.

⛔ **Educational Video is starred and genuinely blocks the save** — confirmed, not assumed. Do **not**
paste an unrelated or placeholder URL to clear it. The honest path is producing the 60–90s screencast
from the script in `SALLA_LISTING_BRIEF.md` §5. It is now a hard prerequisite for saving a draft at
all, so it belongs on the critical path beside the pricing question.

### Supported Countries — decision owed

Not addressed anywhere in the brief. Two constraints that must shape it:

- 🔴 **Syria is barred on WhatsApp** and the listing copy leads with WhatsApp. See
  `project_whatsapp_syria_barred` in memory before ticking countries.
- Salla merchants are overwhelmingly **KSA**; the free-tier strategy (§7) was written for that
  audience. Narrow is safer than wide — a country we cannot serve is a support burden and a
  review risk.

### Search Terms — paste these 20

Arabic first (that is how Salla merchants search), English after for the EN-side surface. Order
matters only in that the first terms are the highest-intent ones.

```
ردود تلقائية, رد آلي, ردود ذكية, خدمة العملاء, ذكاء اصطناعي, واتساب, مسنجر, انستغرام, فيسبوك,
تعليقات, مندوب مبيعات, وكيل مبيعات, مساعد مبيعات, مزود معلومات, مصدر معلومات,
chatbot, whatsapp, instagram, facebook, ai-agent
```

**Revised 2026-08-20 (owner request).** Four terms added — `مسنجر` (Messenger is the actual surface
for FB DMs and was missing while `فيسبوك` was present), `وكيل مبيعات`, `مزود معلومات`, and
`مصدر معلومات`. To stay inside the hard 20-term cap, four were dropped: `رسائل` (too generic),
`دعم فني` (files us as a helpdesk — wrong positioning), `أتمتة` (a technical word merchants do not
type), and `customer service` (duplicates `خدمة العملاء`; launch is KSA-only). `sales assistant`
also came out to make room for the Arabic `… مبيعات` variants — **that is the swap to reverse first**
if EN parity is wanted later.

⚠️ **Salla's search-matching behaviour is unknown.** If it matches substrings, the three
`… مبيعات` variants are partly redundant; if it matches whole phrases, all three earn their slot.
Nothing here assumes an answer — the list is deliberately built for the wider case. Record what
actually converts once the listing has traffic.

⚠️ Three constraints already ruled on, do not undo them:
- **`ai-agent` is an English-side SEO keyword only** (D-014). It appears in this list and **nowhere
  in the Arabic copy** — not in the name, description, or benefits.
- «رد آلي» is acceptable **as a search term only** — merchants type it. It must never appear in the
  product copy, where the terminology is «الردود الذكية» (AI_INSTRUCTIONS §6, and the founder rule
  against calling Jawab24 a bot).
- ⭐⭐ **Search terms may carry naming variants; COPY may not.** The reply modes ship in the app as
  «**مساعد مبيعات**» and «**مصدر معلومات**» (`frontend/src/i18n/ar/settings.json` → `replyMode.sales`
  / `replyMode.infoDesk`), while the listing draft's prose says «مندوب مبيعاتك الذكي» — a third
  variant. Diverging words in the *search* field is the field working as intended; diverging words
  between the listing prose and the screen the merchant then opens is a defect. Settle the prose on
  one term (owner decision — it is a product-naming call, not a copy tweak) before submission.

### Supported Countries — recommendation: **Saudi Arabia only** at launch

Not addressed anywhere in the brief. Recommended narrow, for three reasons:

- 🔴 **Syria is barred on WhatsApp**, and the listing copy leads with WhatsApp. Ticking it would
  advertise a channel that cannot be delivered there (`project_whatsapp_syria_barred`).
- Salla's merchant base is overwhelmingly **KSA**, and the free-tier strategy (brief §7) was priced
  for that audience.
- A country we cannot support well is a support burden and a review risk. Widening later is a
  portal edit; retracting a country after merchants install is not.

**Owner sign-off needed** — this is a market decision, not an engineering one.

## 2. App Configuration

✅ Mirrors live config (scopes incl. `shipping.read` — ticked 2026-08-20 — and webhook URL
`https://jawab24.com/salla/webhooks`). **Security Strategy = Signature** — flipped 2026-08-23:
it had been *Token*, which the backend does not verify (it checks `X-Salla-Signature` only), so
the first real install got 401 on every delivery. The portal is the whole grant;
`config.salla.scopes` has zero effect in Easy Mode.

## 3. Features & Media

| Slot | File | Note |
|---|---|---|
| Screenshots (min 3) | `gallery-1.png`, `gallery-2.png`, `gallery-3.png` | 1366×768, already the exact required count and size |
| Key Benefits ×3 | `benefit-1..3.png` + titles/descriptions in `benefits.md` | 1600×1600 |
| Promotional Banner | ❌ not produced | ✅ **confirmed Optional in the portal** (labelled so explicitly, 2026-08-20) — no asset is owed. Leave empty |
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

## 4. App Pricing — 🔴 BLOCKED. **There is no "Free" option**, and a price must not be entered

⚠️ **Correction, measured in the portal 2026-08-20.** Earlier revisions of this section said "set
Free". **No such option exists.** The `Pricing Type` selector offers exactly three:
**One-Time · Recurring · Pay As You Go**. Left on the `One-Time` default with price 0, the wizard
errors with **`Price: Charge must be at least 1.`** — i.e. the form *requires* a chargeable amount,
and this error is one of the four that block **Save Draft** entirely.

⛔ **Do NOT enter a price to clear the error.** This is not a pricing preference; a price here
produces the worst reachable state for a merchant:

- Salla apps-policy **Article 5** requires paid apps to bill through Salla, and Salla-managed
  billing is **NOT IMPLEMENTED** — no code path turns a Salla payment or an `app.subscription.*`
  webhook into a Jawab24 plan.
- Simultaneously, **D-065 guards our Stripe surfaces to *refuse* Salla-sourced merchants**
  (400 `SALLA_BILLED`).

So a paying merchant would be **charged, granted nothing, and blocked from buying the real thing**.
That is taking money without service wiring, not a misconfiguration. Launch is free-tier-only
(decided 2026-05-30) and that decision stands.

**Resolution path — ask, do not guess.** Salla support answered a comparable question in ~29 minutes
during ID verification; a support round trip is the cheap instrument here. The question to send:
how is a free app configured, and does a free-app setting live outside the publish wizard?

**One safe probe while waiting** (a draft field change, fully reversible, commits nothing): switch
the type to **Pay As You Go** and see whether the minimum-charge error clears. If it also demands
≥ 1, revert and wait for support. ⛔ Under no circumstances type a price to get past validation.

⚠️ **Consequence for sequencing:** because this error blocks Save Draft, *nothing else in the wizard
can be saved either*. Uploads and benefit text typed before this resolves are unsaved work that a
page reload discards — and the wizard was observed re-rendering and resizing between clicks. Prefer
resolving pricing first, then filling everything in one stable sitting.

## 5. Contact Info — two more required fields than this map listed

Needed: Notification Email, Submission Email, Support Email, Support Phone, Privacy Policy URL —
**plus two the map did not know about, both required and both found only by Save Draft failing**
(portal 2026-08-20):

- ✅ **`Preferred Contact Method` (Phone / Email / Website) — required. Answer: `Email`.**
  We deliberately have no support phone, and Email is the channel actually staffed (all three email
  fields point at the same inbox). Error text when empty: `Contact Method: This field is required`.
- ✅ **`FAQ URL` — required. Answer: `https://jawab24.com/ar/help`.**
  Verified, not assumed (2026-08-20): the page exists at `frontend/src/pages/help.tsx`, is public
  with no auth gate, returns 200 in production on `/help`, `/ar/help` and `/en/help`, and
  server-renders a **dedicated Salla section** (`sallaTitle` + four items) alongside getting-started,
  Meta-connection, page-disconnected, reply-modes and Post Reply sections. The Arabic URL is given
  explicitly rather than the locale-neutral `/help` because the field takes one URL and the audience
  is Saudi. Error text when empty: `FAQ URL: Invalid url`.
- `Support Phone` — confirmed **optional** (no star). Leave empty; ⛔ do not invent a number.

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

## 6. Service Trial — required for **Submit**, but NOT for Save Draft

Service URL, Test Username, Test Password, Additional Instructions — all empty. Salla's reviewer
uses these to exercise the app.

Owed: a **dedicated review account** on jawab24.com with a connected Salla demo store and synced
products. ⛔ Do not hand over a real merchant's account, and do not use the founder's own.

⭐ **Measured 2026-08-20 — and it overturned a prediction worth recording.** All four fields carry a
required star, from which it was inferred that the draft could not be saved until the reviewer
account existed, putting that account on the critical path. **The measurement disproved it:** the
four fields are starred yet appear **nowhere** in the Save Draft error list, and the Service Trial
step shows **no error badge** while every other unfinished step shows one. So the star means
"required at *Submit for Review*", not "required to save". The reviewer account is a
pre-**submission** dependency, not a pre-**draft** one — build the listing first.
⚠️ The general lesson, since a starred field lying about *when* it is enforced is not intuitive:
read which fields the validator actually names, rather than inferring the blocking set from stars.

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
