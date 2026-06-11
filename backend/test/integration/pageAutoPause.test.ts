import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestUser, createTestWorkspace, createTestPage, testDb } from './setup';
import { pages } from '../../src/db/schema';
import {
    recordSendFailure,
    recordSendSuccess,
    clearAutoPause,
    isPageLevelFailure,
    PAUSE_THRESHOLD,
} from '../../src/services/pageAutoPause';
import { pagesService } from '../../src/services/pages';

async function getPage(pageId: string) {
    const [row] = await testDb.select().from(pages).where(eq(pages.id, pageId));
    return row;
}

describe('pageAutoPause', () => {
    describe('isPageLevelFailure', () => {
        it('counts our_fault and unknown as page-level', () => {
            expect(isPageLevelFailure('our_fault')).toBe(true);
            expect(isPageLevelFailure('unknown')).toBe(true);
        });

        it('does not count customer_refused or window_expired or transient', () => {
            expect(isPageLevelFailure('customer_refused')).toBe(false);
            expect(isPageLevelFailure('window_expired')).toBe(false);
            expect(isPageLevelFailure('transient')).toBe(false);
        });

        it('treats no-bucket (comment-reply failure) as page-level', () => {
            expect(isPageLevelFailure(undefined)).toBe(true);
        });
    });

    describe('recordSendFailure', () => {
        it('does not bump for per-customer failures', async () => {
            const user = await createTestUser();
            const ws = await createTestWorkspace(user.id);
            const page = await createTestPage(user.id, { workspaceId: ws.id });

            await recordSendFailure(page.id, 'customer_refused');
            await recordSendFailure(page.id, 'window_expired');
            await recordSendFailure(page.id, 'transient');

            const after = await getPage(page.id);
            expect(after.consecutiveSendFailures).toBe(0);
            expect(after.autoReplyEnabled).toBe(true);
            expect(after.autoPauseReason).toBeNull();
        });

        it('bumps counter for page-level failures without pausing under threshold', async () => {
            const user = await createTestUser();
            const ws = await createTestWorkspace(user.id);
            const page = await createTestPage(user.id, { workspaceId: ws.id });

            for (let i = 0; i < PAUSE_THRESHOLD - 1; i++) {
                await recordSendFailure(page.id, 'unknown');
            }

            const after = await getPage(page.id);
            expect(after.consecutiveSendFailures).toBe(PAUSE_THRESHOLD - 1);
            expect(after.autoReplyEnabled).toBe(true);
            expect(after.autoPauseReason).toBeNull();
            expect(after.autoPausedAt).toBeNull();
        });

        it('pauses the page when the threshold is crossed', async () => {
            const user = await createTestUser();
            const ws = await createTestWorkspace(user.id);
            const page = await createTestPage(user.id, { workspaceId: ws.id });

            for (let i = 0; i < PAUSE_THRESHOLD; i++) {
                await recordSendFailure(page.id, 'our_fault');
            }

            const after = await getPage(page.id);
            expect(after.consecutiveSendFailures).toBe(PAUSE_THRESHOLD);
            expect(after.autoReplyEnabled).toBe(false);
            expect(after.autoPauseReason).toBe('send_rejected');
            expect(after.autoPausedAt).not.toBeNull();
            // SYSTEM disable — the comment pipeline keys ingestion off this value
            expect(after.autoReplyDisabledReason).toBe('auto_pause');
        });
    });

    describe('recordSendSuccess', () => {
        it('resets a non-zero counter to 0', async () => {
            const user = await createTestUser();
            const ws = await createTestWorkspace(user.id);
            const page = await createTestPage(user.id, { workspaceId: ws.id });

            await recordSendFailure(page.id, 'unknown');
            await recordSendFailure(page.id, 'unknown');
            await recordSendFailure(page.id, 'unknown');
            expect((await getPage(page.id)).consecutiveSendFailures).toBe(3);

            await recordSendSuccess(page.id);

            expect((await getPage(page.id)).consecutiveSendFailures).toBe(0);
        });

        it('does NOT clear autoPauseReason on a stray success after pause', async () => {
            const user = await createTestUser();
            const ws = await createTestWorkspace(user.id);
            const page = await createTestPage(user.id, { workspaceId: ws.id });

            for (let i = 0; i < PAUSE_THRESHOLD; i++) {
                await recordSendFailure(page.id, 'unknown');
            }
            // Page is now paused; autoReplyEnabled=false would normally short-circuit
            // the send path, but we test the helper in isolation.
            await recordSendSuccess(page.id);

            const after = await getPage(page.id);
            expect(after.consecutiveSendFailures).toBe(0);
            // Pause state preserved — only manual unpause clears it.
            expect(after.autoPauseReason).toBe('send_rejected');
            expect(after.autoReplyEnabled).toBe(false);
        });
    });

    describe('pagesService.toggleAutoReply (manual unpause)', () => {
        it('clears auto-pause state on off → on transition', async () => {
            const user = await createTestUser();
            const ws = await createTestWorkspace(user.id);
            const page = await createTestPage(user.id, { workspaceId: ws.id });

            for (let i = 0; i < PAUSE_THRESHOLD; i++) {
                await recordSendFailure(page.id, 'unknown');
            }
            // Now paused.
            await pagesService.toggleAutoReply(ws.id, page.id, true);

            const after = await getPage(page.id);
            expect(after.autoReplyEnabled).toBe(true);
            expect(after.consecutiveSendFailures).toBe(0);
            expect(after.autoPauseReason).toBeNull();
            expect(after.autoPausedAt).toBeNull();
            expect(after.autoReplyDisabledReason).toBeNull();
        });

        it('preserves auto-pause audit trail when customer disables auto-reply', async () => {
            const user = await createTestUser();
            const ws = await createTestWorkspace(user.id);
            const page = await createTestPage(user.id, { workspaceId: ws.id });

            for (let i = 0; i < PAUSE_THRESHOLD; i++) {
                await recordSendFailure(page.id, 'unknown');
            }
            // Customer explicitly disables (no-op for autoReplyEnabled since already false,
            // but pause-reason must not be wiped).
            await pagesService.toggleAutoReply(ws.id, page.id, false);

            const after = await getPage(page.id);
            expect(after.autoPauseReason).toBe('send_rejected');
            expect(after.consecutiveSendFailures).toBe(PAUSE_THRESHOLD);
            // Explicit merchant disable overrides the system reason: the page is
            // now 'user'-silent (comment ingestion stops), while the auto-pause
            // audit trail above is preserved separately.
            expect(after.autoReplyDisabledReason).toBe('user');
        });
    });

    describe('clearAutoPause', () => {
        it('wipes counter, reason, and timestamp', async () => {
            const user = await createTestUser();
            const ws = await createTestWorkspace(user.id);
            const page = await createTestPage(user.id, { workspaceId: ws.id });

            for (let i = 0; i < PAUSE_THRESHOLD; i++) {
                await recordSendFailure(page.id, 'unknown');
            }

            await clearAutoPause(page.id);

            const after = await getPage(page.id);
            expect(after.consecutiveSendFailures).toBe(0);
            expect(after.autoPauseReason).toBeNull();
            expect(after.autoPausedAt).toBeNull();
        });
    });
});
