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
| `POST /create-subscription-intent` | — | `payment.paymentElement.test.ts` | **The live subscribe flow.** Had no coverage at all before 2026-07-25 |
| `POST /create-checkout-session` | `controllers/payment.test.ts` | `payment.test.ts`, `payment.lifecycle.test.ts` | Legacy Checkout Session flow — heavily covered, **not used by the app** |
| `POST /create-topup-intent` | `controllers/payment.test.ts`, `services/topup.test.ts` | — | |
| `POST /change-plan` | `controllers/payment.test.ts` | `payment.test.ts` | |
| `POST /cancel-subscription` | `controllers/payment.test.ts` | `payment.lifecycle.test.ts` | |
| `POST /billing-portal` | `routes/payment.test.ts` | `payment.test.ts` | |
| `GET /subscription-status` | `payment_status_ordering.test.ts` | `payment.test.ts` | |
| `GET /checkout-session-status` | `routes/payment.test.ts` | — | |
| `POST /webhook` | `controllers/payment.test.ts` | `stripe-webhook.test.ts` | Signature + idempotency |

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
| PE-6 | Webhook never arrives → reconciliation sweep heals | ✅ |

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

### 1. No real Stripe round-trip — the big one
Every test mocks `stripeService`. Nothing exercises a genuine
`loadStripe → confirmPayment → real webhook → DB` cycle. This is the class of
bug that reached production twice in one day.

Blocked on CI secrets: [`ci.yml`](../../.github/workflows/ci.yml) reads
`secrets.STRIPE_TEST_SECRET_KEY` / `STRIPE_TEST_PUBLISHABLE_KEY`, and **neither
exists** in the repository. GitHub substitutes an empty string for a missing
secret rather than failing, so CI runs payment checks with
`STRIPE_SECRET_KEY=""` and Stripe-dependent paths go inert — silently.

Fix requires both: add the test-mode keys **and** a CI check that fails when
they are absent, so this cannot regress to "green but untested".

### 2. Frontend checkout is mocked end to end
`payment-flow.spec.ts` stubs every API call with `MOCK_PLANS`. No test asserts
Stripe.js loads or that the Pay button ever becomes enabled — which is why a
form that was dead for a merchant looked healthy in CI.

### 3. `payment_intent.payment_failed` ships dormant
Handled in code, never delivered. Enable it on the Stripe webhook endpoint or
the handler is dead code.

### 4. Legacy Checkout Session flow still fully tested
`create-checkout-session` and its lifecycle tests cover a path the app no longer
uses. Decide: delete it, or keep it as a documented fallback. Right now it is
neither — it inflates the apparent coverage of the payment system.

### 5. `npm run lint` is red on `main`
2 errors in `packages/shared/src/utils/validation.ts` (`'URL' is not defined`),
unrelated to payments, but the documented zero-error gate does not pass today.
