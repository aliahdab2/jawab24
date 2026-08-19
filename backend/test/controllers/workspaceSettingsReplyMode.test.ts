import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyReply } from 'fastify';
import type { WorkspaceRequest } from '../../src/middleware/workspace';

vi.mock('../../src/services/workspaceSettings', () => ({
    workspaceSettingsService: {
        getSettings: vi.fn(),
        updateSettings: vi.fn(),
    },
}));
vi.mock('../../src/services/workspace', () => ({
    workspaceService: {},
    WorkspaceAccessDeniedError: class extends Error {},
}));
vi.mock('../../src/services/workspaceInvite', () => ({ workspaceInviteService: {} }));

import { workspaceController } from '../../src/controllers/workspace';
import { workspaceSettingsService } from '../../src/services/workspaceSettings';

/**
 * PUT /workspaces/current/settings — the OTHER reply-mode write path.
 *
 * ⚠️ This is the route that writes `workspaces.settings` JSONB, which is the
 * store the reply pipeline actually reads (messageProcessor / commentProcessor
 * both call `workspaceSettingsService.getSettings`). The per-user `settings`
 * table that `PUT /settings` guards is a different row. This route's key
 * allowlist (`isWorkspaceSettingsKey`) checks the NAME only, so before D-087 an
 * arbitrary string reached the pipeline's own store with no validation and no
 * error: `resolveEffectiveReplyMode` silently degraded it to 'sales', leaving a
 * merchant who set a mode watching it do nothing.
 */
describe('workspaceController.updateSettings — value validation', () => {
    let request: Partial<WorkspaceRequest>;
    let reply: Partial<FastifyReply>;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(workspaceSettingsService.updateSettings).mockResolvedValue({} as never);
        reply = { status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };
        request = { workspaceId: 'ws-1', body: {} } as Partial<WorkspaceRequest>;
    });

    const call = () => workspaceController.updateSettings(request as never, reply as never);

    it.each(['sales', 'info'])("accepts '%s'", async (mode) => {
        (request as { body: unknown }).body = { replyMode: mode };
        await call();
        expect(reply.status).not.toHaveBeenCalledWith(400);
        expect(workspaceSettingsService.updateSettings).toHaveBeenCalledWith(
            'ws-1', expect.objectContaining({ replyMode: mode }),
        );
    });

    // The mutation guard: delete the enum check in the controller and this is
    // the assertion that fails — the junk value reaches the JSONB the reply
    // pipeline reads.
    it.each(['support', '', 'INFO', 'sales ', null, 42])(
        'rejects %o with 400 and writes nothing',
        async (bad) => {
            (request as { body: unknown }).body = { replyMode: bad };
            await call();
            expect(reply.status).toHaveBeenCalledWith(400);
            expect(workspaceSettingsService.updateSettings).not.toHaveBeenCalled();
        },
    );

    // The enum check was the narrow fix; the schema is the general one. Every
    // key the shared UpdateSettingsSchema declares is now validated by VALUE on
    // this route, using the same schema PUT /settings uses, so the two write
    // paths into one store cannot drift.
    it.each([
        ['replyStyle', 'shouty'],
        ['commentEscalationMinutes', 2],
        ['businessHoursStart', '25:00'],
        ['aiEnabled', 'yes'],
    ])('rejects an invalid %s', async (key, value) => {
        (request as { body: unknown }).body = { [key]: value };
        await call();
        expect(reply.status).toHaveBeenCalledWith(400);
        expect(workspaceSettingsService.updateSettings).not.toHaveBeenCalled();
    });

    // leadStages/leadFields are NOT in the schema and keep their own sanitizers.
    // The schema is .strict(), so handing them to it would reject a valid save.
    it('still accepts the lead config the schema does not declare', async () => {
        (request as { body: unknown }).body = { leadStages: { enabled: true, stages: [] } };
        await call();
        expect(reply.status).not.toHaveBeenCalledWith(400);
        expect(workspaceSettingsService.updateSettings).toHaveBeenCalled();
    });

    it('leaves a write that never mentions replyMode alone', async () => {
        (request as { body: unknown }).body = { replyStyle: 'casual' };
        await call();
        expect(reply.status).not.toHaveBeenCalledWith(400);
        expect(workspaceSettingsService.updateSettings).toHaveBeenCalledWith(
            'ws-1', expect.objectContaining({ replyStyle: 'casual' }),
        );
    });

    // `'replyMode' in updates` — not a truthiness check. An explicit undefined
    // survives the key filter as a present key, and treating it as "absent"
    // would let `{ replyMode: undefined }` through to overwrite a stored mode
    // with nothing.
    it('rejects an explicitly-undefined replyMode rather than passing it through', async () => {
        (request as { body: unknown }).body = { replyMode: undefined };
        await call();
        expect(reply.status).toHaveBeenCalledWith(400);
        expect(workspaceSettingsService.updateSettings).not.toHaveBeenCalled();
    });
});
