import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const { mockSettingsGet, mockSettingsUpdate, mockPagesGetAll } = vi.hoisted(() => ({
    mockSettingsGet: vi.fn(),
    mockSettingsUpdate: vi.fn(),
    mockPagesGetAll: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
    settingsApi: { get: mockSettingsGet, update: mockSettingsUpdate },
    pagesApi: { getAll: mockPagesGetAll },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
// next-intl: return the key so assertions don't depend on copy.
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

import { StoreAutoReplyRow, deriveRowState } from './StoreAutoReplyRow';
import type { Page } from '@jawab24/shared';

const page = (over: Partial<Page> = {}): Page =>
    ({ id: 'p1', name: 'Jawab24 Test', facebookPageId: 'fb1', autoReplyEnabled: false, createdAt: null, ...over }) as Page;

const masters = (on: boolean) => ({ data: { messagesAutoReply: on, commentsAutoReply: on } });

describe('deriveRowState — the effective state, not the masters alone', () => {
    it('is off while the workspace masters are off, whatever the pages say', () => {
        expect(deriveRowState(false, [page({ autoReplyEnabled: true })])).toBe('off');
    });

    it('is on when the masters are on and a page will answer on some channel', () => {
        expect(deriveRowState(true, [page({ autoReplyEnabled: true })])).toBe('on');
        expect(deriveRowState(true, [page({ instagramAutoReplyEnabled: true })])).toBe('on');
        expect(deriveRowState(true, [page({ whatsappAutoReplyEnabled: true })])).toBe('on');
    });

    // The 2026-08-30 defect: masters flipped on, the one linked page stayed
    // trial-blocked, and the row still said «مفعّلة».
    it('is pageOff when the masters are on but every page is off', () => {
        expect(deriveRowState(true, [page()])).toBe('pageOff');
    });

    it('lets the masters decide alone when there is no page yet', () => {
        expect(deriveRowState(true, [])).toBe('on');
    });
});

describe('StoreAutoReplyRow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPagesGetAll.mockResolvedValue({ data: [page()] });
    });

    it('offers the enable when the masters are off', async () => {
        mockSettingsGet.mockResolvedValue(masters(false));
        render(<StoreAutoReplyRow />);
        expect(await screen.findByText('storeAutoReplyOff')).toBeInTheDocument();
        expect(screen.getByText('storeAutoReplyEnable')).toBeInTheDocument();
    });

    it('after enabling, RE-READS and reports the page still off instead of claiming active', async () => {
        mockSettingsGet
            .mockResolvedValueOnce(masters(false))
            .mockResolvedValueOnce(masters(true));
        mockSettingsUpdate.mockResolvedValue({});
        render(<StoreAutoReplyRow />);
        fireEvent.click(await screen.findByText('storeAutoReplyEnable'));

        await waitFor(() => expect(mockSettingsUpdate).toHaveBeenCalledWith({ messagesAutoReply: true, commentsAutoReply: true }));
        expect(await screen.findByText('storeAutoReplyPageOff')).toBeInTheDocument();
        expect(screen.getByText('storeAutoReplyManageChannels').closest('a')).toHaveAttribute('href', '/pages');
        expect(screen.queryByText('storeAutoReplyActive')).not.toBeInTheDocument();
    });

    it('claims active only when a page will actually answer', async () => {
        mockSettingsGet.mockResolvedValue(masters(true));
        mockPagesGetAll.mockResolvedValue({ data: [page({ autoReplyEnabled: true })] });
        render(<StoreAutoReplyRow />);
        expect(await screen.findByText('storeAutoReplyActive')).toBeInTheDocument();
    });

    it('never renders "on" from a failed read — falls back to the (idempotent) enable offer', async () => {
        mockSettingsGet.mockRejectedValue(new Error('500'));
        render(<StoreAutoReplyRow />);
        expect(await screen.findByText('storeAutoReplyOff')).toBeInTheDocument();
    });

    it('a failed PAGES read does not hide the masters verdict', async () => {
        mockSettingsGet.mockResolvedValue(masters(true));
        mockPagesGetAll.mockRejectedValue(new Error('500'));
        render(<StoreAutoReplyRow />);
        expect(await screen.findByText('storeAutoReplyActive')).toBeInTheDocument();
    });
});
