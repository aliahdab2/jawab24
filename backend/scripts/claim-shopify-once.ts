import { claimPendingInstall } from '../src/services/shopify';

const PENDING_ID = 'fa35fa2b-2fff-44f6-8c07-88fd3ef520dc';
const DEMO_USER_ID = '8b5d4782-e30e-48ca-8314-d9373b258ba8';

(async () => {
    try {
        const store = await claimPendingInstall(PENDING_ID, DEMO_USER_ID);
        if (!store) {
            console.error('CLAIM FAILED: pending install not found, expired, or platform mismatch');
            process.exit(1);
        }
        console.log('CLAIM SUCCESS:');
        console.log(JSON.stringify({
            id: store.id,
            storeDomain: store.storeDomain,
            workspaceId: store.workspaceId,
            isActive: store.isActive,
            productCount: store.productCount,
        }, null, 2));
    } catch (err) {
        console.error('CLAIM ERROR:', err instanceof Error ? err.message : String(err));
        process.exit(1);
    } finally {
        process.exit(0);
    }
})();
