import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { FastifyReply } from 'fastify';
import type { WorkspaceRequest } from '../../src/middleware/workspace';

// Mock dependencies before imports
vi.mock('../../src/services/pages', () => ({
    pagesService: {
        getPage: vi.fn(),
        updateReplyMode: vi.fn(),
    },
    isPageDisconnected: vi.fn(() => false),
}));

vi.mock('../../src/services/auditLog', () => ({
    auditLog: vi.fn(),
    logAutoReplyToggle: vi.fn(),
}));

// Module-graph stubs so importing the two controllers never pulls live
// services (same set pages.test.ts / settings.test.ts use).
vi.mock('../../src/services/multiLangTranslation', () => ({
    smartTranslateMultiLang: vi.fn(async (update: Record<string, string>) => update),
}));
vi.mock('../../src/services/translation', () => ({
    translateText: vi.fn(async () => ({ translatedText: 'translated' })),
    generateNudgeVariations: vi.fn(async () => []),
}));
vi.mock('../../src/services/workspaceSettings', () => ({
    workspaceSettingsService: {
        getSettings: vi.fn(async () => ({ supportedLanguages: ['ar', 'en'] })),
    },
}));
vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: { canAddPage: vi.fn(), canEnablePage: vi.fn() },
}));
vi.mock('../../src/services/facebook', () => ({
    facebookService: { subscribePageToWebhooks: vi.fn(), unsubscribePageFromWebhooks: vi.fn() },
}));
vi.mock('../../src/services/auth', () => ({
    authService: { getUserById: vi.fn().mockResolvedValue(null) },
}));
vi.mock('../../src/services/channelTrial', () => ({
    channelTrialService: {
        evaluate: vi.fn().mockResolvedValue({ blocked: false }),
        record: vi.fn().mockResolvedValue(undefined),
        channelsForPage: vi.fn().mockReturnValue([]),
    },
}));
vi.mock('../../src/services/businessReadiness', () => ({
    businessInfoGate: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../src/services/imageStorage', () => ({
    imageStorage: {},
}));
vi.mock('../../src/services/activation', () => ({
    recordAutoreplyEnabledIfEffective: vi.fn(),
    recordActivationEvent: vi.fn(),
    isBusinessInfoProvided: vi.fn(() => true),
}));
vi.mock('../../src/services/settings', () => ({
    settingsService: {
        getSettings: vi.fn(),
        updateSettings: vi.fn(),
        resolveWriteTargetWorkspaceId: vi.fn(),
    },
}));
vi.mock('../../src/utils/validation', () => ({
    validateSchema: vi.fn(),
}));

import { pagesController } from '../../src/controllers/pages';
import { pagesService } from '../../src/services/pages';
import { auditLog } from '../../src/services/auditLog';
import { settingsController } from '../../src/controllers/settings';
import { settingsService } from '../../src/services/settings';
import { validateSchema } from '../../src/utils/validation';

const ALLOWED_WS = 'allowed-ws';
const OTHER_WS = 'other-ws';

/**
 * R-2 write-surface suite for the per-page reply mode (D-085, GA per D-087):
 * PATCH /pages/:id/reply-mode — 400 / 401 / 404 / tenant isolation / the M1
 * audit row. The allowlist branches are gone with the gate; what remains is the
 * enum validation and the tenant scoping, which GA did not relax.
 */
describe('PagesController.updateReplyMode', () => {
    let mockRequest: Partial<WorkspaceRequest>;
    let mockReply: Partial<FastifyReply>;
    beforeEach(() => {
        vi.clearAllMocks();
        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
        };
        mockRequest = {
            user: { userId: 'user-123', facebookId: 'fb-123' },
            workspaceId: ALLOWED_WS,
            workspaceRole: 'owner',
            params: { id: 'page-1' },
            body: { replyMode: 'info' },
            log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as never,
        };
    });

    function callUpdate() {
        return pagesController.updateReplyMode(
            mockRequest as never,
            mockReply as FastifyReply,
        );
    }

    function armPage(replyMode: string | null = null, workspaceId = ALLOWED_WS) {
        const page = { id: 'page-1', workspaceId, replyMode, name: 'p' };
        vi.mocked(pagesService.getPage).mockResolvedValue(page as never);
        vi.mocked(pagesService.updateReplyMode).mockResolvedValue({ ...page, replyMode: (mockRequest.body as { replyMode: string | null }).replyMode } as never);
        return page;
    }

    it('401 when the request has no resolved workspace', async () => {
        mockRequest.workspaceId = undefined;
        await callUpdate();
        expect(mockReply.status).toHaveBeenCalledWith(401);
    });

    it('400 when the replyMode key is missing', async () => {
        mockRequest.body = {};
        await callUpdate();
        expect(mockReply.status).toHaveBeenCalledWith(400);
        expect(pagesService.updateReplyMode).not.toHaveBeenCalled();
    });

    it('400 for a value outside the enum', async () => {
        mockRequest.body = { replyMode: 'support' };
        await callUpdate();
        expect(mockReply.status).toHaveBeenCalledWith(400);
        expect(pagesService.updateReplyMode).not.toHaveBeenCalled();
    });

    // GA (D-087): 'info' is no longer refused for anyone. This is the case that
    // 403'd for every workspace outside the pilot allowlist — it must now reach
    // the service, or the gate is still in place somewhere.
    it("'info' is accepted for ANY workspace — no allowlist survives", async () => {
        mockRequest.workspaceId = OTHER_WS;
        armPage(null, OTHER_WS);
        await callUpdate();
        expect(mockReply.status).not.toHaveBeenCalledWith(403);
        expect(pagesService.updateReplyMode).toHaveBeenCalledWith(OTHER_WS, 'page-1', 'info');
    });

    it("'sales' pins the page against a workspace flip", async () => {
        mockRequest.body = { replyMode: 'sales' };
        armPage('info');
        await callUpdate();
        expect(mockReply.status).not.toHaveBeenCalledWith(403);
        expect(pagesService.updateReplyMode).toHaveBeenCalledWith(ALLOWED_WS, 'page-1', 'sales');
    });

    it('null reverts the page to the workspace default', async () => {
        mockRequest.body = { replyMode: null };
        armPage('info');
        await callUpdate();
        expect(mockReply.status).not.toHaveBeenCalledWith(403);
        expect(pagesService.updateReplyMode).toHaveBeenCalledWith(ALLOWED_WS, 'page-1', null);
    });

    it('404 when the page does not exist in this workspace (tenant isolation)', async () => {
        vi.mocked(pagesService.getPage).mockResolvedValue(null as never);
        await callUpdate();
        expect(pagesService.getPage).toHaveBeenCalledWith(ALLOWED_WS, 'page-1');
        expect(mockReply.status).toHaveBeenCalledWith(404);
        expect(pagesService.updateReplyMode).not.toHaveBeenCalled();
    });

    it('scopes both the read and the write to the REQUEST workspace', async () => {
        armPage(null);
        await callUpdate();
        expect(pagesService.getPage).toHaveBeenCalledWith(ALLOWED_WS, 'page-1');
        expect(pagesService.updateReplyMode).toHaveBeenCalledWith(ALLOWED_WS, 'page-1', 'info');
    });

    it('writes a page.reply_mode_changed audit row with {previous,next} on an actual change (M1)', async () => {
        armPage(null);
        await callUpdate();
        expect(auditLog).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'page.reply_mode_changed',
                pageId: 'page-1',
                workspaceId: ALLOWED_WS,
                metadata: { previous: null, next: 'info' },
            }),
        );
    });

    it('does NOT fabricate an audit row on a no-op PATCH (same value)', async () => {
        armPage('info');
        await callUpdate();
        expect(auditLog).not.toHaveBeenCalled();
    });

    it('500 with a generic error when the service throws', async () => {
        vi.mocked(pagesService.getPage).mockRejectedValue(new Error('boom'));
        await callUpdate();
        expect(mockReply.status).toHaveBeenCalledWith(500);
    });
});

/**
 * H3: the workspace-settings write surface. The gate must hold on the
 * workspace the write actually LANDS on (settingsService's own resolver),
 * not merely on the workspace this request resolved — for a multi-membership
 * user the two can differ, and a gate checked on one while the write hits the
 * other is a bypass.
 */
describe("SettingsController.update — replyMode 'info' gate (H3)", () => {
    let mockRequest: Record<string, unknown>;
    let mockReply: Partial<FastifyReply>;
    beforeEach(() => {
        vi.clearAllMocks();
        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
        };
        mockRequest = {
            user: { userId: 'user-123', facebookId: 'fb-123' },
            workspaceId: ALLOWED_WS,
            query: {},
            params: {},
            body: { replyMode: 'info' },
            log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
        };
        vi.mocked(validateSchema).mockReturnValue({ success: true, data: { replyMode: 'info' } } as never);
        vi.mocked(settingsService.getSettings).mockResolvedValue({ supportedLanguages: ['ar', 'en'] } as never);
        vi.mocked(settingsService.updateSettings).mockResolvedValue({ replyMode: 'info' } as never);
    });

    function callUpdate() {
        return settingsController.update(mockRequest as never, mockReply as never);
    }

    it('403 REPLY_MODE_WORKSPACE_MISMATCH when the write target differs from the request workspace', async () => {
        vi.mocked(settingsService.resolveWriteTargetWorkspaceId).mockResolvedValue(OTHER_WS);
        await callUpdate();
        expect(mockReply.status).toHaveBeenCalledWith(403);
        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'REPLY_MODE_WORKSPACE_MISMATCH' }),
        );
        expect(settingsService.updateSettings).not.toHaveBeenCalled();
    });

    it('403 REPLY_MODE_WORKSPACE_MISMATCH when the resolver finds no workspace at all', async () => {
        vi.mocked(settingsService.resolveWriteTargetWorkspaceId).mockResolvedValue(null);
        await callUpdate();
        expect(mockReply.status).toHaveBeenCalledWith(403);
        expect(settingsService.updateSettings).not.toHaveBeenCalled();
    });

    it('proceeds when the write target matches the request workspace', async () => {
        vi.mocked(settingsService.resolveWriteTargetWorkspaceId).mockResolvedValue(ALLOWED_WS);
        await callUpdate();
        expect(mockReply.status).not.toHaveBeenCalledWith(403);
        expect(settingsService.updateSettings).toHaveBeenCalledWith('user-123', expect.objectContaining({ replyMode: 'info' }));
    });

    it("'info' is accepted for a workspace that was never in the pilot allowlist", async () => {
        mockRequest.workspaceId = OTHER_WS;
        vi.mocked(settingsService.resolveWriteTargetWorkspaceId).mockResolvedValue(OTHER_WS);
        await callUpdate();
        expect(mockReply.status).not.toHaveBeenCalledWith(403);
        expect(settingsService.updateSettings).toHaveBeenCalledWith('user-123', expect.objectContaining({ replyMode: 'info' }));
    });

    // GA WIDENED the mismatch guard from 'info' to BOTH modes. Turning info OFF
    // on the wrong workspace silently restores lead-capture asks on another
    // merchant's pages — the same defect as turning it on, and after GA the
    // likelier one. Before the widening this test failed: the resolver was
    // never called for 'sales' and the write went through.
    it("guards 'sales' too — a mismatched write target is refused", async () => {
        (mockRequest as { body: unknown }).body = { replyMode: 'sales' };
        vi.mocked(validateSchema).mockReturnValue({ success: true, data: { replyMode: 'sales' } } as never);
        vi.mocked(settingsService.resolveWriteTargetWorkspaceId).mockResolvedValue(OTHER_WS);
        await callUpdate();
        expect(settingsService.resolveWriteTargetWorkspaceId).toHaveBeenCalled();
        expect(mockReply.status).toHaveBeenCalledWith(403);
        expect(mockReply.send).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'REPLY_MODE_WORKSPACE_MISMATCH' }),
        );
        expect(settingsService.updateSettings).not.toHaveBeenCalled();
    });

    it("leaves a settings write that does not touch replyMode alone", async () => {
        (mockRequest as { body: unknown }).body = { replyStyle: 'casual' };
        vi.mocked(validateSchema).mockReturnValue({ success: true, data: { replyStyle: 'casual' } } as never);
        await callUpdate();
        expect(settingsService.resolveWriteTargetWorkspaceId).not.toHaveBeenCalled();
        expect(settingsService.updateSettings).toHaveBeenCalled();
    });
});
