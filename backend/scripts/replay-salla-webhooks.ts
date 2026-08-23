/**
 * Replay the Salla ORDER webhooks for one order — the Tier-3 rehearsal rows 3.5–3.7
 * (docs/SALLA_TEST_PLAN.md) when Salla itself cannot fire them.
 *
 * Why this exists (2026-08-23): a Development-status Salla app installs on demo stores
 * only, and a demo store cannot produce an order — the storefront refuses checkout
 * («لا يمكنك انهاء الطلب من متجر المعاينة»), admin-created orders stay Draft and fire
 * nothing, and the maintenance setting that would explain it does not exist (404). So
 * the order → SMS path had never been exercised against the deployed build.
 *
 * What it proves, and what it does NOT:
 *   ✅ our side, end to end, on the real deployment: HMAC check, envelope parse, phone
 *      normalisation, template render, the (store, type, event) dedup index, the 5-minute
 *      grace on a tracking-less `shipped`, and the in-place upgrade by `shipment.created`.
 *   ❌ Salla's delivery. The payload shapes are the REAL captures from the demo store on
 *      2026-06-07 (backend/test/controllers/salla.test.ts, "Phase 4.2 regression"), but a
 *      replay is still a replay. Record results as "code path PASS, delivery shape
 *      assumed (replay)" — never as a Salla delivery.
 *
 * Usage (secret from the environment ONLY — never an argument, never printed):
 *   SALLA_WEBHOOK_SECRET=… npx tsx backend/scripts/replay-salla-webhooks.ts --dry-run
 *   SALLA_WEBHOOK_SECRET=… npx tsx backend/scripts/replay-salla-webhooks.ts --step all
 *   SALLA_WEBHOOK_SECRET=… npx tsx backend/scripts/replay-salla-webhooks.ts --step shipment --order 815530083
 *
 * Flags:
 *   --base      https://jawab24.com            (no /api — the webhook is mounted at the root)
 *   --merchant  2108580704                     (Salla merchant id of the connected store)
 *   --order     <numeric>                      (order id; default: a fresh one from the clock)
 *   --ref       <numeric>                      (reference_id shown to the customer; default: derived)
 *   --phone     +971555555555                  (Salla's own demo-fixture number — never a real person)
 *   --name      "abc def"
 *   --tracking  REPLAY-<order>   --courier Aramex
 *   --step      created | shipped | shipment | all   (default all, in that order)
 *   --repeat-created                            send order.created TWICE (the dedup check — 3.5)
 *   --wait      0                               seconds between steps (3.7 must land inside the 5-min grace)
 *   --dry-run                                   print the bodies, sign nothing, send nothing
 *
 * Then read the log at the READ path, not at the webhook:
 *   ./scripts/prod-db-query.sh "SELECT notification_type, platform_event_id, status, scheduled_at,
 *     message_sent FROM customer_notifications_log WHERE platform_event_id LIKE 'salla:%<order>'
 *     ORDER BY created_at;"
 * Expect exactly ONE order_confirmed row and exactly ONE order_shipped row whose
 * message_sent carries the tracking number after the shipment step.
 */
import crypto from 'crypto';

type Step = 'created' | 'shipped' | 'shipment';

function arg(name: string, fallback?: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1) return fallback;
    const v = process.argv[i + 1];
    return v && !v.startsWith('--') ? v : fallback;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const BASE = (arg('base', 'https://jawab24.com') as string).replace(/\/$/, '');
const MERCHANT = Number(arg('merchant', '2108580704'));
const ORDER_ID = Number(arg('order', String(Math.floor(Date.now() / 1000))));
const REFERENCE_ID = Number(arg('ref', String(200000000 + (ORDER_ID % 100000000))));
const PHONE = arg('phone', '+971555555555') as string;
const NAME = arg('name', 'abc def') as string;
const TRACKING = arg('tracking', `REPLAY-${ORDER_ID}`) as string;
const COURIER = arg('courier', 'Aramex') as string;
const STEP = arg('step', 'all') as Step | 'all';
const WAIT_SECONDS = Number(arg('wait', '0'));
const DRY_RUN = flag('dry-run');
const REPEAT_CREATED = flag('repeat-created');

const SECRET = process.env.SALLA_WEBHOOK_SECRET;

// Shapes: backend/test/controllers/salla.test.ts — real captures, 2026-06-07.
// order.created: flat order, split mobile + mobile_code, status as an object.
// order.status.updated: order nested under data.order, slug under data.customized.
// order.shipment.created: data IS the shipment — ship_to.phone, top-level tracking.
const mobileCode = PHONE.match(/^\+\d{1,3}/)?.[0] ?? '+966';
const mobile = Number(PHONE.replace(mobileCode, ''));
const firstName = NAME.split(/\s+/)[0];

const BODIES: Record<Step, Record<string, unknown>> = {
    created: {
        event: 'order.created', merchant: MERCHANT,
        created_at: new Date().toISOString(),
        data: {
            id: ORDER_ID, reference_id: REFERENCE_ID,
            status: { slug: 'payment_pending', name: 'بإنتظار الدفع' },
            customer: { first_name: firstName, mobile, mobile_code: mobileCode },
            amounts: { sub_total: { amount: 94, currency: 'SAR' }, total: { amount: 94, currency: 'SAR' } },
            currency: 'SAR',
        },
    },
    shipped: {
        event: 'order.status.updated', merchant: MERCHANT,
        created_at: new Date().toISOString(),
        data: {
            status: 'تم الشحن',
            customized: { slug: 'shipped', name: 'تم الشحن' },
            order: { id: ORDER_ID, reference_id: REFERENCE_ID, customer: { name: NAME, mobile: PHONE } },
        },
    },
    shipment: {
        event: 'order.shipment.created', merchant: MERCHANT,
        created_at: new Date().toISOString(),
        data: {
            id: ORDER_ID + 1, type: 'shipment',
            order_id: ORDER_ID, order_reference_id: REFERENCE_ID,
            tracking_number: TRACKING, courier_name: COURIER,
            ship_to: { name: NAME, phone: PHONE.replace('+', '') },
        },
    },
};

async function post(step: Step): Promise<void> {
    const body = JSON.stringify(BODIES[step]);
    console.log(`\n→ ${step}  (${(BODIES[step] as { event: string }).event})`);
    if (DRY_RUN) {
        console.log(body);
        return;
    }
    if (!SECRET) {
        console.error('SALLA_WEBHOOK_SECRET is not set — refusing to send an unsigned replay.');
        process.exit(2);
    }
    // Same construction the controller verifies: hex HMAC-SHA256 of the raw body.
    const signature = crypto.createHmac('sha256', SECRET).update(body, 'utf8').digest('hex');
    const res = await fetch(`${BASE}/salla/webhooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Salla-Signature': signature, 'User-Agent': 'jawab24-replay-harness' },
        body,
    });
    const text = await res.text();
    console.log(`  ${res.status} ${text.slice(0, 200)}`);
    if (res.status === 401) {
        console.error('  401 = the secret in this shell does not match the one the server verifies with (Tier 0.8).');
        process.exit(1);
    }
}

const sleep = (s: number) => new Promise(r => setTimeout(r, s * 1000));

(async () => {
    console.log(`Salla order-webhook replay → ${BASE}/salla/webhooks`);
    console.log(`merchant ${MERCHANT} · order ${ORDER_ID} (ref ${REFERENCE_ID}) · ${NAME} ${PHONE} · tracking ${TRACKING}${DRY_RUN ? ' · DRY RUN' : ''}`);

    const steps: Step[] = STEP === 'all' ? ['created', 'shipped', 'shipment'] : [STEP];
    for (const step of steps) {
        await post(step);
        if (step === 'created' && REPEAT_CREATED) {
            console.log('  (re-delivery of the same event — the dedup index must swallow it)');
            await post('created');
        }
        if (WAIT_SECONDS > 0 && step !== steps[steps.length - 1]) await sleep(WAIT_SECONDS);
    }

    console.log(`\nRead the result at the READ path:
  ./scripts/prod-db-query.sh "SELECT notification_type, platform_event_id, status, scheduled_at, error_message, message_sent FROM customer_notifications_log WHERE platform_event_id IN ('salla:order_confirmed:${ORDER_ID}','salla:order_shipped:${ORDER_ID}') ORDER BY created_at;"
Pass = ONE order_confirmed row, ONE order_shipped row with '${TRACKING}' in message_sent. A 'failed' status with a Vonage error is the provider, not the path.`);
})().catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
