import { describe, it, expect } from 'vitest';
import {
    KNOWN_NOTIFICATION_TYPES,
    isKnownNotificationType,
} from '@/components/analytics/notificationTypes';

describe('notificationTypes', () => {
    describe('KNOWN_NOTIFICATION_TYPES', () => {
        it('matches the i18n catalog keys (canonical list)', () => {
            // If a new type is added to byType.* in i18n/{en,ar}/ecommerceAnalytics.json,
            // it must also land here so the UI translates it. This test is the
            // contract between the JSON and the runtime allowlist.
            expect(KNOWN_NOTIFICATION_TYPES).toEqual([
                'abandoned_cart',
                'order_confirmed',
                'order_shipped',
                'order_delivered',
                'review_request',
                'digital_delivery',
            ]);
        });
    });

    describe('isKnownNotificationType', () => {
        it('returns true for every catalog entry', () => {
            for (const t of KNOWN_NOTIFICATION_TYPES) {
                expect(isKnownNotificationType(t)).toBe(true);
            }
        });

        it('returns false for an unknown future type', () => {
            expect(isKnownNotificationType('abandoned_cart_v2')).toBe(false);
            expect(isKnownNotificationType('whatsapp_template_x')).toBe(false);
        });

        it('returns false for empty string', () => {
            expect(isKnownNotificationType('')).toBe(false);
        });
    });
});
