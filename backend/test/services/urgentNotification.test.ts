import { describe, it, expect } from 'vitest';
import { isUrgentFlag, buildNotificationReason } from '../../src/services/reply/urgentFlags';

describe('isUrgentFlag', () => {
    it('returns false for undefined', () => {
        expect(isUrgentFlag(undefined)).toBe(false);
    });

    it('returns false for non-urgent flags', () => {
        expect(isUrgentFlag('low_confidence')).toBe(false);
        expect(isUrgentFlag('info_not_in_kb')).toBe(false);
        expect(isUrgentFlag('price_not_in_kb,info_not_in_kb')).toBe(false);
    });

    it('returns true for cancellation_request', () => {
        expect(isUrgentFlag('cancellation_request')).toBe(true);
    });

    it('returns true for refund_request', () => {
        expect(isUrgentFlag('refund_request')).toBe(true);
    });

    it('returns true for exchange_request', () => {
        expect(isUrgentFlag('exchange_request')).toBe(true);
    });

    it('returns true for angry_customer', () => {
        expect(isUrgentFlag('angry_customer')).toBe(true);
    });

    it('returns true when urgent flag is mixed with other flags', () => {
        expect(isUrgentFlag('info_not_in_kb,cancellation_request')).toBe(true);
        expect(isUrgentFlag('angry_customer,low_confidence')).toBe(true);
    });

    it('handles whitespace around flags', () => {
        expect(isUrgentFlag(' cancellation_request , low_confidence ')).toBe(true);
    });
});

describe('buildNotificationReason', () => {
    it('returns default message for undefined flagReason', () => {
        expect(buildNotificationReason(undefined, 'hello')).toBe('AI flagged this reply');
    });

    it('returns raw flagReason for non-urgent flags', () => {
        expect(buildNotificationReason('low_confidence', 'some text')).toBe('low_confidence');
        expect(buildNotificationReason('info_not_in_kb', 'some text')).toBe('info_not_in_kb');
    });

    it('returns snake_case key for cancellation_request', () => {
        expect(buildNotificationReason('cancellation_request', 'الغي الطلب')).toBe('cancellation_request');
    });

    it('returns snake_case key for refund_request', () => {
        expect(buildNotificationReason('refund_request', 'ارجعوا فلوسي')).toBe('refund_request');
    });

    it('returns snake_case key for exchange_request', () => {
        expect(buildNotificationReason('exchange_request', 'ابي ابدل')).toBe('exchange_request');
    });

    it('returns snake_case key for angry_customer', () => {
        expect(buildNotificationReason('angry_customer', 'اسوأ خدمة')).toBe('angry_customer');
    });

    it('extracts order number from message text', () => {
        expect(buildNotificationReason('cancellation_request', 'ابي الغي طلبي رقم 5678'))
            .toBe('cancellation_request — order 5678');
    });

    it('extracts order number with # prefix', () => {
        expect(buildNotificationReason('refund_request', 'refund for #1234 please'))
            .toBe('refund_request — order #1234');
    });

    it('handles message without order number', () => {
        expect(buildNotificationReason('cancellation_request', 'I want to cancel'))
            .toBe('cancellation_request');
    });

    it('picks first urgent flag from comma-separated list', () => {
        expect(buildNotificationReason('info_not_in_kb,refund_request', 'refund please'))
            .toBe('refund_request');
    });

    it('picks first urgent flag when mixed', () => {
        // First urgent flag found in the flags string wins
        expect(buildNotificationReason('cancellation_request,angry_customer', 'الغي طلبي 999'))
            .toBe('cancellation_request — order 999');
    });

    it('does not match short numbers (less than 3 digits)', () => {
        expect(buildNotificationReason('cancellation_request', 'cancel order 12'))
            .toBe('cancellation_request');
    });

    it('does not match long numbers (more than 10 digits)', () => {
        expect(buildNotificationReason('cancellation_request', 'order 12345678901'))
            .toBe('cancellation_request');
    });
});
