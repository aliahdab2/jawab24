/**
 * Resume-override contract for the implicit handoff pause.
 *
 * Before the resume-marker mechanism, pressing Resume cleared only the explicit
 * `conversation_pauses` row — recent manual replies (`reply_method='manual'`)
 * still triggered `_hasRecentManualReply`, leaving the bot silent for up to
 * `pauseMinutes` after Resume. These tests guard the fix: Resume writes a Redis
 * marker; the read path treats the marker as a virtual cutoff that masks any
 * manual reply older than the marker timestamp.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const redisMock = vi.hoisted(() => ({
    get: vi.fn(),
    setex: vi.fn(),
}));

const dbMock = vi.hoisted(() => ({
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    query: {
        messages: { findFirst: vi.fn() },
        conversationPauses: { findFirst: vi.fn() },
    },
}));

vi.mock('../../src/lib/redis', () => ({ redis: redisMock }));
vi.mock('../../src/db', () => ({ db: dbMock }));

import { conversationPauseService } from '../../src/services/conversationPause';

describe('ConversationPauseService — resume marker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // No explicit pause by default — these tests focus on the implicit path.
        dbMock.query.conversationPauses.findFirst.mockResolvedValue(null);
    });

    it('writes a Redis resume marker on resumeConversation with TTL matching the window', async () => {
        redisMock.setex.mockResolvedValue('OK');

        await conversationPauseService.resumeConversation('page-1', 'sender-1', 15);

        expect(redisMock.setex).toHaveBeenCalledTimes(1);
        const [key, ttl, value] = redisMock.setex.mock.calls[0];
        expect(key).toBe('handoff:resumed:page-1:sender-1');
        // TTL = window seconds + 60s buffer so marker survives across the rolling window.
        expect(ttl).toBe(15 * 60 + 60);
        // Value is a timestamp the read path can parse.
        expect(Number.isFinite(parseInt(value, 10))).toBe(true);
    });

    it('isPaused returns false after resume even when a manual reply lies inside the window', async () => {
        // Scenario: manual reply 5 min ago (would normally pause for 10 more min)
        // but resume marker is newer (1 min ago) → marker masks the older reply.
        // The DB query uses the marker as the effective cutoff, so the 5-min-old
        // row falls outside the search window and findFirst returns null.
        const oneMinAgoMs = Date.now() - 60 * 1000;
        redisMock.get.mockResolvedValue(String(oneMinAgoMs));
        dbMock.query.messages.findFirst.mockResolvedValue(null);

        const paused = await conversationPauseService.isPaused('page-1', 'sender-1', 15);

        expect(paused).toBe(false);
        expect(redisMock.get).toHaveBeenCalledWith('handoff:resumed:page-1:sender-1');
    });

    it('isPaused returns true for a manual reply that arrived AFTER the resume marker', async () => {
        // Resume happened 10 min ago. A new manual reply landed 2 min ago — the
        // marker should not mask it; the bot should stay paused.
        const tenMinAgoMs = Date.now() - 10 * 60 * 1000;
        redisMock.get.mockResolvedValue(String(tenMinAgoMs));
        dbMock.query.messages.findFirst.mockResolvedValue({
            createdAt: new Date(Date.now() - 2 * 60 * 1000),
        });

        const paused = await conversationPauseService.isPaused('page-1', 'sender-1', 15);

        expect(paused).toBe(true);
    });

    it('falls back to ignoring the marker when Redis is unavailable (bot still works)', async () => {
        redisMock.get.mockRejectedValue(new Error('redis down'));
        // A 5-min-old manual reply is inside the 15-min window.
        dbMock.query.messages.findFirst.mockResolvedValue({
            createdAt: new Date(Date.now() - 5 * 60 * 1000),
        });

        const paused = await conversationPauseService.isPaused('page-1', 'sender-1', 15);

        // Without the marker, behavior is the pre-existing implicit-pause logic.
        expect(paused).toBe(true);
    });
});

/**
 * getPauseStatus surfaces WHY a conversation is paused (explicit vs the implicit
 * handoff a manual reply triggers) plus the auto-resume countdown, so the banner
 * can explain the otherwise-silent takeover to the merchant.
 */
describe('ConversationPauseService — getPauseStatus', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        redisMock.get.mockResolvedValue(null);
    });

    it('reports an explicit pause with reason and remaining countdown', async () => {
        const pausedUntil = new Date(Date.now() + 20 * 60 * 1000);
        dbMock.query.conversationPauses.findFirst.mockResolvedValue({ id: 'p1', pausedUntil });

        const status = await conversationPauseService.getPauseStatus('page-1', 'sender-1', 15);

        expect(status.paused).toBe(true);
        expect(status.reason).toBe('explicit');
        expect(status.pausedUntil).toEqual(pausedUntil);
        expect(status.remainingMinutes).toBeGreaterThan(0);
        expect(status.remainingMinutes).toBeLessThanOrEqual(20);
    });

    it('reports an implicit manual-reply handoff pause with reason and countdown', async () => {
        dbMock.query.conversationPauses.findFirst.mockResolvedValue(null);
        // Manual reply 5 min ago in a 15-min window → ~10 min remaining.
        dbMock.query.messages.findFirst.mockResolvedValue({
            createdAt: new Date(Date.now() - 5 * 60 * 1000),
        });

        const status = await conversationPauseService.getPauseStatus('page-1', 'sender-1', 15);

        expect(status.paused).toBe(true);
        expect(status.reason).toBe('manual_reply');
        expect(status.pausedUntil).toBeInstanceOf(Date);
        expect(status.remainingMinutes).toBeGreaterThan(0);
        expect(status.remainingMinutes).toBeLessThanOrEqual(10);
    });

    it('honors the merchant window for the countdown (not the default)', async () => {
        dbMock.query.conversationPauses.findFirst.mockResolvedValue(null);
        // Reply 20 min ago: past the 15-min default but inside a 60-min window,
        // leaving ~40 min on the clock.
        dbMock.query.messages.findFirst.mockResolvedValue({
            createdAt: new Date(Date.now() - 20 * 60 * 1000),
        });

        const status = await conversationPauseService.getPauseStatus('page-1', 'sender-1', 60);

        expect(status.paused).toBe(true);
        expect(status.reason).toBe('manual_reply');
        expect(status.remainingMinutes).toBeGreaterThan(0);
        expect(status.remainingMinutes).toBeLessThanOrEqual(40);
    });

    it('reports not-paused with null reason and countdown when nothing is active', async () => {
        dbMock.query.conversationPauses.findFirst.mockResolvedValue(null);
        dbMock.query.messages.findFirst.mockResolvedValue(null);

        const status = await conversationPauseService.getPauseStatus('page-1', 'sender-1', 15);

        expect(status.paused).toBe(false);
        expect(status.reason).toBeNull();
        expect(status.pausedUntil).toBeNull();
        expect(status.remainingMinutes).toBeNull();
    });
});
