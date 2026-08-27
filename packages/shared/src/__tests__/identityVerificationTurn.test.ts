import { describe, it, expect } from 'vitest';
import { isIdentityVerificationTurn, IDENTITY_VERIFICATION_TOOLS, VALID_TOOL_NAMES } from '../ecommerce-tools';

/**
 * The predicate lead capture reads to stay out of an identity-verification turn.
 * Its boundary is the whole point: Phase 2 and the D-101 one-call lookup consume
 * the phone as proof of ownership, Phase 1 does not.
 */
describe('isIdentityVerificationTurn', () => {
    it.each(['verify_and_get_order', 'verify_and_get_shipment'])(
        '%s consumed the phone as an identity claim, whatever the outcome',
        name => {
            expect(isIdentityVerificationTurn([{ name, outcome: 'success' }])).toBe(true);
            // A wrong number is still a claim about an order Phase 1 already found.
            expect(isIdentityVerificationTurn([{ name, outcome: 'verification_failed' }])).toBe(true);
            expect(isIdentityVerificationTurn([{ name }])).toBe(true);
        },
    );

    it('find_order_by_phone counts ONLY when it actually matched an order', () => {
        expect(isIdentityVerificationTurn([{ name: 'find_order_by_phone', outcome: 'success' }])).toBe(true);
    });

    it.each(['order_not_found', 'phone_and_name_required', 'platform_error', undefined])(
        'find_order_by_phone with outcome %s still captures the lead',
        outcome => {
            // It is callable on ANY message, so a failed search is not evidence that
            // the sender is a buyer — suppressing there would drop a genuine lead
            // from someone who typed their name and number to be contacted.
            expect(isIdentityVerificationTurn([{ name: 'find_order_by_phone', outcome }])).toBe(false);
        },
    );

    it.each(['lookup_order', 'track_shipment', 'check_inventory'])(
        '%s does NOT suppress capture — it carries no phone, so a number in that message was volunteered',
        name => {
            expect(isIdentityVerificationTurn([{ name, outcome: 'success' }])).toBe(false);
        },
    );

    it('is false with no tool round at all (template reply, non-store page)', () => {
        expect(isIdentityVerificationTurn(undefined)).toBe(false);
        expect(isIdentityVerificationTurn([])).toBe(false);
    });

    it('finds the verifier anywhere in a multi-tool round', () => {
        expect(isIdentityVerificationTurn([
            { name: 'check_inventory', outcome: 'success' },
            { name: 'verify_and_get_shipment', outcome: 'success' },
        ])).toBe(true);
    });

    it('every listed tool is a real tool name', () => {
        // A typo here would silently disable the suppression for that tool.
        for (const name of IDENTITY_VERIFICATION_TOOLS) {
            expect(VALID_TOOL_NAMES).toContain(name);
        }
    });
});
