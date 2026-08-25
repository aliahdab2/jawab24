import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BusinessProfile } from '@jawab24/shared';

// --- Hoisted mocks ---

const { mockSelectWhere, mockUpdateSet, mockUpdateWhere, mockCaptureError } = vi.hoisted(() => ({
    mockSelectWhere: vi.fn(),
    mockUpdateSet: vi.fn(),
    mockUpdateWhere: vi.fn(),
    mockCaptureError: vi.fn(),
}));

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: (...args: unknown[]) => mockSelectWhere(...args),
            }),
        }),
        update: vi.fn().mockReturnValue({
            set: (...args: unknown[]) => {
                mockUpdateSet(...args);
                return { where: (...args2: unknown[]) => mockUpdateWhere(...args2) };
            },
        }),
    },
}));

vi.mock('../../src/db/schema', () => ({
    pages: { id: 'id', businessProfile: 'businessProfile', ecommerceStoreId: 'ecommerceStoreId' },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
}));

vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: (...args: unknown[]) => mockCaptureError(...args),
}));

import { applyStoreFactsToLinkedPages } from '../../src/services/storeFactsSync';

const FACTS: BusinessProfile = {
    phones: ['+966512223344'],
    channels: { whatsapp: '+966512223344' },
};

describe('applyStoreFactsToLinkedPages (D-102)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUpdateWhere.mockResolvedValue(undefined);
    });

    it('no-ops (no page lookup at all) when the facts fragment is empty', async () => {
        const result = await applyStoreFactsToLinkedPages('store-1', {});
        expect(result).toEqual({ pagesUpdated: 0 });
        expect(mockSelectWhere).not.toHaveBeenCalled();
    });

    it('fans out to every linked page and stamps store_sync provenance', async () => {
        mockSelectWhere.mockResolvedValue([
            { id: 'page-1', businessProfile: null },
            { id: 'page-2', businessProfile: null },
        ]);

        const result = await applyStoreFactsToLinkedPages('store-1', FACTS);

        expect(result).toEqual({ pagesUpdated: 2 });
        expect(mockUpdateSet).toHaveBeenCalledTimes(2);
        const written = mockUpdateSet.mock.calls[0][0];
        expect(written.businessProfile.merchant.phones).toEqual(['+966512223344']);
        expect(written.businessProfile.merchantProvenance.phones).toEqual({ source: 'store_sync', confirmedAt: null });
        expect(written.businessProfileUpdatedAt).toBeInstanceOf(Date);
    });

    it('does not write when nothing changed (idempotent re-sync)', async () => {
        mockSelectWhere.mockResolvedValue([{
            id: 'page-1',
            businessProfile: {
                merchant: { ...FACTS },
                merchantProvenance: {
                    phones: { source: 'store_sync', confirmedAt: null },
                    channels: { source: 'store_sync', confirmedAt: null },
                },
            },
        }]);

        const result = await applyStoreFactsToLinkedPages('store-1', FACTS);

        expect(result).toEqual({ pagesUpdated: 0 });
        expect(mockUpdateSet).not.toHaveBeenCalled();
    });

    it('preserves confirmed editor values end-to-end and keeps the suggestions half', async () => {
        mockSelectWhere.mockResolvedValue([{
            id: 'page-1',
            businessProfile: {
                merchant: { phones: ['0501112222'] },
                suggestions: { name: 'FB suggested name' },
                merchantProvenance: {
                    phones: { source: 'editor', confirmedAt: '2026-08-01T10:00:00.000Z' },
                },
            },
        }]);

        const result = await applyStoreFactsToLinkedPages('store-1', FACTS);

        expect(result).toEqual({ pagesUpdated: 1 }); // channels still landed
        const written = mockUpdateSet.mock.calls[0][0];
        expect(written.businessProfile.merchant.phones).toEqual(['0501112222']);
        expect(written.businessProfile.merchant.channels).toEqual({ whatsapp: '+966512223344' });
        expect(written.businessProfile.suggestions).toEqual({ name: 'FB suggested name' });
    });

    it('isolates a per-page failure: reports it and continues with the other pages', async () => {
        mockSelectWhere.mockResolvedValue([
            { id: 'page-bad', businessProfile: null },
            { id: 'page-good', businessProfile: null },
        ]);
        mockUpdateWhere
            .mockRejectedValueOnce(new Error('db exploded'))
            .mockResolvedValueOnce(undefined);

        const result = await applyStoreFactsToLinkedPages('store-1', FACTS);

        expect(result).toEqual({ pagesUpdated: 1 });
        expect(mockCaptureError).toHaveBeenCalledTimes(1);
    });

    it('never throws when the page lookup itself fails (a facts failure must not abort product sync)', async () => {
        mockSelectWhere.mockRejectedValue(new Error('db down'));

        const result = await applyStoreFactsToLinkedPages('store-1', FACTS);

        expect(result).toEqual({ pagesUpdated: 0 });
        expect(mockCaptureError).toHaveBeenCalledTimes(1);
    });
});
