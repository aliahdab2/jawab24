import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The reply-mode pilot allowlist is the ONLY way to stop `'info'` writes
 * without shipping code, so its parse must honour an explicitly empty env var.
 * With the obvious `process.env.X || DEFAULTS` an operator who sets the var to
 * `''` mid-incident silently gets the built-in pilot workspace back — there
 * would be no env-only kill switch at all, and the config's own "empty list
 * enables NOBODY" comment would describe an unreachable state (#797 review).
 *
 * The module reads env at import time, so each case re-imports it fresh.
 */
async function loadWorkspaceIds(value?: string): Promise<string[]> {
    vi.resetModules();
    if (value === undefined) delete process.env.REPLY_MODE_WORKSPACE_IDS;
    else process.env.REPLY_MODE_WORKSPACE_IDS = value;
    const { config } = await import('../../src/config');
    return [...config.replyMode.workspaceIds];
}

describe('config.replyMode.workspaceIds — the pilot kill switch', () => {
    const saved = process.env.REPLY_MODE_WORKSPACE_IDS;

    beforeEach(() => { vi.resetModules(); });
    afterEach(() => {
        if (saved === undefined) delete process.env.REPLY_MODE_WORKSPACE_IDS;
        else process.env.REPLY_MODE_WORKSPACE_IDS = saved;
        vi.resetModules();
    });

    it('falls back to the built-in pilot workspace when the var is UNSET', async () => {
        expect(await loadWorkspaceIds(undefined)).toEqual(['d06ed500-74ea-42ee-bff6-37bee2cf412a']);
    });

    it('an EXPLICITLY EMPTY var enables nobody — it must not resurrect the default', async () => {
        expect(await loadWorkspaceIds('')).toEqual([]);
    });

    it('a whitespace-only var is also empty, not the default', async () => {
        expect(await loadWorkspaceIds('  ,  ')).toEqual([]);
    });

    it('parses and trims a real list', async () => {
        expect(await loadWorkspaceIds(' ws-a , ws-b ')).toEqual(['ws-a', 'ws-b']);
    });
});
