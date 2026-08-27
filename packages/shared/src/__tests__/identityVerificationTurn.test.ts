import { describe, it, expect } from 'vitest';
import { isIdentityVerificationTurn, IDENTITY_VERIFICATION_TOOLS, VALID_TOOL_NAMES } from '../ecommerce-tools';

/**
 * The predicate lead capture reads to stay out of an identity-verification turn.
 * Its boundary is the whole point: Phase 2 and the D-101 one-call lookup consume
 * the phone as proof of ownership, Phase 1 does not.
 */
describe('isIdentityVerificationTurn', () => {
    it.each(IDENTITY_VERIFICATION_TOOLS)('%s consumed the phone as an identity claim', name => {
        expect(isIdentityVerificationTurn([{ name }])).toBe(true);
    });

    it.each(['lookup_order', 'track_shipment', 'check_inventory'])(
        '%s does NOT suppress capture — it carries no phone, so a number in that message was volunteered',
        name => {
            expect(isIdentityVerificationTurn([{ name }])).toBe(false);
        },
    );

    it('is false with no tool round at all (template reply, non-store page)', () => {
        expect(isIdentityVerificationTurn(undefined)).toBe(false);
        expect(isIdentityVerificationTurn([])).toBe(false);
    });

    it('finds the verifier anywhere in a multi-tool round', () => {
        expect(isIdentityVerificationTurn([
            { name: 'check_inventory' },
            { name: 'verify_and_get_shipment' },
        ])).toBe(true);
    });

    it('every listed tool is a real tool name', () => {
        // A typo here would silently disable the suppression for that tool.
        for (const name of IDENTITY_VERIFICATION_TOOLS) {
            expect(VALID_TOOL_NAMES).toContain(name);
        }
    });
});
