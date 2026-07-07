# Zid Integration — ❌ Broken (rebuild pending)

> **Status: NOT production-ready.** The Zid adapter, service, controller, and routes all
> exist and are enabled when `ZID_CLIENT_ID` is set, but the integration was built against
> the **wrong Zid API contract** and has never round-tripped a real Zid store. A merchant
> cannot connect. Its tests mock the same wrong shapes the code assumes, so they pass while
> nothing actually works.
>
> Ruling: [`DECISIONS.md` D-020](../../DECISIONS.md). The rebuild itself is parked
> ("rebuild last"); this document records the exact scope so the rebuild is a known task.
> Salla and Shopify are unaffected and remain live.

## Where the code is

| Layer | File |
|-------|------|
| Integration adapter | `backend/src/integrations/zid.ts` |
| Service (OAuth, REST, sync, webhooks) | `backend/src/services/zid.ts` |
| Controller (webhook handler, `buildZidOrderEvent`) | `backend/src/controllers/zid.ts` |
| Routes | `backend/src/routes/zid.ts` |
| Config | `backend/src/config/index.ts` (`config.zid`, enabled when `ZID_CLIENT_ID` set) |
| Tests (mock the wrong contract — see below) | `backend/test/{services,controllers,routes,integrations}/zid.test.ts` |

## Confirmed defects (why it can't work)

### 1. Missing `Authorization: Bearer` header — every API call 401s
Zid's Merchant API requires **two** headers on every request: `Authorization: Bearer <access_token>` **and** `X-Manager-Token: <manager_token>`. The code sends only `X-MANAGER-TOKEN` (`services/zid.ts:148` in `registerWebhooks`, `:189` `authHeaderName` for `zidApiGet`). It also discards the separate `authorization`/manager token Zid returns at code exchange (`exchangeCodeForToken`), so the bearer value is never even stored.

**Effect:** OAuth callback → `fetchStoreInfo` → 401 → callback throws → redirect `…/login?zid_error=auth_failed`. No store is ever created; product sync, orders, inventory, and webhook registration all 401 too.

### 2. Subscribes to webhook events that don't exist in Zid — no webhook ever fires
`ZID_WEBHOOK_EVENTS` (`services/zid.ts:114-124`) uses `product.created/updated/deleted`, `app.uninstalled`, `order.created/updated/shipped/delivered`. Zid's **real** events are `product.create`, `product.update`, `product.publish`, `product.delete`, `order.create`, `order.status.update`, `order.payment_status.update`, `abandoned_cart.created/.completed`, plus `customer.*`/`category.*` — and there is **no `app.uninstalled`** event. Consequences:
- Webhook registration subscribes to invalid names (rejected / never delivered).
- `buildZidOrderEvent` (`controllers/zid.ts`) branches on `order.created/shipped/delivered`, which Zid never sends — no notification is ever built.
- Uninstall handling never runs (no `app.uninstalled`).

### 3. Likely-wrong REST endpoints
Code calls `https://api.zid.sa/v1/products` (`:270`), `/v1/orders` (`:413`), `/v1/store/info` (`:205`), `/v1/webhooks` (`:144`). Zid's documented Merchant endpoints live under `/v1/managers/...` (e.g. `/v1/managers/store/products`) and return different envelope keys than the assumed `store_products`/`store`/`orders`. Every endpoint needs verification against the live API.

## Open questions to resolve during the rebuild

- **Token refresh content-type.** Code exchange posts JSON (`services/zid.ts`), but the shared refresh (`services/ecommerceTokenRefresh.ts`, form-urlencoded) is used for Zid — confirm which Zid's `refresh_token` grant expects.
- **Webhook signature scheme.** `controllers/zid.ts:29` requires an `x-zid-signature` hex HMAC over the body (`config.zid.webhookSecret`). Zid's docs don't clearly document a signing header/algorithm; if Zid doesn't send it, all webhooks are rejected 401 regardless of the other fixes.

## Rebuild scope (checklist)

1. **Auth**: capture and store Zid's manager/authorization token at code exchange; send **both** `Authorization: Bearer <oauth>` and `X-Manager-Token: <manager>` on every request (`zidApiGet`, `registerWebhooks`, `utils/httpRetry.ts`).
2. **Endpoints**: switch to Zid's real `/v1/managers/...` paths; map the real response envelopes.
3. **Events**: subscribe to real slugs (`order.create`, `order.status.update`, `product.create/update/publish/delete`, `abandoned_cart.*`); rewrite `buildZidOrderEvent` to map `order.status.update` → shipped/delivered by status value.
4. **Refresh + signature**: confirm the refresh content-type and the webhook signature scheme; align `ecommerceTokenRefresh.ts` / `hmacVerify` accordingly.
5. **Tests**: rewrite `test/**/zid.test.ts` against **captured real payloads** (not the current self-consistent mocks). `buildZidOrderEvent` currently has effectively zero real coverage — `test/controllers/zid.test.ts` mocks `isOrderEvent` to always return false and even asserts `order.created` is "ignored." Add a `test:ecommerce:zid` script mirroring `:salla`/`:shopify`.
6. **Verify** with a real Zid dev store end-to-end (connect → sync → order webhook → notification) before flipping the status in `INTEGRATIONS.md` / `SYSTEM_ANALYSIS.md` back to Active.

## Shared infrastructure Zid *will* reuse (already correct)

The unified core is fine; only the Zid-specific contract is wrong. On rebuild, Zid keeps using: the unified `ecommerce_*` schema, `services/ecommerce.ts` (store CRUD, `replaceProductsAndRebuildSummary`, KB enrichment), the shared 5 AI tools (`lookup_order`, `track_shipment`, `check_inventory`, `verify_and_get_order`, `verify_and_get_shipment` in `packages/shared/src/ecommerce-tools.ts`), and the order-notification scheduler/dedup (`orderNotificationScheduler.ts` + `customerNotifications.ts`).
