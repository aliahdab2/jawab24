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
product.price.updated
product.status.updated
product.quantity.low
app.uninstalled
order.created
order.updated
order.shipping.update
order.completed
abandoned.cart
```

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
