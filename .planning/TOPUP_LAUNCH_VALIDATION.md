# Top-up (card) — Stripe TEST-mode launch validation

**Hard gate before charging real cards.** This proves the *real* Stripe payloads
match what our handlers assume — the class of bug unit tests can't catch (mocks
return what we tell them). Run it end-to-end in **Stripe TEST mode** with test
keys. Do NOT touch live keys.

> Branch: `test23` (PR #241). Backend webhook path: `POST http://localhost:3000/payment/webhook`.
> Card top-up is gated by `TOPUP_ENABLED` (default OFF). For this proof set it `true` locally.

---

## 0. Prerequisites (one-time)

- [ ] Stripe **test** keys in `backend/.env`: `STRIPE_SECRET_KEY=sk_test_…`, `STRIPE_PUBLISHABLE_KEY=pk_test_…` (frontend: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_…`).
- [ ] `TOPUP_ENABLED=true` in `backend/.env` (the kill-switch — off by default).
- [ ] Test packs exist in Stripe **or** rely on inline `priceCents` from `config.topup.packs` (5k=$49, 10k=$79). No Stripe Product is needed — the PaymentIntent uses an inline amount.
- [ ] Stripe CLI installed + logged in: `stripe login`.
- [ ] Local backend (3000), ai-worker, frontend (3001), local Postgres running.

Helper — set your DB URL once for the SQL checks below:
```bash
export PSQL='psql postgres://aliahdab@localhost:5432/postgres -At -c'
```

---

## 1. Start the webhook forwarder + capture the signing secret

```bash
stripe listen --forward-to localhost:3000/payment/webhook
```
- Copy the `whsec_…` it prints into `backend/.env` as `STRIPE_WEBHOOK_SECRET=whsec_…`.
- **Restart the backend** so it picks up the secret (and `TOPUP_ENABLED=true`).
- Leave `stripe listen` running in its own terminal for every scenario below.

> Why this matters: commit `7ca4ab8d` makes the backend **refuse to boot in prod**
> if `STRIPE_SECRET_KEY` is set without `STRIPE_WEBHOOK_SECRET`. In dev it boots,
> but webhooks won't verify without the secret — so this step is mandatory.

---

## Scenario A — Happy path: credited exactly once

1. Log in at `http://localhost:3001`, then open `/checkout?topup=5k`.
2. Pay with success card **`4242 4242 4242 4242`**, any future expiry / any CVC / any ZIP.
3. Watch the `stripe listen` terminal: expect `payment_intent.succeeded → [200]`.

**Assert (SQL):**
```bash
# the top-up row should be 'succeeded' with a PI id, exactly one row for this PI
$PSQL "select status, source, replies_added, stripe_payment_intent_id from topup_purchases order by created_at desc limit 3;"
# balance credited by exactly 5000 (compare before/after)
$PSQL "select topup_balance from users where id = '<YOUR_USER_ID>';"
```
- [ ] Row `status='succeeded'`, `source='stripe'`, `replies_added=5000`.
- [ ] `topup_balance` increased by **exactly 5000** (not 0, not 10000).
- [ ] Record the PI id (`pi_…`) — call it **PI_A** for the next scenario.

> Idempotency spot-check (optional): in the Stripe CLI run
> `stripe events resend <evt_id>` for the succeeded event → balance must NOT change
> again (replay is a no-op via the `status='pending'` settle gate).

---

## Scenario B — Refund after credit claws the credits back

Refund the **actual** PI from Scenario A (do NOT use `stripe trigger charge.refunded`
— that emits an unrelated charge with no top-up row, so nothing would reverse):

```bash
stripe refunds create --payment-intent PI_A
```
Expect `charge.refunded → [200]` in `stripe listen`.

**Assert:**
- [ ] `topup_purchases` row for PI_A is now `status='refunded'`, `refunded_at` set.
- [ ] `topup_balance` **decreased by 5000** (back to the pre-A value, floored at 0).
- [ ] Re-running the same refund webhook (`stripe events resend`) does **not** decrement again (idempotent).

---

## Scenario C — Dispute (chargeback) revokes credits

Do a **fresh** top-up to get a disputable charge:
1. `/checkout?topup=5k`, pay with the **dispute** card **`4000 0000 0000 0259`** (charge succeeds, then Stripe auto-opens a dispute).
2. Confirm Scenario-A-style crediting first (`payment_intent.succeeded`), then wait for `charge.dispute.created → [200]`.

**Assert:**
- [ ] On `charge.dispute.created`, the row flips to `refunded` and `topup_balance` is decremented (credits revoked).
- [ ] (Documented behavior) winning the dispute does NOT auto re-credit — that's a manual `/admin/topup` grant.

---

## Scenario D — Missed webhook self-heals (the reason this PR exists)

Simulate a dropped `payment_intent.succeeded` and prove the reconciliation sweep recovers it.

1. Temporarily stop forwarding the success event: in a **second** terminal run a filtered listener that omits it, e.g.
   ```bash
   # forward everything EXCEPT payment_intent.succeeded
   stripe listen --forward-to localhost:3000/payment/webhook \
     --events payment_intent.payment_failed,charge.refunded,charge.dispute.created
   ```
   (Stop the all-events listener from step 1 while doing this scenario.)
2. `/checkout?topup=10k`, pay with `4242 4242 4242 4242`. The charge succeeds at Stripe, but the backend never gets `payment_intent.succeeded` → the row stays `pending`.
   - [ ] Confirm: `topup_purchases` row `status='pending'`, balance unchanged.
3. Run the sweep immediately (bypass the 5-min age window) with a one-off script:
   ```bash
   cd backend && export $(grep -v '^#' .env | xargs) && npx tsx -e "import('./src/services/topup').then(async m => { console.log(await m.topupService.reconcileStripeTopups({ olderThanMinutes: 0 })); process.exit(0); })"
   ```
   - [ ] Output shows `credited: 1`; row now `succeeded`; `topup_balance` +10000 **once**.
4. **Refunded-while-pending must NOT credit:** repeat steps 2–3 but, before running the sweep, refund the PI (`stripe refunds create --payment-intent pi_…`). The sweep must report `refunded: 1`, `credited: 0`, and leave the balance unchanged.
   - [ ] Verified: a refunded-while-pending PI is marked `refunded`, never credited.

Restore the full `stripe listen` (all events) afterward.

---

## Scenario E — Kill-switch actually disables charging

1. Set `TOPUP_ENABLED=false` in `backend/.env`, recreate/restart the backend.
2. Direct-hit the endpoint:
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/payment/create-topup-intent \
     -H 'Authorization: Bearer <USER_JWT>' -H 'content-type: application/json' -d '{"pack":"5k"}'
   ```
   - [ ] Returns **403** (`code: TOPUP_DISABLED`); no PaymentIntent created in Stripe.
3. UI: the "Add replies" modal shows **no "Pay with card"** link; `/checkout?topup=5k` shows the "temporarily unavailable" message and makes no intent call.
4. Set back to `TOPUP_ENABLED=true` + restart for any further testing.

---

## Scenario F — Prices match

- [ ] Stripe receipt / PaymentIntent amount = **$49.00** for 5k and **$79.00** for 10k, currency **USD** — matching `config.topup.packs`.

---

## Production webhook endpoint config (when going live)

In the Stripe **live** Dashboard → Developers → Webhooks, the `https://jawab24.com/payment/webhook`
endpoint must subscribe to (top-up adds the last two):
- `checkout.session.completed`
- `customer.subscription.created` / `.updated` / `.deleted`
- `invoice.payment_succeeded` / `invoice.payment_failed`
- `payment_intent.succeeded` / `payment_intent.payment_failed`
- **`charge.refunded`**
- **`charge.dispute.created`**

Copy the endpoint's **live** signing secret into the server's `STRIPE_WEBHOOK_SECRET`.

---

## Go-live checklist

- [ ] Scenarios A–F all pass in TEST mode.
- [ ] Live webhook endpoint subscribes to all events above (incl. refund + dispute).
- [ ] Live `STRIPE_WEBHOOK_SECRET` set on the server (backend boots — proves it's present).
- [ ] Deploy with `TOPUP_ENABLED=false` (feature dark, safety infra live).
- [ ] Flip `TOPUP_ENABLED=true` via env + `docker-compose up -d --force-recreate` (per the env-reload rule); verify the reconcile cron logs start and `credited>0` Sentry telemetry is wired.
- [ ] Restore prod Stripe creds + `SHOPIFY_HOST_NAME=jawab24.com` etc. if you swapped any local env.
- [ ] Kill-switch rehearsed: flipping `TOPUP_ENABLED=false` stops charging with no redeploy.
