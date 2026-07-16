import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordAutoreplyEnabledIfEffective } from '../../src/services/activation';

// D-026 regression suite: `autoreply_enabled` must mean EFFECTIVE activation —
// workspace master ON and ≥1 connected page channel-enabled. Before D-026 the
// event fired on the page-level toggle alone, over-counting new signups whose
// master is OFF by default (D-025).

const hoisted = vi.hoisted(() => ({
    pageRows: [] as Array<{
        autoReplyEnabled: boolean | null;
        instagramAutoReplyEnabled: boolean | null;
        whatsappAutoReplyEnabled: boolean | null;
        accessToken: string | null;
    }>,
}));

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(() => ({
            from: () => ({
                where: () => Promise.resolve(hoisted.pageRows),
            }),
        })),
        insert: vi.fn(() => ({
            values: vi.fn(() => ({
                onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
            })),
        })),
        execute: vi.fn(),
    },
}));

vi.mock('../../src/db/schema', () => ({
    activationEvents: {},
    pages: {
        autoReplyEnabled: 'auto_reply_enabled',
        instagramAutoReplyEnabled: 'instagram_auto_reply_enabled',
        whatsappAutoReplyEnabled: 'whatsapp_auto_reply_enabled',
        accessToken: 'access_token',
        workspaceId: 'workspace_id',
    },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn(),
    sql: vi.fn(),
}));

vi.mock('../../src/services/workspaceSettings', () => ({
    workspaceSettingsService: {
        getSettings: vi.fn(),
    },
}));

vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

const fbPageOn = {
    autoReplyEnabled: true,
    instagramAutoReplyEnabled: false,
    whatsappAutoReplyEnabled: false,
    accessToken: 'tok_live',
};

async function setMasters(commentsAutoReply: boolean, messagesAutoReply: boolean) {
    const { workspaceSettingsService } = await import('../../src/services/workspaceSettings');
    vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
        commentsAutoReply,
        messagesAutoReply,
    } as never);
}

describe('recordAutoreplyEnabledIfEffective (D-026)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.pageRows.length = 0;
    });

    it('does NOT emit when the workspace masters are OFF, even with an enabled page (the over-count regression)', async () => {
        const { db } = await import('../../src/db');
        await setMasters(false, false);
        hoisted.pageRows.push(fbPageOn);

        await recordAutoreplyEnabledIfEffective('user_1', 'ws_1');

        expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
    });

    it('emits when a master is ON and a connected page is channel-enabled', async () => {
        const { db } = await import('../../src/db');
        await setMasters(true, false);
        hoisted.pageRows.push(fbPageOn);

        await recordAutoreplyEnabledIfEffective('user_1', 'ws_1', { source: 'page_toggle' });

        expect(vi.mocked(db.insert)).toHaveBeenCalledTimes(1);
    });

    it('does NOT emit when masters are ON but no page is channel-enabled', async () => {
        const { db } = await import('../../src/db');
        await setMasters(true, true);
        hoisted.pageRows.push({ ...fbPageOn, autoReplyEnabled: false });

        await recordAutoreplyEnabledIfEffective('user_1', 'ws_1');

        expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
    });

    it('does NOT count a page-level-enabled page whose FB credential is missing (disconnected)', async () => {
        const { db } = await import('../../src/db');
        await setMasters(true, true);
        hoisted.pageRows.push({ ...fbPageOn, accessToken: '' });

        await recordAutoreplyEnabledIfEffective('user_1', 'ws_1');

        expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
    });

    it('counts a WhatsApp-only page (whatsapp toggle ON implies the number is set up)', async () => {
        const { db } = await import('../../src/db');
        await setMasters(false, true);
        hoisted.pageRows.push({
            autoReplyEnabled: false,
            instagramAutoReplyEnabled: false,
            whatsappAutoReplyEnabled: true,
            accessToken: '',
        });

        await recordAutoreplyEnabledIfEffective('user_1', 'ws_1');

        expect(vi.mocked(db.insert)).toHaveBeenCalledTimes(1);
    });

    it('fails safe (no emit, no throw) when the workspace store read rejects', async () => {
        const { db } = await import('../../src/db');
        const { captureError } = await import('../../src/utils/sentryHelpers');
        const { workspaceSettingsService } = await import('../../src/services/workspaceSettings');
        vi.mocked(workspaceSettingsService.getSettings).mockRejectedValue(new Error('redis down'));
        hoisted.pageRows.push(fbPageOn);

        await expect(recordAutoreplyEnabledIfEffective('user_1', 'ws_1')).resolves.toBeUndefined();

        expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
        expect(vi.mocked(captureError)).toHaveBeenCalled();
    });
});
