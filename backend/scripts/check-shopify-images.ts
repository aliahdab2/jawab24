/**
 * One-off: verify whether jawab24-demo products have featuredImage set in Shopify
 * directly via the Admin GraphQL API. Used to resolve test plan finding A-1.6
 * (synced products all have imageUrl: null — is that a sync bug or just data?).
 */
import { db } from '../src/db';
import { ecommerceStores } from '../src/db/schema';
import { eq, and } from 'drizzle-orm';
import { decrypt } from '../src/services/ecommerceCrypto';
import { SHOPIFY_API_VERSION } from '../src/services/shopify';
import axios from 'axios';

const STORE_DOMAIN = 'jawab24-demo.myshopify.com';

(async () => {
    try {
        const [store] = await db.select()
            .from(ecommerceStores)
            .where(and(
                eq(ecommerceStores.storeDomain, STORE_DOMAIN),
                eq(ecommerceStores.platform, 'shopify'),
            ))
            .limit(1);

        if (!store) {
            console.error('No store row found for', STORE_DOMAIN);
            process.exit(1);
        }

        const accessToken = decrypt(store.accessToken, store.accessTokenIv);

        const query = `{
            products(first: 5, query: "status:active") {
                edges {
                    node {
                        id
                        title
                        featuredImage { url altText }
                        images(first: 3) { edges { node { url } } }
                    }
                }
            }
        }`;

        const res = await axios.post(
            `https://${STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
            { query },
            { headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' } },
        );

        const products = res.data?.data?.products?.edges ?? [];
        if (!products.length) {
            console.log('SHOPIFY RETURNED ZERO PRODUCTS');
            process.exit(0);
        }

        console.log('SHOPIFY GraphQL response (first 5 products):');
        for (const edge of products) {
            const p = edge.node;
            const featured = p.featuredImage?.url ?? null;
            const imageCount = p.images?.edges?.length ?? 0;
            console.log(`  ${p.title}`);
            console.log(`    featuredImage.url: ${featured ?? '(null)'}`);
            console.log(`    images count: ${imageCount}`);
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
