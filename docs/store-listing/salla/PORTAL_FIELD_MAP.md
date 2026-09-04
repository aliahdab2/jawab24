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
App Themes ×3, Supported Countries = Saudi Arabia only (⚠️ to be widened to SA · UAE · KW per D-094),
Search Terms 20/20, all three contact emails,
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
| Supported Countries | **decided 2026-08-20: SA · UAE · KW (D-094)** — see below | ⚠️ the fill session set **Saudi Arabia only**; add UAE + Kuwait at the next sitting |
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

### Supported Countries — **Saudi Arabia · UAE · Kuwait** (owner-decided 2026-08-20, **D-094**)

⚠️ The 2026-08-20 fill session set **Saudi Arabia only** (before this ruling was recorded); UAE and
Kuwait are still to be added. Salla's publishing-standards article lists this field as "UAE or
Saudi Arabia" — the picker accepted more than two countries on 2026-08-20, so Kuwait is probably
offered, but confirm it is actually there before recording it as ticked.

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
  wizard prices per plan, not per country, so there is no per-country pricing exposure either
  (the original draft said "the launch tier is free"; the 2026-08-23 wizard measurement found no
  free pricing type for public apps, so only the weaker form of the point stands).

Only the third ground survives — a country we cannot serve is a support burden and a review risk —
and it is what the open check above discharges.

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

### ⛔ A third line, in the long description's closing paragraph (found 2026-09-04)

**«ابدأ مجاناً اليوم — بدون بطاقة ائتمان» / "Start free today — no credit card required."**

That closer was written for jawab24.com's own signup, where it is true. It is **not** a claim
we can make on this listing. Under D-103 both listed plans are **paid** (146 / 296 SAR) and,
under Article 5, the merchant subscribes through **Salla's** checkout, not ours — so whether a
card is collected when the 14-day trial starts is Salla's flow, which we neither control nor
have ever measured. The whole shelf's model is "paid plan carrying a free trial" (measured
2026-08-26), and a free-and-no-card promise sitting on top of two priced plans reads as a
contradiction to a reviewer before it reads as a benefit.

**Action:** replace the clause with the trial, which IS true and IS the offer —
«جرّبه مجاناً 14 يوماً» / "Free 14-day trial." Do not paste the credit-card promise unless
someone has watched Salla's own trial checkout and can say what it asks for.

## 4. App Pricing — ✅ UNBLOCKED (D-103 + D-104, 2026-08-26). Fill the two paid plans

⚠️ **History.** This section was 🔴 BLOCKED through two states, both now resolved:
(a) *"There is no Free option"* — measured 2026-08-20 (`Pricing Type` = One-Time · Recurring ·
Pay As You Go only; price 0 fails Save Draft with `Price: Charge must be at least 1.`). The live
shelf answered it 2026-08-26: **nobody ships a free plan — every app is a paid plan carrying a
free trial**, and the owner ruled Salla goes public on paid plans (**D-103**).
(b) *"Salla-managed billing is NOT IMPLEMENTED — never enter a price"* — resolved 2026-08-26
(**D-104**): `services/sallaBilling.ts` turns `app.subscription.*`/`app.trial.*` deliveries into
a verified Jawab24 plan (see `docs/integrations/salla.md` § billing). ⛔ The
charged-granted-nothing dead end no longer exists ONLY once that code is DEPLOYED to prod with
`SALLA_APP_ID=665811310` added to `env/backend.env` (+ `--force-recreate` + nginx reload) —
both are submit prerequisites; do not press "Start publishing your App" before them.

**What to enter (D-103 = D-095 numbers, identical to Zid):**

| Plan | Name (AR) | Billing Cycle | Price (ex-VAT) | Trial |
|------|-----------|---------------|----------------|-------|
| Business | **الأعمال** | Monthly (Recurring) | **146 SAR** | **14 days** |
| Pro | **الاحترافي** | Monthly (Recurring) | **296 SAR** | **14 days** |

⛔ The plan **names and prices are load-bearing**: `config/sallaBilling.ts` maps a subscription
to a Jawab24 tier by the plan name («الأعمال»/«الاحترافي») first and by the ex-VAT price
(146/296) as the fallback — Salla's payloads carry no plan id and may deliver `plan_name: null`.
A renamed or repriced plan in the wizard without the matching map change books `unknown_plan`
(fail-loud, no activation) for every paying merchant on it.
⛔ Basic/Starter are never listed (`ecommerceEnabled: false` — they cannot open the store).

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

- ✅ **Support email — `support@jawab24.com`, SETTLED 2026-09-03 (owner).** Use it for all three
  fields (notification, submission, support). The brief §7 left this `[TBD]` between that and a
  routed `salla-support@jawab24.com`; a per-platform alias buys queue routing we do not need at
  zero installs, and it is one more inbox to forget to monitor. Route by tag inside one inbox.
  **Deliverability verified 2026-09-03 against the live DNS**, not assumed: `jawab24.com` publishes
  five `eforward{1..5}.registrar-servers.com` MX records (Namecheap email forwarding) and
  `v=spf1 include:spf.efwd.registrar-servers.com ~all`; the owner confirms the `support@` alias
  forwards to a monitored personal inbox. ⚠️ The absent-MX note in the deliverability audit is
  about **`send.jawab24.com`** (the SES bounce-feedback record) — a different record, and unrelated
  to whether support mail arrives.
  ⛔⭐ **Two gaps forwarding does NOT close — both still open at submission time:**
  (a) **no auto-responder.** Namecheap forwarding has none, and a Gmail vacation responder fires on
  *all* mail to the destination account and answers *from* that personal address — which would
  expose it to the reviewer. An unanswered support address is a rejection reason, so this needs a
  real answer before Submit, not a forward.
  (b) **receive-only.** No `Send mail as` alias exists, so nothing can be sent *from* support@;
  relatedly `RESEND_REPLY_TO` is still unset in prod, so merchant-email footers print
  `info@jawab24.com`. Neither blocks Save Draft.
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

**Decided 2026-09-03 (owner OK pending):** the review account is `ahdabeslov@gmail.com`
(«Mohammad Jamal») — the Facebook review identity already shared with Meta and Apple review.
Jawab24 has **no password login** (Facebook / phone-OTP / demo mode), so *Test Username* = that
email, *Test Password* = the Facebook account's password, and the instructions must say
«سجّل الدخول عبر فيسبوك». A phone-OTP account cannot serve a reviewer.

⚠️ **This account also carries the Zid demo.** Its page «Jawab24 Test» is linked to the Zid demo
store, so the Salla store gets a **second** page (created on the same Facebook account) — and the
instructions must name that page for the smart-reply test. ⛔ Never re-link «Jawab24 Test».

🔴 **Step 1 of the instructions below is currently FALSE for the reviewer (found 2026-09-03):**
the «المتاجر» page (`/integrations`) is **admin-only** — `frontend/src/pages/integrations.tsx`
redirects any non-admin to `/dashboard` ("while we finish public roll-out"). Making the review
account an admin is not acceptable (admins see every real merchant). **Resolved 2026-09-03 by
rewriting the instructions around `/salla/onboarding`** (auth-only, not admin-gated — verified;
its step 1 shows «تم ربط المتجر» + store name and triggers a product sync, then reports
«تمت مزامنة N منتج»). Lifting the admin gate was considered and **deferred: Zid app 7367 is under
review, and opening `/integrations` would expose Zid's Connect button to every merchant mid-review.**
Revisit after the Zid verdict (together with server-side capabilities gating for Zid/Shopify).
⚠️ The wizard's next step lists every page with a Link button and rebinds silently — the
instructions must tell the reviewer to stop after the sync line and NOT press «ربط صفحة».
Re-verify steps 1–3 **as the review account, in production** before submitting.

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

1. افتح الرابط https://jawab24.com/salla/onboarding ثم اضغط «ابدأ الآن» — ستظهر رسالة
   «تم ربط المتجر!» مع اسم المتجر، ثم تبدأ مزامنة المنتجات تلقائياً حتى تظهر
   «تمت مزامنة N منتج» (المنتجات والأسعار تُقرأ مباشرةً من سلة). وإن ظهرت رسالة
   «فشلت مزامنة المنتجات» فاضغط «إعادة المزامنة»؛ منتجات المتجر مزامَنة مسبقاً على أي حال،
   ويمكنكم متابعة الخطوة التالية.
2. توقّف عند هذه الخطوة ولا تضغط «ربط صفحاتك الاجتماعية» — الصفحة مرتبطة مسبقاً.
3. من القائمة الجانبية افتح «قنوات التواصل»، ثم على بطاقة صفحة
   «<اسم الصفحة المرتبطة بمتجر سلة>» اضغط «اختبار الرد الذكي» واكتب سؤالاً مثل:
   «كم سعر ...؟» — سيأتي الرد مقتبساً اسم المنتج وسعره الحقيقي من كتالوج المتجر.
   (ملاحظة: الحساب يحوي صفحة ثانية مرتبطة بمتجر آخر لأغراض الاختبار؛ يُرجى استخدام
   الصفحة المذكورة أعلاه.)

جواب24 تطبيق يعمل خارج واجهة المتجر: يقرأ منتجات المتجر وأسعارها ليجيب عملاءكم على
واتساب وفيسبوك وإنستغرام. لا يضيف أي عنصر إلى واجهة المتجر ولا يعدّل عليها.

لأي استفسار: support@jawab24.com
```

⭐⭐ **Every label above was WALKED in a running build on 2026-09-04** — the local worktree
stack, Arabic UI, signed in as a merchant-shaped account — because the reviewer follows the
text literally and the previous draft carried three literal mismatches:

| The old text said | What the app actually shows |
|---|---|
| press «ابدأ» | the button reads **«ابدأ الآن»** |
| don't press «ربط صفحة» | the button reads **«ربط صفحاتك الاجتماعية»** |
| «من صفحة «الإعدادات» اختر صفحة …» | the reply tester is on **«قنوات التواصل»** (`/pages`), not «الإعدادات» (`/settings`) — and the nav label for `/pages` is «قنوات التواصل», not the older «إدارة الصفحات» the 2026-07 screenshots still showed |

⛔ A fourth finding, and the reason step 1 now carries an escape hatch: pressing «ابدأ الآن»
renders «تم ربط المتجر!» and then **either** «تمت مزامنة N منتج» **or** a red
«فشلت مزامنة المنتجات. يرجى المحاولة مجدداً.» with an «إعادة المزامنة» button. A sync that
fails on the reviewer's run — an expired token, a Salla rate limit — makes a red error the
first thing they see, while the instructions promise a success line. The sync is not
load-bearing for the test (the catalog is already synced by then), so the text now says so
instead of leaving the reviewer stuck on an error the app expects to recover from.

⚠️ These are frontend copy strings and they drift — «إدارة الصفحات» → «قنوات التواصل» happened
between the last two shoots. Re-walk steps 1–3 **as the review account, in production**, before
pressing Submit.

> This same demo store is what Tier 3 of `docs/SALLA_TEST_PLAN.md` needs — including the
> `track_shipment` gate that has never been run. Create it once, use it for both.
