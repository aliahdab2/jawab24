/**
 * CI guard for the e-commerce order tools' SCOPING.
 *
 * Why this test exists: on a store-linked page the model has order-lookup tools,
 * and with unscoped descriptions it treated ANY "when will it arrive" phrasing as
 * a specific-order request — replying «ممكن تعطيني رقم الطلب؟» instead of answering
 * the shipping window from [store_policies]. That silently broke eval #46
 * (Shopify policiesSummary "توصيل: 2-3 أيام عمل داخل الرياض" never quoted).
 *
 * The fix is the description wording itself, so a refactor that drops the scoping
 * must fail here rather than only in the manual playground eval.
 */
import { describe, it, expect } from 'vitest';
import { ECOMMERCE_TOOLS } from '../src/services/ecommerceToolHandler';

function descriptionOf(name: string): string {
    const tool = ECOMMERCE_TOOLS.find(t => t.type === 'function' && t.function.name === name);
    if (!tool || tool.type !== 'function') throw new Error(`tool ${name} not found`);
    return tool.function.description ?? '';
}

describe('e-commerce order tools are scoped to a SPECIFIC order', () => {
    for (const name of ['lookup_order', 'track_shipment']) {
        it(`${name} restricts itself to a specific existing order`, () => {
            expect(descriptionOf(name)).toMatch(/SPECIFIC/);
        });

        it(`${name} redirects GENERAL delivery/shipping questions to the store policies`, () => {
            const d = descriptionOf(name);
            // must tell the model NOT to use the tool for general questions...
            expect(d).toMatch(/Do NOT use it for a GENERAL question/);
            // ...and where to answer them from instead
            expect(d).toContain('[store_policies]');
        });
    }

    it('keeps the identity-verification contract (Phase 1 → Phase 2 handoff)', () => {
        // scoping must not have dropped the verification challenge wording
        expect(descriptionOf('lookup_order')).toMatch(/verify_and_get_order/);
        expect(descriptionOf('track_shipment')).toMatch(/verify_and_get_shipment/);
    });
});
