/**
 * One-off: list registered webhooks on the jawab24-demo store + (re)register if missing.
 * Resolves test plan finding: B-3 webhook didn't fire because the post-claim
 * registerWebhooks promise was killed before completing (script process.exit
 * raced the async HTTP call). In long-lived backend processes this is fine,
 * but our claim script ran to completion in <500ms.
 */
import { db } from '../src/db';
import { ecommerceStores } from '../src/db/schema';
import { eq, and } from 'drizzle-orm';
import { decrypt } from '../src/services/ecommerceCrypto';
import { registerWebhooks, saveWebhookStatus } from '../src/services/shopify';
import axios from 'axios';

const STORE_DOMAIN = 'jawab24-demo.myshopify.com';

(async () => {
    try {
        const [store] = await db.select()
            .from(ecommerceStores)
            .where(and(eq(ecommerceStores.storeDomain, STORE_DOMAIN), eq(ecommerceStores.platform, 'shopify')))
            .limit(1);
        if (!store) { console.error('No store row found'); process.exit(1); }
        const accessToken = decrypt(store.accessToken, store.accessTokenIv);

        // 1. List current webhooks on Shopify
        const list = await axios.get(
            `https://${STORE_DOMAIN}/admin/api/2025-01/webhooks.json`,
            { headers: { 'X-Shopify-Access-Token': accessToken } },
        );
        const existing = list.data?.webhooks ?? [];
        console.log(`SHOPIFY currently has ${existing.length} webhook(s) registered:`);
        for (const wh of existing) {
            console.log(`  ${wh.topic} → ${wh.address}`);
        }
        console.log('');

        // 2. Re-register all expected topics — AWAITED this time
        console.log('Calling registerWebhooks() and AWAITING completion...');
        const result = await registerWebhooks(STORE_DOMAIN, accessToken);
        if (result) {
            console.log('REGISTRATION RESULT:');
            console.log(`  Registered (${result.registered.length}): ${result.registered.join(', ')}`);
            console.log(`  Failed (${result.failed.length}): ${JSON.stringify(result.failed)}`);
            console.log(`  Last attempt: ${result.lastAttempt}`);

            await saveWebhookStatus(store.id, result);
            console.log('Status saved to platform_data.webhookStatus');
        }

        // 3. List again to confirm
        const list2 = await axios.get(
            `https://${STORE_DOMAIN}/admin/api/2025-01/webhooks.json`,
            { headers: { 'X-Shopify-Access-Token': accessToken } },
        );
        const final = list2.data?.webhooks ?? [];
        console.log(`\nSHOPIFY now has ${final.length} webhook(s) registered:`);
        for (const wh of final) {
            console.log(`  ${wh.topic} → ${wh.address}`);
        }
    } catch (err) {
        console.error('ERROR:', err instanceof Error ? err.message : String(err));
        if (axios.isAxiosError(err) && err.response) {
            console.error('Shopify response:', JSON.stringify(err.response.data, null, 2));
        }
        process.exit(1);
    } finally {
        process.exit(0);
    }
})();
