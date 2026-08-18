/**
 * Verify the GA4 Measurement Protocol wiring end-to-end.
 *
 * WHY THIS EXISTS. The production MP endpoint answers **204 for a malformed
 * event just as readily as for a good one** — wrong event name, wrong parameter,
 * unknown measurement id, all 204. So a green production log line proves the
 * bytes were accepted and NOTHING about whether GA4 recorded anything. The only
 * instrument that reports the truth is GA4's `/debug/mp/collect` endpoint, which
 * returns a `validationMessages` array. This script drives it.
 *
 * Usage (from backend/, with GA4_MEASUREMENT_ID + GA4_API_SECRET in the env):
 *
 *   npm run verify:ga4 -- <ga_client_id> [event_name]
 *
 * Get a real <ga_client_id> from a browser on jawab24.com:
 *   document.cookie.match(/_ga=GA\d+\.\d+\.(\d+\.\d+)/)[1]
 *
 * A validated event with a REAL client id is also the fastest way to answer the
 * question the Google Ads account actually asks — "has this conversion action
 * ever received anything?" — without waiting for an organic signup. Send one,
 * then look for it in GA4 Realtime, then mark it a key event and import it into
 * Ads as a conversion.
 *
 * `--live` sends to the real endpoint instead of the debug one. Use it only
 * after the debug pass comes back clean; the event WILL appear in the property.
 */
import 'dotenv/config';
import { config } from '../src/config';
import { sendGa4Event } from '../src/services/ga4';

async function main() {
    const [clientId, eventName = 'sign_up'] = process.argv.slice(2).filter(a => a !== '--live');
    const live = process.argv.includes('--live');

    if (!clientId) {
        console.error('Usage: npm run verify:ga4 -- <ga_client_id> [event_name] [--live]');
        console.error('Get a client id in a browser console on jawab24.com:');
        console.error('  document.cookie.match(/_ga=GA\\d+\\.\\d+\\.(\\d+\\.\\d+)/)[1]');
        process.exit(1);
    }

    if (!config.ga4.measurementId || !config.ga4.apiSecret) {
        console.error('GA4 is not configured — set GA4_MEASUREMENT_ID and GA4_API_SECRET.');
        console.error('With either missing, the whole integration deliberately no-ops.');
        process.exit(1);
    }

    console.log(`measurement id : ${config.ga4.measurementId}`);
    console.log(`client id      : ${clientId}`);
    console.log(`event          : ${eventName}`);
    console.log(`endpoint       : ${live ? 'LIVE /mp/collect' : 'debug /debug/mp/collect'}\n`);

    const result = await sendGa4Event(clientId, eventName, {}, { debug: !live });

    if (live) {
        // Deliberately blunt: a 204 here is NOT evidence the event was recorded.
        console.log(result.sent
            ? 'Accepted (204). This proves transport ONLY — confirm in GA4 Realtime.'
            : `Not sent — reason: ${result.reason}`);
        return;
    }

    const messages = result.validationMessages ?? [];
    if (messages.length === 0) {
        console.log('✅ No validation messages — the payload is well-formed.');
        console.log('   Re-run with --live to send it for real, then check GA4 Realtime.');
        return;
    }

    console.log('❌ GA4 rejected the payload:\n');
    for (const message of messages) console.log(JSON.stringify(message, null, 2));
    process.exitCode = 1;
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
