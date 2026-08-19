# Payment Test Coverage

Living map of what the payment system is actually tested for. Written 2026-07-25
after a production bug where merchants were charged and never activated — a bug
the suite could not have caught, because the tests exercised a flow production
had stopped using.

**Update this file in the same commit as any change to the payment surface.**

---

## The lesson that produced this file

`payment.lifecycle.test.ts` covers eleven scenarios end to end. Every one goes
through `handleCheckoutComplete` — Stripe **Checkout Sessions**. Production
subscribes through the embedded **PaymentElement**
(`create-subscription-intent` → `stripe.subscriptions.create`), which never
creates a Session, so `checkout.session.completed` never fires.

The suite was green and thorough about a path merchants do not take.
`createSubscriptionIntent` — the endpoint every paying merchant hits — appeared
in **zero** test files.

> A green suite proves the tested path works. It says nothing about which path
> production takes. When a flow is replaced, its tests must be replaced too, or
> they become expensive decoration.

---

## Endpoints

| Endpoint | Unit | Integration | Notes |
|---|---|---|---|
| `POST /create-subscription-intent` | `controllers/payment.test.ts` (13 cases) | `payment.paymentElement.test.ts` | **The live subscribe flow.** Had no coverage at all before 2026-07-25 |
| `POST /create-checkout-session` | `controllers/payment.test.ts` (embedded + hosted branches) | `payment.test.ts`, `payment.lifecycle.test.ts` | Embedded (legacy web) **and hosted (`uiMode: 'hosted'`, D-040)** — the native-app flow and the web fallback link. Hosted service params pinned in `services/stripe.test.ts` |
| `POST /create-topup-intent` | `controllers/payment.test.ts`, `services/topup.test.ts` | — | |
| `POST /change-plan` | `controllers/payment.test.ts` | `payment.test.ts` | |
| `POST /cancel-subscription` | `controllers/payment.test.ts` | `payment.lifecycle.test.ts` | |
| `POST /billing-portal` | `routes/payment.test.ts` | `payment.test.ts` | |
| `GET /subscription-status` | `payment_status_ordering.test.ts` | `payment.test.ts` | |
| `GET /checkout-session-status` | `routes/payment.test.ts` | — | |
| `POST /webhook` | `controllers/payment.test.ts` | `stripe-webhook.test.ts` (transport), `stripe-webhook.dispatch.test.ts` (signed payload → handler → DB) | |

## Webhook events

| Event | Handler | Covered |
|---|---|---|
| `checkout.session.completed` | `handleCheckoutComplete` | ✅ unit + integration |
| `customer.subscription.created` | `handleSubscriptionCreated` | ✅ incl. adoption fallback |
| `customer.subscription.updated` | `handleSubscriptionUpdated` | ✅ incl. adoption fallback |
| `customer.subscription.deleted` | `handleSubscriptionDeleted` | ✅ |
| `invoice.payment_succeeded` | `handlePaymentSucceeded` | ✅ incl. adoption after retries |
| `invoice.payment_failed` | `handlePaymentFailed` | ✅ |
| `payment_intent.succeeded` | `handleTopupPaymentSucceeded` | ✅ |
| `payment_intent.payment_failed` | `handlePaymentIntentFailed` | ✅ — ⚠️ **not enabled on the Stripe endpoint**; never once received |
| `charge.refunded` | `handleChargeRefunded` | ✅ incl. top-up claw-back |
| `charge.dispute.created` | `handleChargeDisputed` | ✅ |

## Scenarios

### Subscribe — PaymentElement (production flow)
| # | Scenario | Covered |
|---|---|---|
| PE-1 | Intent → paid → row linked and active | ✅ |
| PE-2 | Retry spam: several `incomplete` subs, only the paid one wins | ✅ |
| PE-3 | Signup trial row taken over, never duplicated | ✅ |
| PE-4 | `invoice.payment_succeeded` adopts an unlinked row | ✅ |
| PE-5 | Replay is idempotent | ✅ |
| PE-6 | Webhook never arrives → reconciliation sweep heals the unlinked row | ✅ |

### Renewal — a missed `invoice.payment_succeeded`

Since #817 that event is the ONLY writer of `current_period_*` (it is the only
one that proves money landed), which makes a dropped delivery freeze a PAYING
merchant's paid-through until the 3-day grace expires and the gate blocks them.
The sweep's period healer is what repairs it (`healStripeSubscriptionPeriod`).

Fixtures are shapes read off the LIVE API on 2026-08-19, not hypothesised — the
first #817 regression test asserted a payload Stripe never sends (`past_due`
carrying an advanced period) and passed while the defect was fully live.

| # | Scenario | Covered |
|---|---|---|
| RN-1 | Renewal paid, event never arrived → paid-through advanced, quota window reopened | ✅ |
| RN-2 | Period Stripe advanced but never paid (`active` + OPEN invoice) → refused | ✅ |
| RN-3 | `latest_invoice` unexpanded (bare id) → fails closed, refused | ✅ |
| RN-4 | Stripe's period ends earlier than ours → never retracted | ✅ |
| RN-5 | Stripe agrees with the row → nothing written, no `updated_at` churn | ✅ |
| RN-6 | Row with a NULL paid-through (`past_due`, entitled forever) → healed | ✅ |
| RN-7 | Status and period restored on ONE write, never decoupled | ✅ |
| RN-8 | Dunning episode closed, so future failures are not silenced | ✅ |
| RN-9 | `trialing` healed without consulting an invoice | ✅ |

### Guards before any Stripe call
| Scenario | Covered |
|---|---|
| Sanctioned country → 403 `SANCTIONED_GEO_BLOCK` | ✅ |
| Unresolved geo → 403 `GEO_VERIFICATION_REQUIRED` (fail-closed) | ✅ |
| Missing email → 400 `EMAIL_REQUIRED` | ✅ |
| Plan without `stripePriceId` → 400 | ✅ |
| Demo account → 403 `DEMO_USER_STRIPE_BLOCKED` | ✅ |
| Trial denied to a returning subscriber (re-trial loophole) | ✅ |

### Top-ups
Well covered in `services/topup.test.ts` — credit, replay, refund claw-back,
dispute, fail-then-retry on the same PaymentIntent, abandoned-PI reconciliation.

---

## Known gaps

### 1. Real Stripe round-trip — harness built, key still missing
`stripe.roundtrip.live.test.ts` makes genuine test-mode API calls: create the
subscription the way production does → assert the real Stripe object carries
`metadata.userId` → pay it with `pm_card_visa` → assert Stripe reports `active`
→ feed the real subscription to the webhook handler → assert the merchant is
activated locally.

It runs on **every deploy**, as step 6b of `pre-deploy-check.sh`, which
`deploy-production.sh` invokes as a hard gate.

**Secrets added 2026-07-25** (`STRIPE_TEST_SECRET_KEY` +
`STRIPE_TEST_PUBLISHABLE_KEY`), but **the test has still never been executed** —
a harness, not a result.

Two things to know. [`ci.yml`](../../.github/workflows/ci.yml) substitutes an
empty string for a missing secret rather than failing, so CI would otherwise run
payment checks with `STRIPE_SECRET_KEY=""` and let Stripe-dependent paths go
inert, silently. And GitHub Actions is currently blocked on **account billing**
(jobs never start), so CI proves nothing at all right now — the local
`deploy-production.sh` gate is the real one.

For a LOCAL deploy the key must be in the LOCAL shell; GitHub secrets do not
reach a script on the founder's Mac:
`export STRIPE_TEST_SECRET_KEY=sk_test_…`

That is why the gate treats an absent key as a **hard failure, never a skip**:
"no key so we skipped it" and "payments verified" look identical in a deploy
log. Opting out is possible but must be deliberate and visible —
`ALLOW_UNVERIFIED_PAYMENTS=1`.

The harness refuses any key that is not `sk_test_`, and refuses the
`sk_test_…dummy` placeholder from `test/integration/setup.ts`.

### 2. Webhook *delivery* → handler → DB
**Closed 2026-07-25.** Two suites sat either side of this seam and both were
green while merchants went unactivated: `stripe-webhook.test.ts` proves transport
(real signatures, tampering, replay, dedup) but **mocks `dispatchStripeEvent`**;
the handler suites call handlers **directly** and never see a real payload.
Nothing crossed the middle — which is exactly where the bug lived.

`stripe-webhook.dispatch.test.ts` removes the mock: a genuinely signed
`customer.subscription.updated` enters at the HTTP entry point and the assertion
is on the merchant's row.

### 3. Frontend checkout is mocked end to end
`payment-flow.spec.ts` stubs every API call with `MOCK_PLANS`. No test asserts
Stripe.js loads or that the Pay button ever becomes enabled — which is why a
form that was dead for a merchant looked healthy in CI.

### 4. `payment_intent.payment_failed` ships dormant
Handled in code, never delivered. Enable it on the Stripe webhook endpoint or
the handler is dead code.

### 5. ~~Legacy Checkout Session flow still fully tested~~ — RESOLVED by D-040
The Checkout Session flow is no longer legacy: hosted mode (D-040) is the
native-app payment path and the web fallback for privacy browsers that silently
block the embedded PaymentElement. Its tests — including the full
`payment.lifecycle.test.ts` suite through `handleCheckoutComplete` — now cover a
live production path again. The frontend halves are covered in
`hooks/useSelectPlan.test.ts` (app handoff) and the checkout fallback link.

### 6. `npm run lint` is red on `main`
2 errors in `packages/shared/src/utils/validation.ts` (`'URL' is not defined`),
unrelated to payments, but the documented zero-error gate does not pass today.

### 7. Backend `npm run lint` does not cover tests
`"lint": "eslint src/**/*.ts"` — test files are never linted, which is why
`test/controllers/payment.test.ts` carries 104 pre-existing `@typescript-eslint/no-explicit-any`
errors nobody has seen. Not payment-specific, but it means test quality has no gate.
