/**
 * Drift detection: each adapter's `getWebhookTopics()` must match the
 * source-of-truth constant in the corresponding service module.
 *
 * Without this test, adding a webhook topic to a service constant and
 * forgetting the adapter copy silently breaks the integrations UI and any
 * code that consults `adapter.getWebhookTopics()` (validation, dashboards,
 * the webhook-health summary).
 */
import { describe, it, expect } from 'vitest';
import { ShopifyIntegration } from '../../src/integrations/shopify';
import { SallaIntegration } from '../../src/integrations/salla';
import { ZidIntegration } from '../../src/integrations/zid';
import { SALLA_WEBHOOK_EVENTS } from '../../src/services/salla';
import { ZID_WEBHOOK_EVENTS } from '../../src/services/zid';

describe('webhook topic drift', () => {
    it('Salla adapter topics match SALLA_WEBHOOK_EVENTS', () => {
        const adapter = new SallaIntegration();
        expect([...adapter.getWebhookTopics()]).toEqual([...SALLA_WEBHOOK_EVENTS]);
    });

    it('Zid adapter topics match ZID_WEBHOOK_EVENTS', () => {
        const adapter = new ZidIntegration();
        expect([...adapter.getWebhookTopics()]).toEqual([...ZID_WEBHOOK_EVENTS]);
    });

    it('Shopify adapter exposes the topics it actually subscribes to', () => {
        // Shopify's source-of-truth list lives inside the registerWebhooks
        // function body (each entry pairs a topic with a delivery URL), so
        // there is no exported constant to compare against. Pin the expected
        // list here — if registerWebhooks gains/loses a topic, both this list
        // and the adapter constant must be updated, and that combined diff
        // is the review checkpoint.
        const adapter = new ShopifyIntegration();
        expect([...adapter.getWebhookTopics()]).toEqual([
            'app/uninstalled',
            'products/create',
            'products/update',
            'products/delete',
            'orders/create',
            'orders/updated',
            'orders/fulfilled',
            'orders/cancelled',
        ]);
    });
});
