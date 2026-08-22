# Zid Integration — 🔧 Rebuilt against the verified contract (pending live validation)

> **Status: rebuilt, NOT yet user-facing.** The integration was rebuilt (2026-08-01)
> against the API contract verified from docs.zid.sa, replacing the original
> implementation that was built on an assumed contract and never round-tripped a real
> store (D-020's bug list is preserved at the bottom of this file for history).
> It is not user-facing: the integrations page keeps Zid's `coming_soon` badge
> (`frontend/src/pages/integrations.tsx`) until a real dev-store round-trip passes — that
> gate is D-020's and it still stands.
>
> ⛔ **CORRECTED 2026-08-11 — this file used to say "`ZID_CLIENT_ID` stays unset in
> production". That was FALSE**, and `ZID_TEST_PLAN.md` had it right all along
> (`ZID_CLIENT_ID`=7192). Verified live: `GET https://jawab24.com/zid/auth` returns **302**
> to `oauth.zid.sa/oauth/authorize?client_id=7192&scope=embedded_apps_tokens_write&…`. So
> the backend OAuth flow is **configured and reachable in production** — only the UI badge
> is dark. Two things follow that the old wording hid: the 6-hourly `ZidBillingReconcile`
> cron **is running** (it is gated on `!!config.zid.clientId`; harmless today because it
> scans zero active Zid stores), and anyone hitting `/zid/auth` reaches Zid's consent
> screen.
> Rebuild ruling: [`DECISIONS.md` D-053](../../DECISIONS.md).
>
> **Shipped since the rebuild:** Embedded Apps direct merchant access (#704/#708,
> D-066/D-067) and the App Market **billing rail** (#711, D-070–D-073), both deployed
> 2026-08-11. ⚠️ **Their validation status is now SPLIT — do not read them as one:**
> - ✅ **Embedded Apps is validated against a live store** (2026-08-22): the App-Market
>   install auto-provisioned an account with no login and rendered the app framed in the
>   Zid dashboard (§L-1…L-5, L-10, L-12 live). The old "no Zid store has ever exercised
>   either one" claim is retired — a store exists (`e3deb6f2-…`) and has synced products
>   and answered real DMs.
> - 🔴 **The billing rail is still inert and unexercised.** No `payment_method='zid'` /
>   `zid_store_id` row exists (count 0 on 2026-08-22). Paid checkout refuses while the app is `Draft`, so the first live
>   subscription envelope will most likely come from Zid's own reviewer.
>
> `ZID_CLIENT_ID` **is** set (7192); an earlier version of this paragraph said "unset",
> contradicting the correction two paragraphs above it. See **What's next** below.
>
> **Exception, deliberate:** as of 2026-08-07 four *public* surfaces already describe Zid
> as a live integration (llms.txt, llms-full.txt, the `SoftwareApplication` schema, and the
> `about` namespace). Owner decision, taken because the Partner application is submitted
> and approval is expected imminently. See the ⚠️ note in the live-validation checklist
> below before changing anything on either side of that disagreement.

## What's next (updated 2026-08-22)

### 🔴 App 7367 is back in `Draft` — withdrawn deliberately on 2026-08-22

**Current status: `Draft`.** Earlier the same day it read `In review` (portal-verified:
created 01/08/2026, type OAuth, 1 install). It was withdrawn on purpose via the
`rollback-icon` on the app row — one click, **no confirmation dialog**, effective
immediately. The Action column then swaps to Delete, and the wizard becomes editable.

**Why it was withdrawn.** Zid's own lifecycle puts *"test your app in a development
store"* at step 4, **before** publishing for review at step 5 — and we had never once
installed 7367 on our dev store. With five predicted parser defects unresolved (see
`zid-edge-case-audit.md`), the odds of passing a review that specifically rejected us for
"full data integration" were poor, and a second rejection costs more than a voluntary
withdrawal. Queue cost looked bounded: the app went `In review` on 08-09 and a reviewer
touched it on 08-11, so the queue is ~2 days, not weeks.

⛔ **The withdrawal did NOT achieve its purpose, and this is the finding that matters.**
The whole point was to unblock installing on our dev store. `EC3` fires **exactly the same
in `Draft` as it did in `In review`** — verified immediately after the withdrawal. So:

> **`EC3` has nothing to do with the app's review state.** Both `In review` and `Draft`
> produce an identical silent bounce to `dashboard.zid.sa/…?error_code=EC3`. Any future
> theory about EC3 must explain why *neither* state is installable. Do not spend the
> queue position on this hypothesis again — it is now falsified, not untested.

➡️ **That challenge is answered in the next section: the axis is SUBSCRIPTION state.**
This block stays because its finding (review state is not the cause) is correct and was
the step that made the real cause findable — but stop here and read on before acting.

The honest post-mortem: a cheap decisive test existed — create a throwaway app, leave it
in `Draft`, and see whether its authorize URL reaches Zid's consent screen. That test
needed no working backend and risked nothing. It was proposed and then skipped in favour
of acting on the hypothesis directly. **Run the cheap falsifying test before spending
something you cannot get back.**

### ✅ EC3 — ACTUALLY SOLVED 2026-08-22: the store must SUBSCRIBE to the app before OAuth; a Draft app IS installable

⛔ **This section was wrong twice before. The install works.** An earlier version of this
same section claimed "an unpublished app has no App Market page, so no store can install
it." That was **falsified by direct evidence**: app 7367, while in `Draft`, was installed
on dev store 3195980 and created a real `ecommerce_stores` row. Do not trust the struck
reasoning below it — trust this.

**The real cause of `EC3`: the store has no subscription record for the app yet.** Zid's
`oauth/authorize` endpoint returns `EC3` when a store hits it for an app it has not first
*subscribed* to. Our `/zid/auth` entry point jumps straight to `authorize`, so starting
there directly always bounces with `EC3` — that is what every earlier test hit.

**The working flow, captured end-to-end (2026-08-22):**

1. Old dashboard → App Market → app page → **الأسعار والخطط** → the free «اختبار» plan →
   **«تفعيل التطبيق»**. This fires `POST /api/v1/app-market/subscription/free` — the
   missing subscription record.
2. A consent modal → **«تفعيل التطبيق»** again, which `window.open`s our
   `https://jawab24.com/zid/auth`.
3. Now that the store is subscribed, `authorize` renders the real Zid consent screen
   («تثبيت Jawab24 على متجرك», full scope list) → **«تثبيت التطبيق»**.
4. Redirect to `/zid/auth/callback?code=…` → our backend exchanges the code, provisions a
   new user/workspace from the store profile (no login — §L-1 PASSED), establishes the
   embedded session, and lands on `dashboard.zid.sa/…/apps/7367/embedded`.

Result rows (production): store `e3deb6f2-…` (`h47p59.zid.store`, "Jawab24 Dev", SAR),
auto-provisioned user `qwhfqfihvm@zam-partner.email`, workspace `5b1c323e-…`.

**What this corrects:**
- `Draft` / `In review` was never the axis. Subscription-state is. A Draft app installs
  fine once subscribed.
- The "chicken-and-egg is total, we can never test before approval" conclusion was
  **wrong**. We can and did test on the dev store.
- Production merchants come through the App Market, which always subscribes first, so they
  never hit `EC3`. Our `/zid/auth` is only safe as a *re-entry* point for an
  already-subscribed store — worth confirming that assumption holds for the reconnect path.

⚠️ **How this went wrong three times:** each fix reasoned from the newest single
observation instead of testing the cheap decisive case. The App Market install was
reachable the whole time (old dashboard, session carries over, no login) and settles it in
minutes. Reach for the decisive test first.

### ✅ SOLVED + PROVEN LIVE 2026-08-22: product sync 401'd for want of a `Store-Id` header

The install succeeded but the first `full_sync` job failed: `zid API HTTP error: 401` on
`GET https://api.zid.sa/v1/products/` (`jobId 355`, retried 3×, all 401). Not a missing
token — the store row, the token pair and `token_expires_at` (2029) were all present and the
embedded session worked. **Root cause: the non-`/managers/` store API requires a
`Store-Id: <numeric merchant id>` header.** Without it the API answers
`401 {"detail":"No such user"}` — a body that describes the *caller*, not the token, which is
why it read as an auth failure for so long. Found by replaying every header arrangement
in-container until arrangement F (the one carrying `Store-Id`) returned 200.

Fixed in #865: `ZidCredentials.storeId` sourced from `platformData.merchantId`, sent by
`zidApiGet` whenever present. `Role: Manager` was removed in the same change — proven a
no-op against the live API.

**Proven end-to-end on 2026-08-22**, minutes after `512853d` deployed: a full sync of dev
store 3195980 returned `{"synced":4,"capped":false}` and all four published products landed
in `ecommerce_products`. **Zid product sync had never once worked, for any store, before
this.** The hidden fifth product was correctly absent (the endpoint omits unpublished
products — see F2), and «نظارة شمسية» landed at `250 SAR`, its sale price, not its 400 SAR
list price (F4).

That same first sync also reproduced **F1** in production: `Sony A7S III → total_inventory 0`
— the merchant's unlimited flagship, stored as out of stock. Fix and live payload capture in
`zid-edge-case-audit.md`.

### ✅ F1 fixed and proven at all five read paths (2026-08-22, prod `0ed9acf`)

The page was moved onto the auto-provisioned Zid account and linked to the store, so the
whole chain could be exercised end to end. Every layer that decides what a customer is
told was checked — a landed write is not a fixed behaviour:

| Layer | Sony A7S III (unlimited) | نظارة شمسية (tracked, 0) |
|---|---|---|
| stored row | `total_inventory = null` | `0` |
| catalog prompt block | `10000 SAR — in stock` | `out of stock` |
| `check_inventory` tool | `available: true`, no quantity | `available: false, quantity: 0` |
| KB chunk (RAG) | `Availability: in stock` | `Availability: out of stock` |
| **generated reply** | «كاميرا Sony A7S III متوفرة حالياً في المخزون» / "Yes, the Sony A7S III is in stock." | «سعرها 250 ريال سعودي، لكنها حالياً غير متوفرة» |

The tracked-empty column is the half that matters most: the fix had to make unlimited read
as available **without** flattening genuinely-empty products into "in stock". That was F5's
warning, and it held.

Two further probes in the same run: «بكم النظارة الشمسية؟» → 250 SAR (the sale price, F4)
with the correct out-of-stock caveat in one sentence, and «عندكم منتج مخفي للاختبار؟» →
«صراحة ما عندي معلومة» at low confidence (F2 — the unpublished product is neither offered
nor hallucinated). Language mirroring was correct in both directions.

Two new findings came out of the same run and are written up in `zid-edge-case-audit.md`:
**F6** (`check_inventory` cannot match an Arabic query against a Latin product name — a §D
failure, latent because the catalog is inlined in the prompt today) and **F7** (three dev-store
products carry no image, which blocks product-card coverage — a seeding gap, not a parser bug).

### ✅ Later the same day: F7 closed, §B-3 proven live, §H-1 captured as Draft-blocked

Images were added to the three imageless products through the Zid admin (real-browser
session). Each dashboard upload saves instantly and fires a `product.update` webhook, and
all three deliveries round-tripped into `ecommerce_products` image URLs within ~2 minutes —
**§B-3 (incremental webhook) is live-proven, three deliveries, no separate price-edit run
needed.** The paid-plan upgrade path was then walked to the checkout page, which refuses
with «تعذر بدء عملية الشراء … غير متاح للشراء حاليًا»: **a paid plan cannot be bought while
the app is in `Draft`** (the free «اختبار» subscribe worked the same morning), so §H-1's
live capture waits on review state and will most likely first be produced by Zid's own
reviewer. Details + exact captures in `zid-edge-case-audit.md`.

### ✅ §C-3 live DMs — the transcript (2026-08-22, 13:53–14:16 UTC)

The FB page "Jawab24 Test" was moved into the Zid-provisioned workspace and linked to the
store, then driven from a real Messenger thread. **Every reply is grounded in the synced Zid
catalog** — prices, stock and the storefront URL all come from `ecommerce_products`:

```
هل كاميرا Sony A7S III متوفرة؟      → نعم، كاميرا Sony A7S III متوفرة حالياً في المخزون.
اديش سعرها                          → سعر كاميرا Sony A7S III هو 10000 ريال سعودي.
في توصيل للدمام                     → حالياً ما عندي معلومات مؤكدة عن التوصيل للدمام.   ← honest gap, not invented
بكم النظارة الشمسية؟                → نظارة شمسية سعرها 250 ريال، لكنها حالياً غير متوفرة في المخزون.  ← sale price, correct
Is the Sony camera in stock?        → Yes, the Sony A7S III camera is in stock right now.   ← EN mirrors the customer
عندكم منتج مخفي للاختبار؟           → ما عندي معلومة عن منتج مخفي للاختبار.   ← the unpublished product stays invisible
شو أسعار الأحذية عندكم؟              → حذاء رياضي سعره 300 ريال، لكنه غير متوفر حالياً في المخزون.
طيب بدي اشتري الكاميرا، كيف أطلبها؟ → storefront link + lead ask
فيك تحطها بالسلة عندي               → honest "I can't add to cart here, use the link"
```

Two things this proves beyond §C-3 itself: the **dialect is mirrored** (Levantine in,
Levantine out) and **F1's unlimited-stock fix holds at the reply path** — Sony carries
`total_inventory = NULL` (`is_infinite`) and is reported available, not out of stock.

**Product cards were added later the same day** (#876 + the review fixes in #878) and
proven on this same thread after deploy: «طيب بدي اشتري الكاميرا، كيف أطلبها؟» now returns
the reply **plus a Sony card carrying the real product image, `10000 SAR · متوفر` and an
Arabic «عرض المنتج» button**; re-sending the identical turn returns the reply with **no
second card** (24h per-customer cooldown, one Redis key, TTL not re-stamped).

> ⚠️ **The first DM of that day got no reply at all**, and the cause was not a bug: a
> newly-provisioned workspace is seeded **auto-reply OFF** (D-025), so the pipeline logged
> `skipReason "Messages auto-reply disabled"`. It cost ~20 minutes of log-chasing. **When a
> new or test account does not reply, check the workspace seed before the logs.** Fixed by
> enabling both toggles in the embedded app's own Settings — which incidentally proved §L
> (the embedded surface can write settings, authenticated, with no login).

### EC3 — hypotheses tested along the way (2026-08-22)

Read from the app wizard while 7367 was editable in `Draft`. **Two hypotheses are dead;
do not re-test them.**

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| 1 | The app being `In review` locks it against installs | ❌ **FALSIFIED** | `EC3` is byte-identical in `Draft` and `In review`, tested minutes apart |
| 2 | `redirect_uri` mismatch between our authorize call and the app's configured Callback URL | ❌ **FALSIFIED** | They match **exactly** — see the config below |
| 3 | The store has no subscription record because `/zid/auth` skips the App Market subscribe step | ✅ **CONFIRMED — this is the cause.** Subscribing first (App Market free plan) makes `authorize` succeed; starting at `/zid/auth` directly returns `EC3` |
| 4 | An unpublished app cannot be installed by any store | ❌ **FALSIFIED** — a `Draft` app WAS installed on the dev store via the App Market subscribe→activate flow. See the corrected solved section above |

**App 7367 URL configuration, verified correct — stop re-checking it:**

| Field | Value |
|---|---|
| Application Website | `https://jawab24.com` |
| Application URL (embedded) | `https://jawab24.com/zid/embedded` |
| Redirection URL | `https://jawab24.com/zid/auth` |
| Callback URL | `https://jawab24.com/zid/auth/callback` |

Our authorize call sends
`redirect_uri=https%3A%2F%2Fjawab24.com%2Fzid%2Fauth%2Fcallback` — identical to the
Callback URL above. Client ID `7192` also matches.

⚠️ **`EC3` is undocumented.** It appears nowhere in `docs.zid.sa` or the partner help
centre, and Zid returns it as a bare query parameter on a silent bounce to the store
dashboard — no message, no page, nothing a merchant could act on. Any future explanation
has to come from Zid support or from observing a *successful* install.

🔑 **The one asymmetry worth chasing:** Zid's reviewer install on 2026-08-11 **reached our
code** (it died on our `PostgresError`, not on EC3), against their own store "Test". Ours
bounces at EC3 against dev store 3195980. Whatever differs between those two installs is
the answer — and it is not the app's status or its URLs.

⚠️ **Security note:** the General Settings step displays the app's **client secret in
plain text**. Treat that screen as sensitive; do not screen-share or screenshot it, and
rotate the secret if it has been exposed — production's `ZID_CLIENT_SECRET` must be
updated in the same change or the whole Zid path breaks.

How it got here, from the Intercom thread with Zid partner support:

| Date | What happened |
|------|---------------|
| 2026-08-09 | Zid (Mohammed): the app was sitting in **`Draft`** and had to be flipped to `In review` before any technical review could run. Flipped the same day. |
| 2026-08-11 | Zid's reviewer attempted an install (store "Test") and hit an error on our side. Fixed, deployed, and a retest requested. |
| 2026-08-12 | Zid: "سيتم اختبار التطبيق مرة أخرى في أقرب وقت" (will retest shortly). |
| 2026-08-18 | Follow-up asking whether the retest ran — **still unread** as of 2026-08-22. |

⛔ **The earlier "REJECTED / `EC3`" framing in this section was stale**, and it mattered:
it described the next action as ours (resubmit) when the app had already been in review
since 08-09 and the next action was Zid's. Verify the status in the portal before
planning around it — that is one page load.

⛔ Do **not** re-read this as "waiting on the partnership agreement". The agreement is an
**exit** condition (technical review passes → agreement countersigned), never an entry
one. That misreading idled this work for eight days (2026-08-01 → 08-09).

⚠️ **Because the app is in review, a Zid reviewer can install it at any moment.** The
production OAuth path must stay working and `/zid/embedded` must keep serving — the
2026-08-11 review round was lost to an install-time error, and a second avoidable failure
costs another round trip. Do not deploy anything that touches the Zid path without
re-running the readiness check below.

### Readiness check — run this before asking Zid to retest

Verified **2026-08-22**, all green. Each line is a command, not a belief:

| # | Check | Command | Result 2026-08-22 |
|---|-------|---------|-------------------|
| R-1 | OAuth entry redirects to Zid with the right app | `curl -sI https://jawab24.com/zid/auth` | ✅ `302` → `oauth.zid.sa/oauth/authorize?client_id=7192&scope=embedded_apps_tokens_write&redirect_uri=https%3A%2F%2Fjawab24.com%2Fzid%2Fauth%2Fcallback&…` with a `state` |
| R-2 | Embedded URL serves (a 404 fails the review on its own) | `curl -so /dev/null -w '%{http_code}' https://jawab24.com/zid/embedded` | ✅ `200` |
| R-3 | **No sign-in prompt** — rejection bullet 1. Load `/zid/embedded` with NO session, in a clean browser profile | render it, do not grep the HTML | ✅ renders «تعذّر فتح التطبيق» + "reopen from the Zid dashboard". ⚠️ The bundled i18n makes `login` / «تسجيل الدخول» appear in the HTML source — grepping the markup gives a FALSE positive here; you must render it. |
| R-4 | No orphan reviewer account blocking the retry | `SELECT … FROM users WHERE email = 'appmarket@zid.sa'` | ✅ 0 rows — the 08-11 orphan (user `c754f159…`, workspace `2b91491a…`) was cleaned up; `ecommerce_stores WHERE platform='zid'` is also 0, and there is no Zid row in `pending_ecommerce_installs` |
| R-5 | Production is running the commit with the 08-11 parser fix | `curl -s https://jawab24.com/api/version` | ✅ `b625c5e` deployed 2026-08-20 (current `main`, env `blue`) |

**R-4 is the one that silently re-breaks the review.** `provisionEcommerceMerchantUser`
refuses to auto-provision onto an existing email (account-takeover guard), so a leftover
`appmarket@zid.sa` makes the next install fall back to claim-after-login and lands the
reviewer on `/login?zid_pending=true` — *verbatim* the "sign-in prompt" defect that caused
the 08-10 rejection. If an install fails again, re-check R-4 before anything else, and use
`~/.claude/plans/zid-orphan-cleanup-2026-08-11.sql` (guarded — `DELETE 0` means STOP).

✅ **`ZID_CLIENT_SECRET` is proven, and the "unverified" note elsewhere is stale.** The
08-11 reviewer install got *past* the token exchange and *past* an authenticated call to
`/v1/managers/account/profile` — it failed afterwards, on the Postgres write. A wrong
secret could not have reached that point. §A-1 no longer has anything to prove.

**What is still genuinely unproven** is rejection bullet 2, "full data integration":
products, orders, webhooks and the billing envelope have never round-tripped a live store.
Those parsers were built from docs.zid.sa and validated against fixtures built from the
same docs — which is exactly the blind spot that let the `currency`-object bug through a
green suite. Expect the next reviewer install to surface at least one more shape
mismatch, and read the Sentry `zid-profile-field-drop` fingerprint after it runs.

### The unblock path, in order

| # | Step | Depends on | Owner |
|---|------|-----------|-------|
| 1 | ✅ **DONE 2026-08-11.** Deployed to production: Embedded Apps (#704/#708) and the billing rail (#711). This had to go first — step 2 points Zid's reviewer at `https://jawab24.com/zid/embedded`, and a 404 there would fail the resubmission for a second, avoidable reason. That URL now serves. | — | us |
| 2 | **Portal changes.** ✅ Mostly DONE 2026-08-11: the **Embedded App** toggle was already on and the **Application URL** already read `https://jawab24.com/zid/embedded` (verified, and the URL now serves 200). The nine `app.market.subscription.*` webhooks were **newly subscribed** — without them the billing rail would have depended entirely on the 6h reconciler, making a paying merchant wait up to six hours for activation. ✅ **Plan 3956 «اختبار» CANNOT be deleted — it is a Zid SYSTEM plan.** `DELETE /v1/market/delete/7367/plan` answers `400 {"code":"cannot_delete_system_plan"}` (captured 2026-08-11). The dashboard renders a delete icon for it anyway, so the UI and the API disagree; there is no permission or workaround that changes this. Step 2 is therefore COMPLETE — nothing here is owed. | 1 deployed | us |
| 3 | ✅ **DONE 2026-08-09.** App flipped `Draft` → `In review`, answering the rejection: *"Direct merchant access (no sign-in prompt)"* → the auto-provision + embedded session (D-066/D-067); *"Full data integration with Zid"* → the App Market billing rail (D-070). The 2026-08-11 install error found by Zid's reviewer was fixed and deployed the same day, and a retest was requested. | 2 | us |
| 4 | **Zid completes the technical review and approves** → install on dev store 3195980. ⏳ **Where we are as of 2026-08-22.** Zid said on 08-12 it would retest shortly; the 08-18 follow-up is still unread. If this stays quiet, chase it in the Intercom thread — nothing on our side unblocks it. | 3 | ⏳ Zid |
| 5 | **Run `docs/testing/ZID_TEST_PLAN.md` A→I, capturing every response.** This is the D-020 gate. §H (billing) is the newest and least-evidenced section — see "what the first capture must collapse" below. | 4 | us |
| 6 | **Finalize the `[provisional]` parsers from the captures**, then flip the badge and the status tables (step 6 of the checklist below) and append the D-NNN that closes D-020. | 5 | us |

### Owed in parallel — NOT blocked by the review

These can all be done today; none of them needs Zid to approve anything.

**Closed by #720** (both items previously listed here):
- **The frontend now consumes `subscription.marketplaceBilling`.** `frontend/src/lib/marketplaceBilling.ts` is the single client-side home, and `useSelectPlan`, `pricing.tsx`, `pricing/scale.tsx` and `BuyTopUpCTA` all read the field the backend's guard computes — so the UI and the API can no longer disagree about who is billed where. A Zid merchant gets a named destination, or an explanatory notice while `ZID_APP_MARKET_URL` is unset, instead of a generic error toast. This was the item deadlined *before the listing goes live*.
- **#711's `sallaBilled` claim is corrected in D-074.** #711 stated Salla's answer was "byte-for-byte unchanged" at the `getUsageSummary` choke point; it was not. `DECISIONS.md` is append-only, so the correction is a new entry rather than an edit to D-073.

| Item | Why it matters | Deadline |
|------|----------------|----------|
| **`ZID_APP_MARKET_URL`** | Ships unset on purpose — the URL shape is undocumented and unobserved, and a guessed link would send payers to a 404. Unset means "suppress Stripe, show no link", never "do not suppress". Set it from the first real install. | Step 5 capture |
| **`ZID_APP_ID`: 7367 or 7192?** | Unresolved. It is the webhook `original_id` **and** the `app_id` on the subscription read, so getting it wrong breaks webhook registration and billing verification together. | Step 5 capture |
| **D-072 pricing is PROVISIONAL** | 189/379 SAR pending withholding-tax confirmation. Editable in the Partner Dashboard until the app publishes — after that it is not. **Captured 2026-08-11:** the dashboard's price field is **excluding VAT**, and it shows the merchant-facing total beside it — 189 → **217.35 SAR** (exactly +15%). So VAT is added by Zid on top of what we enter; only the commission and WHT are still unquantified in the gross-up. The trial stays **14 days** (owner, 2026-08-11 — the 7-day figure is D-067, the jawab24.com signup trial, a different thing). | Before step 6 |

### What the first live capture must collapse

The billing envelope is the least-evidenced thing on this page: `GET /v1/market/app/subscription`
has never been called against a real store, so the parser tolerates four nestings and
several field spellings. **Do not treat a green capture as "confirmed" and move on — use
it to DELETE tolerances.** The three questions worth the most:

1. **What does a genuine "no subscription" response look like?** Only an explicit empty
   container (`{"data": null}`) is read as a positive "nobody is paying" and may pause a
   merchant's mirror. Everything else unparseable is `unreadable` — writes nothing, raises
   Sentry. Getting this backwards revokes a paying merchant, which is why it fails loud.
2. **The real value set of `subscription_status`.** Anything outside the recognised sets
   in `services/zidBilling.ts` resolves to `unknown_status` and writes nothing. The event
   names below narrow the guess but do NOT settle it — see the ⚠️ under them.
3. ✅ **RESOLVED 2026-08-11 — the exact `app.market.*` event names**, read off the Partner
   Dashboard's Webhook Subscriptions dropdown. See "App lifecycle & subscription events"
   below. Prefix matching is kept anyway: all nine subscription events match
   `app.market.subscription`, and a tenth that Zid adds later would still trigger a verify
   rather than be silently dropped.

Full detail in "`[provisional]` parsers" below and `ZID_TEST_PLAN.md` §H (H-1…H-11).

## Verified API contract (docs.zid.sa, fetched 2026-08-01)

### OAuth
- Authorize: `https://oauth.zid.sa/oauth/authorize` · Token: `https://oauth.zid.sa/oauth/token`
- Grants: `authorization_code`, `refresh_token`. Token bodies are form-urlencoded (RFC 6749).
- **The token response carries TWO credentials**, both ~1-year lifetime:
  - `access_token` → sent as the **`X-Manager-Token`** header
  - `Authorization` → sent as the **`Authorization: Bearer`** header
  - plus `refresh_token`, `expires_in`.
- `exchangeCodeForToken` throws if the `Authorization` field is missing (fail fast — without
  it every API call 401s with no obvious cause).

### Scopes — the authorize URL takes ONE, the dashboard grants the rest
`config.zid.scopes` sends **`embedded_apps_tokens_write`** and nothing else. This is the
only scope Zid documents for the `scope` parameter (docs.zid.sa/embedded-apps, Step 1);
data permissions come from the app's scope matrix in the Partner Dashboard (Account R,
Account Identity R, Store Core Details R, Orders R, Products R, Webhooks RW), not from
this string. Until 2026-08-11 the value was four **invented** names
(`offline_access products.read orders.read webhooks.manage`) that appear nowhere in Zid's
docs or dashboard — part of the app-7367 rejection for "OAuth does not meet our required
standards". Do not "restore" them.

### Embedded Apps — direct merchant access (docs.zid.sa/embedded-apps)
Zid requires the merchant to reach a working app with **no sign-in prompt**, both right
after install and whenever they open it from their dashboard. Flow:

1. Install (platform-initiated, no Jawab24 session) → `authCallback` exchanges the code,
   reads the store profile, and **auto-provisions a merchant account** from the
   store email (`authService.provisionEcommerceMerchantUser`).
2. `postInstall` generates a UUID v4, registers it via
   `POST /v1/managers/embedded-apps-token`, and stores **only its SHA-256** in
   `ecommerce_stores.embedded_token_hash` (migration `0159`).
3. The merchant is redirected to
   `https://dashboard.zid.sa/{lang}/stores/{store_id}/apps/{app_id}/embedded` — Zid's
   Hermes resolves the real store/language from the merchant's own session, so the
   `store_id` and `lang` we send are placeholders.
4. Zid frames our **Application URL** `https://jawab24.com/zid/embedded` with
   `?token=<uuid>&language=<ar|en>`. The page strips the UUID from the URL immediately,
   then trades it at `POST /zid/embedded/session` (handled by the platform-agnostic
   `backend/src/services/embeddedSession.ts`) for a **workspace-scoped, admin-stripped**
   short-lived access token.
5. Session transport inside the frame is a **Bearer token in `sessionStorage`**, not
   cookies: `SameSite=strict` cookies are never sent in a third-party frame, so
   `/auth/refresh` cannot work there. `lib/embeddedSession.ts` re-mints from the UUID,
   and falls back to an in-memory store when a partitioned frame blocks `sessionStorage`
   (never a cookie session, which would 401 → `/login` inside the iframe).

**Security properties, all deliberate:**
- **The minted session is SCOPED** (`TokenScope`): pinned to the store's workspace and
  stripped of admin. Authenticating as the owner is unavoidable (the store is theirs),
  but the session cannot reach their other workspaces/pages/stores/billing or the admin
  console. Enforced by `resolveWorkspace` (`WORKSPACE_SCOPE_DENIED`) and `requireAdmin`
  in both `middleware/auth.ts` and `middleware/admin.ts`. This also bounds the
  reinstall-for-owner path — a store collaborator who reinstalls gets a scoped session,
  not the owner's account.
- The UUID is a merchant credential (it opens a session). Only the digest is stored;
  a new UUID is minted on every (re)install; it **idle-expires** after 30 days
  (`embedded_token_last_used_at`, migration `0160`); uninstall AND merchant-side
  disconnect revoke it at Zid and NULL the hash — revocation runs *before*
  `deactivateStore`/`disconnectStore`, which blank the tokens the Zid call needs, and
  `embeddedTokenHash` is also cleared whenever a store goes inactive (defense in depth).
- **The credential never persists in the clear:** stripped from the URL on arrival,
  nginx logs the path only for `/zid/embedded` (`log_format main_noquery`), and Sentry
  `beforeSend` redacts `?token=`/`?embeddedToken=`/`?code=`.
- Auto-provisioning **refuses** when the store email already belongs to a Jawab24
  account (case-insensitively) and falls back to claim-after-login. A store email is
  attacker-settable, so a match is not proof of identity. When it does provision, it
  **guarantees a workspace** (bypassing the pending-invite skip — the merchant has no
  login to accept an invite later) or refuses rather than return a half-built account.
- Only a short-lived access token is ever minted for the frame — never a long-lived one.
- `nginx.conf` drops `X-Frame-Options` (no allowlist form) in favour of CSP
  `frame-ancestors 'self' dashboard.zid.sa web.zid.sa`. The `*.zid.dev` sandbox is
  **not** allowed in the production config. **Shared infrastructure — every response
  carries it.** `npm run check:nginx-routing` asserts both the routing and these headers.
- **The break-out is SCOPE-PRESERVING (2026-08-11).** facebook.com refuses framing
  (`X-Frame-Options: DENY`), so connecting a page must leave the iframe — that part is
  unavoidable. What was broken is where it landed: an embedded session is a Bearer token
  in the frame's `sessionStorage`, never a cookie, so `window.open('/pages')` opened a
  tab with **no session** — and an auto-provisioned Zid merchant has no password, no
  linked Facebook account and no phone, so the login page was a **dead end**. That is
  the same "sign-in prompt" defect app 7367 was rejected for, one screen later. The tab
  now mints a single-use handoff code first and lands on `/auth/sync`, arriving signed
  in. Ruling **D-067**.
- 🔴 **Escalation closed at the same seam.** `POST /auth/browser-handoff` stored only the
  userId, and the exchange minted `generateToken(user)` — **unscoped, `isAdmin` intact,
  plus a refresh cookie**. A restricted embedded session (or anyone holding the iframe
  UUID) could therefore trade its workspace-pinned, admin-stripped token for a full one,
  defeating `TokenScope` entirely. The code now carries the scope, the exchange re-mints
  it scoped, and a scoped handoff gets **no refresh cookie** (a rotation through
  `/auth/refresh` would launder the restriction away one step later). The WhatsApp
  app-start bridge refuses scoped codes outright — it signs in a full session and hands
  over workspace-level credential material.

### Dual-credential storage
The second credential is AES-256-GCM encrypted into new nullable columns
`authorization_token` / `authorization_token_iv` on **both** `ecommerce_stores` and
`pending_ecommerce_installs` (migration `0146`). It flows through the whole pipeline:
code exchange → `createStore`/`createPendingInstall` → claim (`finalizeClaim` decrypts and
passes it in the webhook callback ctx) → refresh (`ecommerceTokenRefresh.ts` parses a
rotated `Authorization` field if the refresh response carries one; the stored pair is only
overwritten when supplied). `resolveStoreCredentialPair` returns both decrypted tokens.

### Endpoints (base `https://api.zid.sa`)
| Purpose | Endpoint | Notes |
|---|---|---|
| Store profile | `GET /v1/managers/account/profile` | ✅ **live-confirmed 2026-08-11** — see below. `storeDomain` = hostname of the store `url` (fallback: store id); `merchantId` = `String(store.id)`; **`currency` is an OBJECT**, not a string |
| Orders | `GET /v1/managers/store/orders?page=&per_page=&payload_type=default` | `per_page` ≤ 100; `payload_type=default` includes items; envelope `{orders: [...]}` |
| Products | `GET /v1/products/?page_size=&page=` | NOT under `/managers`. Requires the dual headers **plus `Store-Id: <numeric merchantId>`** — without it the API answers `401 {"detail":"No such user"}`, a body that describes the *caller*, not the token, which is why it read as an auth failure for so long (#865). ⛔ `Role: Manager` is **not** required — it was removed in the same change and proven a no-op against the live API |
| Webhook subscribe | `POST /v1/managers/webhooks` | body `{event, target_url, original_id, username?, password?}` |

- `customer.mobile` in orders is a **full international number WITHOUT `+`**
  (e.g. `"966591555966"`) — `normalizeZidPhone` (exported from `services/zid.ts`) prepends
  `+`. This differs from Salla's split `mobile` + `mobile_code`, so the helper stays
  Zid-local (see `composeSallaPhone` docs in `services/salla.ts`).
- Order status codes: `new`, `preparing`, `ready`, `indelivery`, `delivered`, `canceled`
  (webhook conditions docs also show `inDelivery`/`cancelled` — mapping is case-insensitive
  and tolerates both spellings). `indelivery` → shipped, `delivered` → delivered.

### Webhooks
- Registered per-store via `POST /v1/managers/webhooks` with `original_id` = the Partner
  **Application ID** (`ZID_APP_ID` env — distinct from the OAuth client id).
- **Deliveries are authenticated with HTTP Basic auth** — the `username`/`password` set at
  subscription time come back as `Authorization: Basic base64(user:pass)` on every
  delivery. There is **no HMAC signature header** (the old `x-zid-signature` never
  existed). We register with username `jawab24` (code constant `ZID_WEBHOOK_BASIC_USER`)
  and password `ZID_WEBHOOK_SECRET`; verification is timing-safe
  (`utils/basicAuthVerify.ts`).
- Registered events (`ZID_WEBHOOK_EVENTS`, mirrored in `integrations/zid.ts`
  `ZID_WEBHOOK_TOPICS`, drift-tested): `product.create`, `product.update`,
  `product.publish`, `product.delete`, `order.create`, `order.status.update`.
  Deliberately excluded: `order.payment_status.update` (no consumer),
  `abandoned_cart.created/.completed` (phase-2), `customer.*`/`category.*`.
- **App lifecycle** (`app.market.application.install` / `app.market.application.uninstall`)
  is configured in the Zid **Partner Dashboard**, not via the API — the handler treats
  `app.market.application.uninstall` as the uninstall signal (→ `deactivateStore`). Zid
  invalidates our tokens at uninstall.

#### App lifecycle & subscription events — the dashboard's full list (captured 2026-08-11)

Read verbatim off **Webhook Management → Webhook Subscriptions** on app 7367. These are
configured in the Partner Dashboard, NOT through `/v1/managers/webhooks`, so they never
appear in `ZID_WEBHOOK_EVENTS` (`webhookTopicDrift` asserts that separation).

**Subscription events — all nine subscribed 2026-08-11**, each to
`https://jawab24.com/zid/webhooks?e=<event>`:

| Event | Why it is subscribed |
|---|---|
| `app.market.subscription.active` | the activation trigger |
| `app.market.subscription.warning` | ⚠️ see below |
| `app.market.subscription.suspended` | entitlement should end |
| `app.market.subscription.expired` | entitlement should end |
| `app.market.subscription.renew` | period advance |
| `app.market.subscription.upgrade` | plan change |
| `app.market.subscription.refunded` | ⚠️ see below |
| `app.market.subscription.usage_based.payment_success` | not our model (fixed monthly); subscribed for completeness — it costs one wasted verify |
| `app.market.subscription.usage_based.payment_failure` | same |

**Also offered, deliberately NOT subscribed:** `app.market.application.install` (our
install signal is the OAuth callback), `app.market.application.rated`,
`app.market.application.authorized`, `app.market.private.plan.request`.
`app.market.application.uninstall` was already subscribed and is untouched.

⚠️ **These are EVENT names, not `subscription_status` VALUES — do not copy them into
`mapZidStatus` as if they were.** Nothing is read out of a delivery (D-070: webhooks are
triggers, the API is the authority). They are the strongest hint we have about the status
vocabulary, and two of them name states `mapZidStatus` does not recognise:

- **`warning`** — ambiguous in the direction that matters. If it means "entitled but
  payment is failing" the local equivalent is `past_due`; if it means "about to stop" it is
  closer to inactive. Guessing wrong either strands a paying merchant or extends a dead
  one. Currently → `unknown_status`, writes nothing, raises Sentry. That is the correct
  conservative default until a real payload names the value.
- **`refunded`** — probably means entitlement should end, but currently → `unknown_status`,
  so a refunded merchant KEEPS entitlement until a human intervenes. Fails loud, which is
  the safe direction, but it is a revenue leak worth closing once confirmed.

⚠️ **There is NO trial event in the list**, although both our plans carry a 14-day trial.
So how a trial subscription reports its status is an open question — if it arrives as
`active` rather than a trial spelling, the mirror lands as `active` with `trialEndsAt`
null and a trialing merchant reads as a full payer. Capture this at step 5.
- Because the delivery envelope is not yet capture-confirmed, each subscription's
  `target_url` embeds routing hints: `https://<host>/zid/webhooks?e=<event>&sid=<storeId>`.
  The handler resolves store/event from the query string first, then falls back to body
  fields (`store_id`/`store_uuid`/`data.store_id` via `resolveStoreByDomainOrMerchant`).

## Where the code is

| Layer | File |
|-------|------|
| Integration adapter | `backend/src/integrations/zid.ts` |
| Service (OAuth, Merchant API, sync, webhooks) | `backend/src/services/zid.ts` |
| Controller (webhook handler, `buildZidOrderEvent`) | `backend/src/controllers/zid.ts` |
| Routes (shared factory) | `backend/src/routes/zid.ts` |
| Basic-auth verification | `backend/src/utils/basicAuthVerify.ts` |
| **Billing rail (D-070)** | `backend/src/services/zidBilling.ts`, `backend/src/config/zidBilling.ts` |
| **Marketplace guard (all rails, D-073)** | `backend/src/services/marketplaceBilling.ts` |
| Config | `backend/src/config/index.ts` (`config.zid`; enabled when `ZID_CLIENT_ID` set) |
| Migration (dual-token columns) | `backend/migrations/0146_left_prodigy.sql` |
| Migration (billing mirror key) | `backend/migrations/0161_tense_garia.sql` (`subscriptions.zid_store_id`) |
| **Edge routing** | `nginx/nginx.conf` — `location /zid/` → backend, `location = /zid/onboarding` → frontend |
| Tests | `backend/test/{services,controllers,routes,integrations}/zid.test.ts`, `backend/test/utils/basicAuthVerify.test.ts` |
| Routing gate | `scripts/check-nginx-routing.sh` (`npm run check:nginx-routing`, pre-deploy step 0.98) |

### ⚠️ The backend routes are not reachable without the nginx block

The Zid Partner app is configured with **un-prefixed** URLs (`https://jawab24.com/zid/auth`,
`/zid/auth/callback`, `/zid/webhooks`) — not `/api/...`. In production nginx is what maps
those to the backend; the `/api/` prefix exists only because nginx adds it. `services/zid.ts`
also builds its own `redirect_uri` as `https://<ZID_HOST_NAME>/zid/auth/callback`, so the
OAuth round-trip depends on the same block.

**Incident 2026-08-10:** `nginx/nginx.conf` had **no `/zid/` block at all** — the string
"zid" did not appear in the file. Every Zid-configured URL fell through to the frontend
catch-all and returned 404, so the first real install (a test store, while app 7367 was In
Review) dead-ended before reaching the backend. `ZID_CLIENT_ID` was correctly set; the
credentials were never the problem. Two properties made it invisible:

- `nginx -t` passes on the broken config — it is syntactically perfect.
- `/zid/onboarding` returned 200 *by accident* of the catch-all, so the prefix looked wired.

Ordering matters: exact-match blocks (`location = /zid/onboarding`) must sit **above** the
prefix block (`location /zid/`), or the prefix swallows the Next.js page. The same defect
was live for Salla's `/salla/connected` (its Easy-Mode App URL) and is fixed in the same
change. `npm run check:nginx-routing` now asserts every platform URL's upstream.

Env vars: `ZID_CLIENT_ID`, `ZID_CLIENT_SECRET`, `ZID_APP_ID` (webhook `original_id`;
prod-required with the client id), `ZID_HOST_NAME`, `ZID_WEBHOOK_SECRET` (Basic-auth
password, min 16 chars; prod-required with the client id). The old `ZID_SCOPES` /
`SALLA_SCOPES` env vars were dead (declared, never read) and have been removed — scope
strings are hardcoded in `config/index.ts` and the Zid ones are provisional until the
Partner app is created.

## First live capture — 2026-08-11 (and the install it broke)

The Zid App Market reviewer installed the app against production at **15:19 UTC**. It is
the first time any Zid endpoint has been exercised by a real store, and it **failed**:

```
Zid auth callback failed — PostgresError 22001 (value too long for type character varying)
```

**Root cause.** `/v1/managers/account/profile` returns `currency` as an OBJECT:

```json
{ "id": 4, "name": "ريال سعودي", "code": "SAR", "symbol": " ر.س ",
  "country": { "id": 184, "code": "SA", "country_code": "SAU", "…": "…" } }
```

`fetchStoreInfo` declared `currency?: string` and passed the object straight into
`ecommerce_stores.store_currency` (`varchar(10)`). Postgres rejected the row, the callback
threw, and the install aborted **after** the merchant account had already been
provisioned — leaving an orphan user, no store, and a merchant who saw an error.

**Why the unit suite was green the whole time.** Every fixture was written from
docs.zid.sa, and every one of them sent `currency` as a string. A parser built from docs
and tested against fixtures built from the same docs cannot discover that the docs are
wrong. This is the concrete cost of shipping `[provisional]` parsers without a live
round-trip (D-020).

**Fixed in two layers** — see `services/zid.ts#fetchStoreInfo` and
`services/ecommerce.ts#fitStoreScalars`:

1. **Boundary.** The profile response is now parsed with a Zod schema. `currency` accepts
   the object (reading `.code`) or a bare string. `id` is the only required field —
   identity is a hard failure; every descriptive field degrades to `undefined` via
   `.catch()` rather than failing the parse and taking the install with it. **Each drop is
   reported to Sentry** (fingerprint `zid-profile-field-drop`, shape only — never the
   value, which carries merchant PII): the drop is the correct handling, but a silent drop
   is how this drift stayed invisible behind a green suite. Absence (`null`, missing,
   empty string) is not drift and is not reported.
2. **Storage.** `fitStoreScalars` coerces the four descriptive columns at the single
   choke point all three rails write through (`createStore` insert **and** conflict
   branches, plus `applySyncedStoreInfo`, which the 6-hourly sync uses). Widths are read
   from the Drizzle schema, so a future migration cannot leave a stale hardcoded limit.
   Unreadable shapes are dropped and reported to Sentry as a warning; they never abort a
   write and never overwrite a good stored value.

The same review hardened the two writes UPSTREAM of the store on the same callback:
`provisionEcommerceMerchantUser` clamps the platform-sourced display name before it
feeds `users.name` and `workspaces.name` (both varchar(255)), and REFUSES an email
longer than its column — identity is refused, never truncated, because a truncated
email is a different identity. `createPendingInstall` clamps its display `storeName`
(`merchant_id` is claim-matching identity and stays unclamped, fail-loud).

**Replay suite:** `test/integration/zidInstallCallback.test.ts` re-runs the reviewer's
exact install — real routes, real Postgres, the captured wire payloads — and also pins
the retry-with-orphan path (→ `/login?zid_pending=true`, the reason the orphan cleanup
SQL must run before Zid re-tests).

**Confirmed facts from this capture** (previously all assumptions):

| Fact | Value |
|---|---|
| Profile nesting | `user.store` |
| `store.currency` | **object** with `code` |
| `store.url` | `https://a0xxorvfi5.zid.store` → `storeDomain` = `a0xxorvfi5.zid.store` |
| `store.title` / `store.email` | plain strings (`Test`, `appmarket@zid.sa`) |
| Token lifetime | `token_expires_at` ≈ **3 years** (2029-08-11) |
| Reviewer identity | store `a0xxorvfi5.zid.store`, `merchantId` 130216 |

⚠️ **The callback was made by a SERVER-side client** (`GuzzleHttp/7` from `54.77.8.197`),
not a browser — both `/zid/auth` and `/zid/auth/callback`. If Zid drives the install
server-side, the redirect `postInstall` returns is consumed by Zid's server rather than
the merchant's browser, which would matter for the "direct merchant access" requirement
that caused the 2026-08-10 rejection. **Not yet confirmed** — a single capture cannot
distinguish an automated pre-check from the real install path. Verify before resubmitting.

## `[provisional]` parsers — finalize from live captures

Everything below compiles, is unit-tested against plausible fixtures, and is written
shape-tolerantly — but the exact field shapes are **unconfirmed** until a real dev store
exists. Tests covering them carry `[provisional — pending Zid live captures]` in their
describe titles (grep for it).

- Webhook delivery envelope (does it carry `event`? a store id? Basic-auth header on
  Partner-Dashboard lifecycle events?) — mitigated by the `target_url` query hints.
- Products list envelope (`results` vs `store_products` — both tolerated) + multilingual
  `name`/`description` objects (`{ar, en}` — Arabic preferred).
- ~~Profile envelope nesting (`user.store` vs `store` — both tolerated).~~ ✅ **CONFIRMED
  2026-08-11 by the first real App Market install** — see "First live capture" below. Zid
  sent `user.store`. Both are still tolerated; the nesting is no longer a guess.
- Orders search: the param **is documented** (docs.zid.sa "List Orders", read 2026-08-22) —
  `search_term`, *"Natural language lookup through (customer phone, customer email, order
  code, or customer name)"*, plus `order_id`, `order_status`, `date_from`/`date_to` and
  `per_page` ≤ 100. **That answers the open question folded in from
  `.planning/ECOMMERCE_POWER_FEATURES_PLAN.md` #3: yes, the orders search indexes the
  customer phone**, so order auto-resolve is unblocked in principle. NOT yet live-captured
  — `lookupOrder`/`getShipmentTracking` still scan up to 3 × 100 recent orders client-side
  behind the single `findOrderByCode` seam, so an order older than the 300 most recent
  answers `order_not_found` (the AI then tells a real customer their order does not exist).
  Swap the seam once §E has produced a real order to test against.
- ⛔ **Products search: the param exists and is NOT usable.** `?search=` is documented as
  "Searches products by product name", but **live-captured 2026-08-22 on dev store 3195980
  it ignores the term**: `search=نظارة` and `search=كاميرا` each returned **all 4 products**
  (`count: 4`). So it could not replace the old `checkInventory` client-side match, and the
  planned "swap in Zid's server-side search" is dead. ✅ **Product resolution now happens on
  our side (D-092, `backend/src/services/reply/productResolver.ts`)**: trigram over the
  page's product index first, then the reply's own embedding, `ambiguous` with candidates
  when the lead is not clear. `checkInventory` is gone from all three platform modules;
  Zid's `getProductById` reads ONE product with **`?id__in=<id>&page_size=1`** (live-verified:
  exact row, `is_infinite: true` preserved), picks the row by id — never `[0]` — and treats
  the **HTTP 400 an unknown id answers with as "no such product"**, not as an API failure.
  `in_stock=true` also works (returned only the one sellable product) and is unused so far.
- Tracking fields on orders (`tracking_number` / `shipping.*`) — read tolerantly,
  `undefined` when absent.
- Whether the refresh-token grant response rotates the `Authorization` token (handled
  either way: parsed when present, stored pair kept when absent).
- Zid's duplicate-webhook status code (409 and 422 both treated as already-registered).
- The exact casing of the `Basic` scheme on deliveries: verification compares the full
  header string (fails closed on `basic …`) — confirm Zid's casing from a real capture.
- **Billing (D-070), the whole envelope.** `GET /v1/market/app/subscription` has never
  been called against a live store — no merchant install has happened yet. Unconfirmed:
  the response nesting (root / `data` / `subscription`, **and the two composed** — all
  four tolerated, up to two wrappers deep), the field spellings (`subscription_status` vs
  `status`, `end_date` vs `expiry_date` vs `ends_at`, whether a subscription `id` is
  present at all), whether `plan` is nested or flat, and **the value set of
  `subscription_status`** — the one that matters most. Recognised values are listed in
  `services/zidBilling.ts`; anything else resolves to `unknown_status`, writes NOTHING,
  and raises Sentry rather than being read as "inactive". The first real delivery should
  NARROW these tolerances, not just confirm them. Also unconfirmed: the exact
  `app.market.subscription.*` event names (matched by prefix, deliberately, so an
  unrecognised one still triggers a verify).
  - ⚠️ **"We could not read it" is NOT "there is no subscription."** `fetchZidAppSubscription`
    returns a three-way `ZidSubscriptionRead`. Only an **explicit empty container**
    (`{"data": null}` / `{"subscription": null}`) is a positive `none` and may pause a
    live mirror; anything unparseable is `unreadable`, which writes NOTHING and raises
    Sentry (`zid-billing-unreadable-response`). Collapsing the two onto a single null is
    how a shape we guessed wrong — e.g. `{"data":{"subscription":{…}}}` — paused a
    merchant Zid was actively billing and cut their auto-replies.
  - A bare `status` is trusted as the SUBSCRIPTION's only inside a wrapper we descended
    into, or beside a field only a subscription carries (`plan_name`, `end_date`, …). At
    a bare root it is just as likely to be the transport's own `"success"`, and reading
    that as a subscription status booked `unknown_status` at error level for every
    installed-but-unsubscribed store, every six hours.
  - **The first real capture should collapse all of this**: pin the one true nesting,
    the one status spelling, and what a genuine "no subscription" response looks like —
    then delete the tolerances rather than leaving them as permanent guesswork.
- The Zid App Market URL where a merchant manages their subscription — undocumented and
  unobserved, so `ZID_APP_MARKET_URL` ships unset and the guard offers no link rather
  than a guessed 404.

## Live-validation checklist (the D-020 gate — follow-up PR)

> **Execution run-book: `docs/testing/ZID_TEST_PLAN.md`** (created 2026-08-01,
> authoritative — captures C1–C11, billing spec, real-traffic soak, publish rehearsal).
> The checklist below is the condensed summary.
>
> **For the ORDER these run in and what is blocking today, read "What's next" at the top
> of this file.** This section is the detail — the per-item state and the history of how
> each was resolved. It is deliberately not a second to-do list; when the two disagree,
> "What's next" is the one that gets updated.

Prereq — ✅ DONE 2026-08-01: Partner account exists (partner.zid.sa, founder), dev store
**3195980 "Jawab24 Dev"** (https://h47p59.zid.store/ — take out of maintenance mode
before captures). Still needed: ngrok (the Salla Phase-4.2 capture method).

⛔ **The agreement is NOT a prerequisite.** Zid support (2026-08-08/09): app Draft → In
Review → technical review passes → *then* the agreement is countersigned. Treating it as
an entry gate idled this work for eight days.

1. ✅ Partner app CREATED 2026-08-01: app id **7367** "Jawab24", **Client ID 7192**
   (secret in dashboard → General Settings). Redirection URL
   `https://jawab24.com/zid/auth`, Callback URL `https://jawab24.com/zid/auth/callback`.
   Dashboard scope groups selected: Account R, Account Identity R, Store Core Details R,
   Orders R, Products R, Webhooks RW. Lifecycle webhook configured:
   `app.market.application.uninstall` → `https://jawab24.com/zid/webhooks?e=app.market.application.uninstall`.

   🔴 **Submitted and REJECTED 2026-08-10** — *"OAuth does not yet meet our required
   standards. Key updates needed: • Direct merchant access (no sign-in prompt) • Full
   data integration with Zid."* The app returned to an editable state (verified 08-11).
   Addressed by the Embedded Apps work above; see `docs/testing/ZID_TEST_PLAN.md` §L.

   ✅ **Superseded 2026-08-09 → the app went `In review` again**, then was deliberately
   withdrawn to `Draft` on 2026-08-22 (both states portal-verified that day; see
   "What's next" at the top for the current status and why the withdrawal changed nothing).
   Zid pointed out on 08-09 that the app had fallen back to `Draft`, which is why the
   rejection appeared to be the standing state for longer than it was — a `Draft` app is
   not under review and nobody is looking at it. Flipping it back is what restarted the
   clock. Keep this rejection text as history; it is no longer the current status.

   ✅ **Scope strings: RESOLVED 2026-08-11 — the question was malformed.** The authorize
   URL takes one documented scope (`embedded_apps_tokens_write`); the dashboard matrix
   grants the data permissions. See "Scopes" above.

   ⚠️ Still open from captures: whether `ZID_APP_ID` (webhook `original_id`) is the app
   id 7367 or the Client ID 7192, and what auth the `app.market.*` lifecycle deliveries
   carry.

   ⚠️ **Portal changes still owed before resubmitting** (do them only AFTER this code is
   deployed, or the reviewer hits a 404): tick the **Embedded App** toggle in General
   Settings and set the **Application URL** to `https://jawab24.com/zid/embedded`.
2. Capture raw responses: token exchange (form-urlencoded accepted? `Authorization` field
   on both grants?), profile, products (+ multilingual name shape), orders, and full
   webhook deliveries (headers + envelope + order payload).
3. Resolve the orders search/filter params (incl. the phone-indexing question) and swap
   the `findOrderByCode` scan for real filters. (The product side is closed: `checkInventory`
   and its `?search=` dependency are gone — D-092.)
4. Finalize every `[provisional]` parser + fixture from the captures; run the unit suite
   and `ADMIN_TOKEN=… npm run test:ecommerce:zid` (live smoke).
5. Full round-trip: connect → product sync → KB enrichment → place order →
   `order.create` SMS → status `indelivery` → shipped SMS → `delivered` → delivered SMS →
   uninstall → store deactivated.
6. Only then: remove the `coming_soon` badge (`frontend/src/pages/integrations.tsx`),
   flip the status tables in `INTEGRATIONS.md` / `SYSTEM_ANALYSIS.md`, and append the
   D-NNN closing D-020's gate.

   ⚠️ **Several public surfaces were already flipped ahead of this gate, deliberately,
   on 2026-08-07 (PR #663).** Owner decision: the Zid Partner application was submitted
   2026-08-01 and approval could land at any time, so reverting and re-adding the copy
   was judged churn. These now describe Zid as a live integration **while the badge still
   says `coming_soon`** — that disagreement is known and intended, not a bug to "fix":

   - `frontend/public/llms.txt` — listed under "E-commerce integrations"
   - `frontend/public/llms-full.txt` — its own "### Zid" section under E-Commerce Integration
   - `frontend/src/pages/_document.tsx` — `SoftwareApplication` `featureList` entry,
     `description` ("Shopify, Salla, and Zid"), and `keywords`
   - `frontend/src/i18n/{en,ar}/about.json` — `platforms.zid` + Zid named in `intro.text`,
     rendered by `frontend/src/pages/what-is-jawab24.tsx`

   So at step 6 there is **nothing to add** on those four surfaces — only the badge and
   the status tables remain. Conversely, if the D-020 gate ever fails and Zid is parked
   again, these four MUST be reverted: they are public, and `llms.txt` in particular is
   read verbatim by AI assistants (AI_INSTRUCTIONS §15 — never claim a feature exists
   when it does not).

## Shared infrastructure Zid reuses (unchanged)

The unified `ecommerce_*` schema, `services/ecommerce.ts` (store CRUD,
`replaceProductsAndRebuildSummary`, KB enrichment, GDPR purge), the shared 5 AI tools
(`packages/shared/src/ecommerce-tools.ts`), `registerWebhooksWithPersist` + the retry
worker, the shared token refresher (`ecommerceTokenRefresh.ts`), and the
order-notification scheduler/dedup (`orderNotificationScheduler.ts` +
`customerNotifications.ts`). The product-page cap now derives from the shared
`PRODUCT_SAFETY_CAP` (5000) like Salla — the old silent 300-product truncation is gone.

---

## Historical: the original defects (D-020, fixed by this rebuild)

Kept for context — these are what the 2026-07-07 audit found in the first implementation:

1. **Missing `Authorization: Bearer`** — only `X-MANAGER-TOKEN` was sent, and the
   `Authorization` token was discarded at code exchange, so every API call 401'd and no
   merchant could ever connect.
2. **Invented webhook event names** — `product.created/updated/deleted`,
   `app.uninstalled`, `order.created/updated/shipped/delivered` (none exist in Zid);
   registration failed and `buildZidOrderEvent` was dead code, "covered" by a test that
   asserted `order.created` was *ignored*.
3. **Wrong endpoints** — `/v1/store/info`, `/v1/orders`, `/v1/webhooks` instead of the
   `/v1/managers/...` paths; JSON token exchange instead of form-urlencoded; a
   nonexistent `x-zid-signature` HMAC scheme.
