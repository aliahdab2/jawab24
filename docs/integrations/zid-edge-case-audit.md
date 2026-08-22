# Zid — edge-case audit of the product & order path (2026-08-22)

A read of the Zid parser and the two things it feeds — the `<product_catalog>` prompt block
and the AI agent tools — looking specifically for **absence handling**: what happens when a
field is null, empty, zero, or carries a value the code does not recognise.

This is the class that already cost a review round. The 2026-08-11 install died because
`currency` arrived as an object where the parser expected a string, and the unit suite was
green throughout because every fixture was written from the same docs the parser was.
**Fixtures built from the docs cannot discover that the docs are wrong.** Everything below
is that same shape, found by reading rather than by capture — so each finding is a
*prediction* the first live sync will confirm or kill.

Severity is customer impact, not code smell.

---

## F1 — ✅ CONFIRMED BY LIVE CAPTURE, THEN FIXED (2026-08-22)

**Verdict: confirmed bug.** Zid signals unlimited as a **separate flag** — the third row of
the prediction table below. The flag was not parsed at all, so the product synced as
`totalInventory: 0` and both the catalog block and `check_inventory` called it out of stock.

Captured live from `GET /v1/products/` on dev store 3195980, the stock-bearing keys only:

```json
{"name":"Sony A7S III",  "quantity":null, "is_infinite":true,
 "stocks":[{"available_quantity":null,"is_infinite":true,"location":{"name":"Default - الافتراضي"}}]}
{"name":"نظارة شمسية",    "quantity":0,    "is_infinite":false, "stocks":[]}
{"name":"Running Shoes", "quantity":0,    "is_infinite":false, "stocks":[]}
{"name":"قميص قطني رجالي","quantity":0,    "is_infinite":false, "stocks":[]}
```

Then reproduced end-to-end in production: the first successful sync (2026-08-22, right after
the Store-Id fix deployed) wrote **`Sony A7S III → total_inventory 0`** — the merchant's
unlimited flagship, in the database, marked out of stock.

Two things the capture settled that reading could not:

- **`is_infinite` and "quantity absent" are different cases.** From source they looked like
  one; live, the three tracked products carry `is_infinite: false` **with** `quantity: 0`.
  So the flag is always present and always authoritative — the fix keys on it alone and a
  bare missing quantity keeps mapping to `0`.
- **There is a per-location `stocks[]` array** carrying its own `available_quantity` and
  `is_infinite`. Not used: the top-level pair is authoritative for a single-location store
  and is what the catalog needs. Revisit if a multi-location merchant ever needs per-branch
  availability — the data is there.

**Fixed together with F5** (they had to be — see F5): `is_infinite: true` now maps to
`totalInventory: null` meaning *untracked/unlimited*, and every reader treats `null` as in
stock. `null` is now load-bearing, so `NormalizedProduct.totalInventory`,
`EcommerceProduct.totalInventory` and `chunker.ProductData.totalInventory` are
`number | null`. A bare missing `quantity` with no `is_infinite` flag still maps to `0` — only
the explicit flag earns the null, so the fix asserts nothing the platform did not say.
`InventoryInfo.quantity` became optional and is OMITTED for unlimited: `quantity: 0` beside
`available: true` reads to the model as out of stock.

Regression coverage (all six mutation-checked): `test/services/zid.test.ts` (mapper + agent
tool, both directions), `test/services/kb/chunker.test.ts`,
`test/services/productSummary.determinism.test.ts`.

### The original finding

`backend/src/services/zid.ts:580`

```js
totalInventory: p.quantity ?? 0,
```

`ZidProduct.quantity` is declared `number | null | undefined` (line 459). There is **no
concept of unlimited or untracked stock anywhere in the Zid parser** — grepping
`infinite` / `unlimited` across the file returns nothing. So a product whose quantity Zid
does not report as a number collapses to `0`, and `0` is not neutral downstream:

- **Prompt block** — `services/ecommerce.ts:862`: `totalInventory === 0` → the catalog line
  reads `out of stock`.
- **AI agent tool** — `services/zid.ts:783-784` and `:804-805`:
  ```js
  available: (bestMatch.quantity ?? 0) > 0,
  quantity:  bestMatch.quantity ?? 0,
  ```
  so a direct "هل هذا متوفر؟" is answered **`available: false`**.

**Why this is the worst finding here.** Jawab24's job is to sell. Telling a customer that a
sellable product is unavailable is the one failure mode that costs the merchant money
directly and silently — no error, no flag, no Sentry event, and the merchant never learns
it happened. It is strictly worse than a wrong price, which a customer usually challenges.

**It fires on the very first test.** Dev store 3195980's only product ("Sony A7S III") is
`Unlimited` in the Zid dashboard. Whatever Zid sends for that product is exactly the input
this line mishandles.

**Required capture.** Sync the dev store and record the raw `quantity` for an unlimited
product. Three outcomes:

| Zid sends | Today's result | Verdict |
|---|---|---|
| `quantity: null` | `0` → "out of stock" | ⛔ confirmed bug |
| `quantity` absent | `0` → "out of stock" | ⛔ confirmed bug |
| a separate flag (`is_infinite` and similar) | flag ignored → depends on `quantity` | ⛔ bug, and the flag needs parsing |
| a large sentinel number | "in stock" | ✅ no bug, document the sentinel |

**Fix shape (do not implement before the capture).** `totalInventory` needs a third state,
not a better default. `0` must mean "known to be zero" and `null` must survive as "unknown
or unlimited", with the renderer and the agent tool both treating unknown as *do not assert
either way* rather than as a number to compare against zero.

> This is what shipped, with one refinement the capture forced: `null` is granted **only**
> on an explicit `is_infinite: true`, never on a merely-absent `quantity`. Predicting from
> source, "absent" and "unlimited" looked like the same case; the live payload separated
> them.

---

## F2 — HIGH: an unrecognised product status makes the product sellable

`backend/src/services/zid.ts:495-504`

```js
function mapZidStatus(status?: string): string {
    switch (status) {
        case 'active':
        case 'published':   return 'active';
        case 'inactive':
        case 'draft':       return 'hidden';
        case 'out_of_stock':return 'out_of_stock';
        default:            return status || 'active';   // ← here
    }
}
```

The documented vocabulary is handled. The `default` branch decides what happens to
everything else — and it resolves the unknown to **`active`**, i.e. visible and offered to
customers. The same line also passes an unrecognised string through untranslated, so a
value Zid adds later lands in our status column as its raw Zid spelling and every
downstream `=== 'hidden'` comparison quietly fails to match.

This is F1's mirror image: F1 hides something sellable, F2 sells something that should be
hidden. The dangerous case is an archived, suspended, or region-restricted product being
quoted to a customer as available.

**Required action.** Default to the *safe* state, not the convenient one — an unknown
status should be treated as hidden and reported once to Sentry, the same way the
2026-08-11 fix reports dropped profile fields (`zid-profile-field-drop`). Silence is what
let the currency drift live behind a green suite.

---

## F3 — MEDIUM: the shipping SMS can fail silently, with nothing to alert on

`backend/src/controllers/zid.ts:343-372`, `buildZidOrderEvent`

The status vocabulary itself is **fine** — `.toLowerCase()` then `=== 'indelivery'` matches
both documented spellings (`indelivery` / `inDelivery`), and `delivered` is handled. That
part needs no change.

The exposure is the envelope, which the file marks `[provisional]`:

```js
const data = (body.data ?? body.order ?? body) as ZidOrderPayload;
const phone = zidService.normalizeZidPhone(data.customer?.mobile);
if (!phone) return null;
```

and the status read:

```js
data.order_status?.code ?? (typeof data.status === 'object' ? data.status?.code : data.status) ?? ''
```

If the real payload nests the customer or the status code anywhere these three guesses do
not reach, every path ends in `return null` — **no throw, no log, no metric, no Sentry**.
The observable symptom is that shipping SMS simply never arrive, and nothing anywhere says
why. A silent no-op is the hardest possible failure to notice in production, because the
absence of a message looks identical to "no orders shipped today".

**Required action.** Before fixing any parsing, make the failure loud: when a recognised
event yields no `OrderEvent`, log the reason and count it. Then capture a real
`order.status.update` and pin the envelope. Note that the fallback chain also masks the
distinction between "wrong envelope" and "genuinely no phone on this order" — those need
separate signals.

---

## F4 — MEDIUM: `??` on price does not guard empty string or zero

`backend/src/services/zid.ts:563-565`

```js
const price = p.sale_price ?? p.price;
const priceRange = price !== undefined && price !== null ? `${price} ${p.currency || currency}` : '';
```

`??` falls through on `null` / `undefined` only. Two values pass straight through:

- **`sale_price: ""`** — an empty string is neither null nor undefined, so it wins over the
  real `price`, passes the `!== undefined && !== null` guard, and renders as **`" SAR"`** —
  a currency with no number. Empty-string-for-unset is common in this API family, and it is
  precisely the shape family the `currency` object bug came from.
- **`sale_price: 0`** — renders `0 SAR`, advertising the product as free.

Both then flow into the deterministic price guard, which grounds replies against the prices
the model was shown — so a malformed price does not just display wrong, it becomes the
value the guard treats as authoritative.

**Required action.** Select the price on *validity*, not on nullishness: take `sale_price`
only when it parses to a positive number, else `price`. Capture what an
unset `sale_price` actually looks like on the dev store — put a discounted product and a
non-discounted product side by side in the seed.

---

## F5 — LATENT: the two layers disagree about what `null` inventory means

`services/ecommerce.ts:862-864` renders:

```js
if (p.totalInventory === 0)                                   'out of stock'
else if (p.totalInventory !== null && p.totalInventory <= 5)  'low stock'
else                                                          'in stock'   // ← null lands here
```

So the **renderer** treats null as *in stock*, while the **Zid parser** coerces null to `0`,
i.e. *out of stock*. Two layers, opposite readings of the same absence.

For Zid this branch is currently unreachable — `zid.ts:580` coerces before the renderer ever
sees a null, which is why F1 manifests as "out of stock" rather than "in stock". It is
recorded here because the moment F1 is fixed by letting `null` survive, **this branch
becomes live and silently flips the bug to its opposite**: unknown stock asserted as *in
stock*. Fix F1 and F5 in the same change, or the fix produces a new customer-facing false
claim instead of removing one.

### ✅ Fixed with F1 (2026-08-22) — and F5 was worse than written

The warning was right and understated. Letting `null` survive lit up **five** readers, not
one, and only the renderer at `ecommerce.ts:862` handled it:

| Reader | Pre-fix | What a null did |
|---|---|---|
| `ecommerce.ts:862` catalog renderer | `!== null && <= 5` | ✅ already correct — in stock |
| `ecommerce.ts:958` KB ingestion feed | `?? 0` | ❌ re-coerced → out of stock |
| `ecommerce.ts:1085` `getProducts` (API) | `\|\| 0` | ❌ re-coerced |
| `pages.ts:960` per-page product feed | `?? 0` | ❌ re-coerced |
| `kb/chunker.ts:336` KB availability line | `=== 0`, then `<= 5` | ❌ **`null <= 5` is `true`** → "low stock" |

The chunker is the one that mattered most and was not in the F5 write-up. It is not a
display string — it is the text written into the knowledge base the AI is grounded on, so an
unlimited product would have been described to customers as *running out*. That is F1's
damage restated in the model's own mouth, and it would have survived a fix that only touched
the renderer and the agent tool.

**The general rule this earns:** when a fix makes a previously-impossible value reachable,
the work is not the write site — it is enumerating every reader of that value first. Three
of the four broken readers were `?? 0` / `|| 0` idioms that look like defensive hygiene and
are, in a nullable world, silent assertions. Grep the field name, not the bug.

---

## F6 — NEW, found by the live run: `check_inventory` cannot match an Arabic query against a Latin product name

`backend/src/services/zid.ts` (`checkInventory`)

```js
const bestMatch = products.find(p => localizedText(p.name).toLowerCase().includes(lowerQuery));
```

A plain substring match. Captured against the dev store, 2026-08-22:

```
q="Sony"  -> Sony A7S III   ✅
q="سوني"  -> null           ❌ no match
q="نظارة" -> نظارة شمسية     ✅
```

An Arabic-speaking customer asking about a product whose name the merchant typed in
Latin script gets nothing back from the agent tool. §D of the test plan asks explicitly
for "Arabic queries resolve", so this is a §D failure, not a nice-to-have.

**Customer impact today is LOW, and the reason matters.** The whole catalog is already in
the prompt as the `<product_catalog>` block, so the model answered every probe correctly
without the tool ever matching — including «هل الـ Sony A7S III متوفر؟». The tool is the
fallback for catalogs too large to inline: `buildProductSummary` caps at ~1200 chars and
15 products. So the failure mode is **latent** and arrives with catalog size, which is
exactly when it is hardest to notice.

⛔ **No fix proposed here — measure first.** The obvious reaches (transliteration, fuzzy
matching, a hosted matcher) are all either a hand-maintained linguistic list or a network
hop on the reply path, and both are ruled out by standing project rules. The number that
should drive the decision is: across live e-commerce stores, how many catalogs exceed the
inline cap? If almost none do, the tool's matching is not where the effort belongs.

### ✅ MEASURED 2026-08-22 — the gate above is satisfied, and the answer is «zero»

**The number it asked for: 0.** Every connected store in production is under the cap —
`shopify 6`, `salla 6`, `zid 4` products — and all three are **our own dev stores**. There
is no real merchant catalog in production at all, so `checkInventory`'s matcher is
currently **unreachable**. That is the whole population, not a sample. Deprioritising this
was correct.

**But the threshold is 15, not 1200 chars.** `buildProductSummary` selects `.limit(15)`
(`ecommerce.ts`), so a merchant with 50 products — completely ordinary on Zid — falls
straight through the inline block onto the tool. At launch this becomes the primary path.

**The defect is wider than the F6 headline.** Measured on the four real synced titles with
14 phrasings a customer actually types:

| matcher | correct |
|---|---|
| shipped substring | **4/14** |
| `normalizeArabic` + substring | **4/14** |
| the repo's existing hybrid retrieval over `kb_chunks` product rows | **16/17** |

Three failure classes, only one of which F6 named:
- **Definite article «ال»** — «النظارة», «القميص», «الحذاء» all miss. `"نظارة شمسية"` does
  not contain `"النظارة"`, and «بكم القميص؟» is how customers actually ask.
- **Cross-script** — «سوني»/«كاميرا» vs `Sony A7S III`; «حذاء» vs `Running Shoes`.
- **Morphology** — «نظارات» (plural), «نظاره» (taa marbuta; `normalizeTaaMarbuta` is off).

⛔ **The obvious fix is a measured no-op.** Reaching for the repo's own `foldForMatch`
(`normalizeArabic` + lowercase, already used by the card builder) scores the *same* 4/14 —
it strips diacritics and unifies alef, but does not remove the definite article, does not
fold ى→ي, and cannot bridge scripts. Proposing it before measuring would have shipped
nothing.

⛔ **And Zid's own search cannot rescue it.** `?search=` is documented as "searches by
product name", but live-captured the same day it **ignores the term** (`search=نظارة` and
`search=كاميرا` each returned all 4 products). The server-side swap the seam was left open
for is dead.

**Ruling — ✅ SHIPPED as D-092 (2026-08-22).** Resolution moved to our side:
`backend/src/services/reply/productResolver.ts` decides over the page's own product index
(pg_trgm first, then the reply's reused embedding, `ambiguous` with ≤3 candidates when the
lead is not clear), and the platform is consulted **by id only** (`getProductById` — Zid
`?id__in=`). The three `checkInventory` matchers are gone. Calibrated on this catalog plus
the two demo stores — 65 phrasings × 16 products, read-only on prod
(`docs/integrations/product-resolver-probe-2026-08-22.md`): at the chosen thresholds
**0 wrong resolves** and 2 false not-founds out of 65. ⚠️ Those two are the class this
section predicted: Arabic transliterations of Latin brand names with no Arabic description
(«جالكسي» 0.24, «ايربودز» 0.18) score *below* unrelated queries, so no similarity signal can
separate them — they stay an eval XGAP. A merchant who writes the Arabic name in the
description fixes it for their own catalog. (D-091 had been reserved for this and was taken
by the Google Ads ruling first; the number is D-092 everywhere.)

---

## F7 — ✅ CLOSED 2026-08-22: images added, and closing it live-proved B-3 for free

Originally: 3 of 4 products carried `images: []` (a seeding gap, not a parser defect —
the fourth product's well-formed `images[].image.full_size` confirmed the C4 shape), and
`productCardBuilder` returns null for an imageless product, so product cards were
untestable on three of four fixtures.

Closed by uploading images through the Zid admin (driven via the authenticated real
browser). Two operational facts captured on the way:

- **The dashboard's image upload saves IMMEDIATELY** («تم الاستيراد والحفظ بنجاح») — no
  «حفظ المنتج» click involved, so every upload is a `product.update` the moment it lands.
- **Each save fired a `product.update` webhook that our backend consumed end-to-end**:
  three separate deliveries → Basic-auth verified → sync jobs → all four
  `ecommerce_products` rows carried `media.zid.store` image URLs within ~2 minutes of the
  last upload (progressive `updated_at` stamps 12:40:13 → 12:42:39 UTC). That is test
  plan **§B-3 (incremental webhook), proven live three times over** — it no longer needs
  a separate price-edit run.

## H-1 capture (2026-08-22): a PAID plan cannot be bought while the app is in `Draft`

Attempting to upgrade the dev store from «اختبار» to «الأعمال» (217.35 SAR incl. VAT)
walks: plan card → «ترقية الخطة» → permissions-consent modal → «المتابعة للدفع» → the
checkout page at `dashboard.zid.sa/…/checkout` answers:

> **تعذر بدء عملية الشراء** — هذا التطبيق غير متاح للشراء حاليًا

The free «اختبار» subscription had succeeded the same morning in the same `Draft` state,
so the gate is specifically on **paid checkout**, not on subscribing per se. Consequence
for the test plan: **§H-1's live capture is blocked on review state** — it becomes
possible only once Zid publishes (or possibly re-reviews) the app, which means the FIRST
live paid-subscription envelope will likely be produced by Zid's own reviewer. That is
acceptable: the read path is already live-proven (the reconciler reads and parses the
real «اختبار» subscription every 6h), adoption logic is unit-covered (56 cases), and the
non-entitling-plan fix keeps the reviewer's free-plan subscription from paging anyone.

No app-side defect here; do not chase it. Recorded so nobody burns another session
rediscovering that the checkout error is Zid's Draft gate, not our bug.

---

## What this audit does not cover

Read-only analysis of the product and order path. **Not** examined: the billing envelope
(§H), webhook auth, token refresh, multi-tenant isolation, or the embedded-session flow.
No live capture was taken — every finding above is a prediction from source, and the first
real sync is what promotes it to confirmed or kills it.

Ordering for the capture run: seed the dev store with the §B-0 shapes **first** (an
unlimited-stock item, a zero-stock item, a discounted item, a draft item), because four of
these five findings are only observable with a catalog that contains the awkward cases. The
current single published product with unlimited stock exercises F1 alone.
