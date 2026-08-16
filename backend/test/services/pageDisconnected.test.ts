import { describe, it, expect, vi } from 'vitest';

/**
 * `isPageDisconnected` — THE THIRD TWIN of the connection rule, beside
 * `serializePage.isConnected` and the admin SQL `disconnected` CASE.
 *
 * This file exists because the predicate shipped UNPINNED while its two twins
 * were "pinned by tests" — and unextended, it dropped every Instagram-direct
 * webhook at the front door while the suite stayed green (PR #772 review C1).
 * These cases are the contract; a change here must move all three twins.
 *
 * services/pages pulls a heavy dependency graph at import; everything below is
 * mocked to inert stubs because this file tests one pure function.
 */
vi.mock('../../src/db', () => ({ db: {} }));
vi.mock('../../src/lib/redis', () => ({ redis: {} }));
vi.mock('../../src/services/kb/operationalFactsExtractor', () => ({ operationalFactsExtractor: {} }));
vi.mock('../../src/services/ecommerce', () => ({ storeAnswersPolicies: vi.fn() }));
vi.mock('../../src/services/facebook', () => ({ facebookService: {} }));
vi.mock('../../src/services/instagram', () => ({ instagramService: {} }));
vi.mock('../../src/services/imageStorage', () => ({ imageStorage: {} }));
vi.mock('../../src/services/subscriptions', () => ({ subscriptionsService: {} }));
vi.mock('../../src/services/channelTrial', () => ({ channelTrialService: {} }));
vi.mock('../../src/services/auditLog', () => ({ logAutoReplyToggle: vi.fn(), auditLog: vi.fn() }));
vi.mock('../../src/services/statsCache', () => ({
    STATS_CACHE_TTL: 60, pagesStatsCacheKey: vi.fn(), invalidateWorkspaceStatsCache: vi.fn(),
}));
vi.mock('../../src/services/pageTokenRecovery', () => ({ clearReconnectAlertClaims: vi.fn() }));
vi.mock('../../src/services/kb/ingestion', () => ({ KbIngestionService: class {} }));
vi.mock('../../src/services/kb/embedding', () => ({ OpenAIEmbeddingProvider: class {} }));
vi.mock('../../src/services/kb/pgvector-store', () => ({ PgVectorStore: class {} }));

import { isPageDisconnected } from '../../src/services/pages';

describe('isPageDisconnected — the channel-aware connection rule', () => {
    describe('Facebook-backed rows (behavior must stay byte-identical to the pre-#772 rule)', () => {
        it('blanked token ⇒ disconnected (the revocation sentinel)', () => {
            expect(isPageDisconnected({ facebookPageId: 'fb-1', accessToken: '' })).toBe(true);
        });

        it('live token ⇒ connected', () => {
            expect(isPageDisconnected({ facebookPageId: 'fb-1', accessToken: 'tok' })).toBe(false);
        });

        // A page-linked row that ALSO carries channel tokens must still be judged by
        // its Facebook token: WhatsApp lives on the same row, and a dead FB session
        // is a dead FB session regardless of the WABA credential's health.
        it('blanked token ⇒ disconnected even when a WhatsApp token is present', () => {
            expect(isPageDisconnected({
                facebookPageId: 'fb-1', accessToken: '', whatsappAccessToken: 'wa-tok',
            })).toBe(true);
        });
    });

    describe('pageless rows (facebookPageId null — the branch the old rule got wrong)', () => {
        it('WhatsApp-only with a live WABA token ⇒ connected', () => {
            expect(isPageDisconnected({
                facebookPageId: null, accessToken: '', whatsappAccessToken: 'wa-tok', instagramAccessToken: null,
            })).toBe(false);
        });

        // THE #772 defect: this exact shape was "disconnected" under the old rule,
        // which dropped every Instagram-direct webhook at controllers/webhook.ts.
        it('Instagram-direct with a live Instagram token ⇒ connected', () => {
            expect(isPageDisconnected({
                facebookPageId: null, accessToken: '', whatsappAccessToken: null, instagramAccessToken: 'enc:v1:ig',
            })).toBe(false);
        });

        it('no channel credential at all ⇒ disconnected', () => {
            expect(isPageDisconnected({
                facebookPageId: null, accessToken: '', whatsappAccessToken: null, instagramAccessToken: null,
            })).toBe(true);
        });

        it('cleared (empty-string) Instagram token ⇒ disconnected', () => {
            expect(isPageDisconnected({
                facebookPageId: null, accessToken: '', whatsappAccessToken: '', instagramAccessToken: '',
            })).toBe(true);
        });
    });

    it('null/undefined page ⇒ not disconnected (caller owns the not-found path)', () => {
        expect(isPageDisconnected(null)).toBe(false);
        expect(isPageDisconnected(undefined)).toBe(false);
    });
});
