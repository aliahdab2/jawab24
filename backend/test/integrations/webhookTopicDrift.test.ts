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
import { SHOPIFY_WEBHOOK_EVENTS } from '../../src/services/shopify';

describe('webhook topic drift', () => {
    it('Salla adapter topics match SALLA_WEBHOOK_EVENTS', () => {
        const adapter = new SallaIntegration();
        expect([...adapter.getWebhookTopics()]).toEqual([...SALLA_WEBHOOK_EVENTS]);
    });

    it('Zid adapter topics match ZID_WEBHOOK_EVENTS', () => {
        const adapter = new ZidIntegration();
        expect([...adapter.getWebhookTopics()]).toEqual([...ZID_WEBHOOK_EVENTS]);
    });

    it('Shopify adapter topics match SHOPIFY_WEBHOOK_EVENTS', () => {
        const adapter = new ShopifyIntegration();
        expect([...adapter.getWebhookTopics()]).toEqual([...SHOPIFY_WEBHOOK_EVENTS]);
    });
});
