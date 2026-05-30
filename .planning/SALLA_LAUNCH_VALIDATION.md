# Salla Launch Validation Plan

> **Status:** Drafted 2026-05-07. Pending execution against a Salla dev store.
> **Purpose:** Validate that the Phase 1 (backend webhook hardening, merged in
> PR #27) and Phase 2 (frontend recovery UI, PR #28) work end-to-end against a
> real Salla dev store before submitting Jawab24 to the Salla Partners App
> Store.
>
> **Inherits:** [`ECOMMERCE_LAUNCH_VALIDATION.md`](./ECOMMERCE_LAUNCH_VALIDATION.md). Walk that file's
> sections 0–7, applying the substitutions below.

---

## Salla-specific substitutions

| Template placeholder | Salla value |
|---|---|
| `<PLATFORM>` (URL prefix in API paths) | `salla` |
| `<PLATFORM>` (uppercase, env-var prefix) | `SALLA` |
| `<PLATFORM>_HOST_NAME` | `SALLA_HOST_NAME` |
| Partners portal | [Salla Partners](https://salla.partners/) |
| Production callback URL | `https://jawab24.com/salla/auth/callback` |
| OAuth scopes | `offline_access`, `products.read_write`, `settings.read` |
| Webhook signature header | `X-Salla-Signature` (hex digest) |
| "Already exists" status code | `422` (mirrors Shopify; treated as success) |
| Token expiry | **14 days**, refresh tokens are **single-use** (Redis distributed lock prevents concurrent-refresh races) |
| Mandatory webhooks (Section 6) | `app.uninstalled` only — Salla does **not** require GDPR endpoints |

## Salla-specific webhook topics (Section 3.1 expected list)

All registered to the single endpoint `POST /salla/webhooks` (dispatched by `event` field in body):

```
product.created
product.deleted
product.price.updated      ⚠️ LOW-confidence — may not exist (see S4); verify in A2
product.status.updated
product.quantity.low
app.uninstalled
order.created
order.updated
order.shipping.update      ❌ NOT A REAL SALLA EVENT — see S4 (→ order.shipment.created)
order.completed            ❌ NOT A REAL SALLA EVENT — see S4 (→ order.status.updated + slug)
abandoned.cart
```

> ⚠️ **Three of these strings are wrong** — confirmed against Salla's official docs + SDKs on 2026-05-30 (high confidence, adversarially verified). The corrected list and the exact code patch are in **§S4 below**. The current list is preserved here to show the as-shipped state the patch replaces.

Source-of-truth list: `SALLA_WEBHOOK_EVENTS` in [`backend/src/services/salla.ts`](../backend/src/services/salla.ts). Drift between this list and `SALLA_WEBHOOK_TOPICS` in `backend/src/integrations/salla.ts` is guarded by `backend/test/integrations/webhookTopicDrift.test.ts`.

---

## Salla-only sections (additions to the template)

### S1. Salla-first install flow (Section 3.5 detail)

Salla-first means the merchant clicks Install on Jawab24's listing inside the Salla App Store — not from `/en/integrations`. Two distinct paths must both validate:

#### S1a. Already-logged-in merchant
1. From the Salla App Store listing, click Install.
2. Salla auto-redirects to `https://jawab24.com/salla/auth/callback?code=...&state=...`.
3. Backend exchanges the code, finds an active Jawab24 session, creates the store immediately.
4. Redirects to `/salla/onboarding`.

**Pass criteria:**
- [ ] `ecommerce_stores` row created with `platform='salla'`, `is_active=true`, `merchantId` populated in `platformData`
- [ ] `webhookStatus` populated as in template Section 3.1
- [ ] No `pending_ecommerce_installs` row created

#### S1b. Not-logged-in merchant (claim flow)
1. From the Salla App Store listing, click Install.
2. Salla redirects to the callback; backend has no Jawab24 session.
3. Backend creates a `pending_ecommerce_installs` row (encrypted token, 30-min TTL), sets a signed `pendingSallaId` cookie, redirects to `/login`.
4. Merchant logs in via Facebook.
5. `claimPendingInstall('salla', ...)` consumes the cookie, finalizes the store, calls `registerWebhooks` via the shared `registerWebhooksWithPersist` helper.

**Pass criteria:**
- [ ] `pending_ecommerce_installs` row exists with `expiresAt > now()`, encrypted access + refresh tokens
- [ ] After Facebook login, the pending row is deleted and `ecommerce_stores` row exists
- [ ] `webhookStatus` populated correctly
- [ ] If the user never logs in within 30 min, the cleanup interval (`cleanupExpiredInstalls('salla')`) removes the row

### S2. Token refresh under contention (Salla-specific)

Salla refresh tokens are **single-use**. Two parallel API calls hitting an expired token must serialize via the Redis distributed lock or one will burn the refresh token and the other will fail.

**Steps:**
1. Connect a Salla store (or pick an existing one).
2. Manually expire the token by setting `tokenExpiresAt` to `now() - 1 minute` in the DB.
3. Trigger two near-simultaneous calls that need a fresh token:
   ```bash
   curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:3000/salla/store/sync &
   curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:3000/salla/store/sync &
   wait
   ```
4. Watch logs for `[SallaTokenRefresh] acquired lock` and `[SallaTokenRefresh] waiting for lock`.

**Pass criteria:**
- [ ] One call acquires the Redis lock (NX + 30s TTL), refreshes the token, writes the new pair to DB
- [ ] The other call waits 2s, re-reads the (now refreshed) token from DB, proceeds without a second refresh API call
- [ ] No "invalid_grant" errors in logs (would indicate both calls tried to use the same refresh token)
- [ ] DB ends with exactly one fresh `accessToken` + `refreshToken` pair

### S3. Webhook HMAC verification (negative cases)

Salla uses **hex** digest in the `X-Salla-Signature` header (vs Shopify's base64).

```bash
# Replace SECRET with config.salla.webhookSecret
SECRET="<secret>"
BODY='{"event":"app.uninstalled","data":{"merchantId":"123"}}'
HMAC=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')

# Valid HMAC
curl -X POST -H "Content-Type: application/json" \
  -H "X-Salla-Signature: $HMAC" \
  -d "$BODY" \
  http://localhost:3000/salla/webhooks

# Missing header
curl -X POST -H "Content-Type: application/json" \
  -d "$BODY" \
  http://localhost:3000/salla/webhooks

# Wrong HMAC
curl -X POST -H "Content-Type: application/json" \
  -H "X-Salla-Signature: 0000000000000000000000000000000000000000000000000000000000000000" \
  -d "$BODY" \
  http://localhost:3000/salla/webhooks
```

**Pass criteria:**
- [ ] Valid HMAC → 200, `app.uninstalled` handler runs (sets `is_active = false`)
- [ ] Missing header → 401
- [ ] Wrong HMAC → 401, no side effects
- [ ] No timing leak: invalid signatures should reject in roughly the same time as valid (timing-safe comparison via `verifyHexHmac`)

### S4. Webhook event-name corrections (A3 — STAGED patch, apply after payload capture)

> **Source:** doc research + adversarial verification against Salla's official docs (docs.salla.dev) and both official SDKs, 2026-05-30. The corrected event **strings** are high-confidence; the **JSON path** is the one load-bearing unknown that a real payload must settle — see "Confirm first" below. **Do not apply blind to prod.**

**What's wrong today** (`controllers/salla.ts:buildSallaOrderEvent` + `SALLA_WEBHOOK_EVENTS` + adapter `SALLA_WEBHOOK_TOPICS`):
- `order.completed` — **does not exist.** Completion/delivery is a *status value* inside `order.status.updated`: `data.status.slug ∈ {"completed","delivered"}`. Branch on `slug` (stable English id), **never** `name` (localized Arabic: تم التنفيذ / تم التوصيل).
- `order.shipping.update` — **does not exist.** The shipment/tracking event is `order.shipment.created`. (Optional sibling: `order.shipment.creating` = assigning to carrier.)
- Handler's `data.status?.name === 'in_transit'` — `in_transit` is **not** a Salla slug; the in-transit slug is `shipped`.
- `product.price.updated` — LOW confidence it exists (SDKs don't list it; price changes may arrive via `product.updated`). Verify before relying on it; 6h full-sync covers price drift regardless.

**Corrected subscription list** (edit `SALLA_WEBHOOK_EVENTS` in `services/salla.ts` AND `SALLA_WEBHOOK_TOPICS` in `integrations/salla.ts` **in lockstep** — `webhookTopicDrift.test.ts` asserts they're equal, so it self-validates with no test edit):
```
product.created, product.deleted, product.price.updated*, product.status.updated, product.quantity.low,
app.uninstalled,
order.created, order.updated, order.status.updated, order.shipment.created, abandoned.cart
```
(* keep or drop `product.price.updated` per A2 finding)

**Handler patch** (`controllers/salla.ts`):
- Widen type: `SallaOrderData.status` → `{ slug?: string; name?: string }`.
- `order_shipped` branch: `event === 'order.shipment.created' || (event === 'order.status.updated' && data.status?.slug === 'shipped')`.
- `order_delivered` branch: `event === 'order.status.updated' && (data.status?.slug === 'completed' || data.status?.slug === 'delivered')`.
- Leave `order.created` (order_confirmed) + `abandoned.cart` branches' field extraction unchanged **unless** the path check below says otherwise.

**Confirm first in A2 (capture one real webhook body of each: `order.created`, `order.status.updated`, `order.shipment.created`, `abandoned.cart`):**
1. **Payload nesting depth — the blocker.** Salla's doc example nests status as `data.order.status.slug`, but our code reads `data.status` (and `data.customer`/`data.id`/`data.total`) directly. If real payloads use `data.order.*`, the `SallaOrderData` destructuring (`const { data }`, line 206) and *all four* branches need `data.order.*` — and the existing order.created/abandoned.cart branches may already be silently misreading. Settle this with one real payload before touching the handler.
2. Terminal slug on delivery: `completed`, `delivered`, or both?
3. `order.shipment.created` (order. prefix) vs bare `shipment.created` — docs disagree; the SDK/Orders-model form is `order.shipment.created`.
4. Tracking-number path on the shipment event: still `data.shipments[0].tracking_number`?
5. Does `product.price.updated` actually fire?

After A2 confirms: apply the two constant edits + handler patch, run `npx vitest run test/integrations/webhookTopicDrift.test.ts test/controllers/salla.test.ts`, then `tsc --noEmit && lint && test`.

---

## Pre-flight overrides

In template Section 1, these substitutions apply:

```bash
# /shopify-dev script also handles Salla — just re-set SALLA_HOST_NAME and the dev app config
SALLA_HOST_NAME=<ngrok>          # in backend/.env
```

Salla Partners "Jawab24-Dev" app redirect URLs must include:
- `https://<ngrok>/salla/auth/callback`

---

## Pre-submission gate (Salla-specific additions to template Section 7)

In addition to the template's Section 7 boxes:
- [ ] S1a + S1b (Salla-first install — both flows) green
- [ ] S2 (token refresh under contention) green
- [ ] S3 (HMAC negative cases) green
- [ ] Restore prod credentials before deploy: per memory, prod `SALLA_CLIENT_ID=93c86e8524610bbf5353d5fc5ce27eca`-style values must replace the Jawab24-Dev ones, and `SALLA_HOST_NAME=jawab24.com`. *(Memory file: see project memory's "Shopify Local Dev Setup" section — Salla follows the same pattern with its own credential set.)*
- [ ] Salla App Store listing assets prepared (Phase 5):
  - App icon (1024×1024)
  - Banner
  - Screenshots (Arabic + English): integration card, onboarding wizard, link-page step, AI reply demo
  - Demo video (60–90s) — Arabic-narrated
  - Privacy policy at `https://jawab24.com/privacy` covers Salla data handling explicitly
  - Support email + decision on billing model (Salla-managed billing vs free tier)
- [ ] Salla Partners production app:
  - `SALLA_CLIENT_ID/SECRET` point to the **published** app (not a draft)
  - Webhook secret rotated
  - Callback URL set to `https://jawab24.com/salla/auth/callback`
  - Required scopes match `config.salla.scopes`

---

## Submission notes

- Salla reviewer test path: provide a test Facebook page + dev Salla store credentials in the review notes.
- Salla turnaround historically 5–10 days. Plan accordingly.
- After approval, update `SYSTEM_ANALYSIS.md` and `.planning/codebase/INTEGRATIONS.md` (per `AI_INSTRUCTIONS.md` rule 15) — mark Salla as "Live in App Store" and update the integrations doc.

---

## Live dogfood session — 2026-05-30 (results + blocker + staged A3 patch)

### What was verified GREEN (local stack: backend :3000, ai-worker :3002, ngrok)
- **Section 5.1 — AI-reply correctness:** ✅ PASS against the seeded Salla catalog (`gulf-fashion.salla.sa`, 6 Arabic products). 4 playground probes (DM channel): embroidered abaya → "750–950 ريال" (exact), bisht → "1200–2500 ريال" (exact), oud perfume → "350 ريال" (exact), and a **not-in-catalog probe (smart watches) correctly declined with no invented price → hallucination guard holds**. All `intent=QUESTION, confidence=high`, RAG on, real product URLs, natural Gulf dialect.
- **S3 — HMAC webhook security:** ✅ PASS live against `/salla/webhooks` — valid hex sig → 200, missing header → 401, wrong sig → 401.
- **OAuth dev config:** ✅ `GET /salla/auth` builds the correct authorize URL — Jawab24-Dev client `eab0620f-…`, redirect_uri = ngrok `/salla/auth/callback`, scopes `offline_access products.read_write settings.read webhooks.read_write orders.read_write`.

### BLOCKER — live OAuth connect not completed (do not repeat these dead ends)
- The **chrome-devtools automation browser is blocked by Cloudflare on EVERY Salla domain** (login `accounts.salla.sa`, `demostore.salla.sa`, portal) — Turnstile / "Verify you are human", Geo:SE egress. Cannot drive any Salla page via that MCP. Don't retry it.
- **Demo store merchant login fails:** the Partners demo store (`Jawab24 Dev Store`) has a **synthetic placeholder email `rdrrgyvqtlrvewgq@email.partners`** that does not authenticate through the normal `accounts.salla.sa` login form, even after "Change Password". Logging in with the *partner* account (`aliahdab@gmail.com`) also fails — different account system → Salla error "بيانات المصادقة غير صحيحة".
- **Unresolved:** the correct way to install an *unpublished* dev app onto a Partners demo store (likely via the demo store **Dashboard URL** signed session, or a Partners-portal "install on demo store" action) was not confirmed. Confirming the exact Salla demo-store install flow is the next step before the user can complete the OAuth handshake.
- **To finish later:** user completes the app install/approve in their own (Cloudflare-trusted) browser → callback hits `/salla/auth/callback` → store row created with real refresh token. A DB poll for `ecommerce_stores WHERE platform='salla' AND refresh_token IS NOT NULL` catches success.

### A3 patch — webhook event-name corrections ✅ APPLIED (commit `ed50e492`, PR #215)

> **DONE 2026-05-30.** The nesting question was settled by a **live `order.created` payload**: Salla nests order data **flat under `data`** (`data.status.slug`, `data.id`, `data.customer`) — NOT `data.order.*` as the doc example suggested. So the handler branches on `data.status.slug`, matching the existing code convention. Applied + 3 regression tests + 95 green. The patch spec below is kept for the record. (`product.price.updated` low-confidence note still open — verify against the live List Events API.)

**Findings:** `order.completed` does **not exist** (completion = `order.status.updated` with `data.status.slug ∈ {completed, delivered}` — branch on **slug**, not localized `name`). `order.shipping.update` does **not exist** → `order.shipment.created`. The handler's `in_transit` status is bogus → real slug is `shipped`. (`product.price.updated` is also low-confidence — verify against the live List Events API.)

1. **`backend/src/services/salla.ts`** — `SALLA_WEBHOOK_EVENTS`: remove `order.shipping.update` + `order.completed`; add `order.status.updated` + `order.shipment.created`. Order block → `order.created, order.updated, order.status.updated, order.shipment.created, abandoned.cart`.
2. **`backend/src/integrations/salla.ts`** — `SALLA_WEBHOOK_TOPICS`: identical edit (must stay byte-equal to #1 — `webhookTopicDrift.test.ts` asserts equality).
3. **`backend/src/controllers/salla.ts`** — `buildSallaOrderEvent` (~L231–239) + `SallaOrderData` (~L196–203):
   - widen status type → `status?: { slug?: string; name?: string };`
   - order_shipped branch → `event === 'order.shipment.created' || (event === 'order.status.updated' && data.status?.slug === 'shipped')`
   - order_delivered branch → `event === 'order.status.updated' && (data.status?.slug === 'completed' || data.status?.slug === 'delivered')`
4. **`backend/test/integrations/webhookTopicDrift.test.ts`** — no edit needed (relative equality assertion); just re-run after #1/#2.
5. After applying: `cd backend && npx tsc --noEmit && npm run lint && npx vitest run test/integrations/webhookTopicDrift.test.ts test/controllers/salla.test.ts test/services/salla.test.ts`.
