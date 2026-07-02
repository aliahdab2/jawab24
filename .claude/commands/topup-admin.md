Admin operations on Smart Reply top-up credits in the PRODUCTION database: inspect a user's balance/ledger, credit a pack, reverse a miscredited top-up, or move a payment record to the right account.

Arguments: $ARGUMENTS (e.g. "inspect user@x.com", "reverse the 10k I added to user@x.com", "move payment to user@y.com")

## Data model (backend/src/db/schema.ts)

- `users.topup_balance` — non-expiring reply credit balance (integer).
- `topup_purchases` — the ledger. Each `succeeded` row incremented the balance by `replies_added`. Status flow: `pending → succeeded → refunded`. Sources: `stripe` / `manual` / `admin`.
- `payment_requests` — admin-generated "collect $X" Stripe links. **Money-side only: never touches balances.** Optional `topup_purchase_id` links a paid request to the grant it billed.
- Reversal code exists ONLY for Stripe rows (`reverseStripeTopup` by PaymentIntent). Manual/admin credits have no service-level reverse — reversal is done by guarded SQL that mirrors the service semantics (see below).

## Prod access

SSH to the prod server and pipe SQL over stdin into the Postgres container. The container's own env has `POSTGRES_USER`/`POSTGRES_DB` — do NOT source the server `.env`, do NOT use `-U root`:

```bash
cat <<'SQL' | ssh -i ~/.ssh/id_jawab24_deploy root@91.99.95.196 \
  'docker exec -i jawab24-postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1"'
-- statements here
SQL
```

## Safety rules (always)

1. **Read before write.** Show the user rows, balances, and timestamps and confirm they match the described mistake before mutating anything.
2. **Never DELETE ledger rows.** Reversal = mark `refunded`, keep the row.
3. **One transaction** for multi-statement mutations, with guarded `WHERE` clauses (`AND status = 'succeeded'` etc.) and `RETURNING` on every statement so 0-row matches are visible.
4. **Leave an audit note** in `external_ref` explaining what happened and where the credit went.
5. **Verify after commit** by re-querying both accounts.
6. Check whether a `payment_requests` row was created alongside the mistaken credit (admin flow often creates the collect link seconds after the grant) — the money record may need moving too.

## Operations

### 1. Inspect

```sql
SELECT id, email, topup_balance FROM users WHERE email IN ('<a>', '<b>');
SELECT id, pack, replies_added, price_cents, source, external_ref, status, created_at, refunded_at
FROM topup_purchases WHERE user_id = '<uuid>' ORDER BY created_at DESC;
SELECT id, amount_cents, status, topup_purchase_id, created_at
FROM payment_requests WHERE user_id = '<uuid>' ORDER BY created_at DESC;
```

### 2. Credit a pack (the right way)

Prefer `POST /admin/topup` (admin UI) — it writes `admin_audit_logs`. Fallback CLI (no audit log):
`npx tsx backend/scripts/credit-topup.ts --user=<uuid> --pack=<5k|10k> --ref="..." --note="..."`
Never credit by raw SQL when these paths work.

### 3. Reverse a miscredited manual/admin top-up

Mirrors `reverseStripeTopup` semantics — flip to `refunded` + claw back the balance, atomically. The CTE guard makes the decrement happen only if the status flip matched:

```sql
BEGIN;
WITH flipped AS (
    UPDATE topup_purchases
    SET status = 'refunded', refunded_at = now(),
        external_ref = '<original ref> - miscredited, moved to <correct email> <date>'
    WHERE id = '<purchase-uuid>' AND status = 'succeeded'
    RETURNING user_id, replies_added
)
UPDATE users u
SET topup_balance = u.topup_balance - f.replies_added, updated_at = now()
FROM flipped f WHERE u.id = f.user_id
RETURNING u.email, u.topup_balance;
COMMIT;
```

Balance may legitimately go negative if some replies were already consumed — that is intentional anti-abuse (see schema comment). If the correct account still needs the credit, use operation 2 — never re-point the old row's `user_id`.

### 4. Move a paid payment request to the right account

Money-side only; safe to re-home. Link it to the grant it actually billed:

```sql
UPDATE payment_requests
SET user_id = '<correct-user-uuid>', topup_purchase_id = '<their-grant-uuid>', updated_at = now()
WHERE id = '<request-uuid>' AND user_id = '<wrong-user-uuid>' AND status = 'paid'
RETURNING id, user_id, amount_cents, status, topup_purchase_id;
```

## Context

Manual 10k grants typically pair with a $55 `payment_requests` collect link (7900¢ list price on the ledger row). Precedent: 2026-07-02 — 10k miscredited to zolfakarmkya940@gmail.com, reversed with this recipe and the paid $55 request moved to nourvacare@gmail.com.
