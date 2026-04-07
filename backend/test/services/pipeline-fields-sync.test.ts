import { describe, it, expect } from 'vitest';

/**
 * Guard test: ensures all pipeline-relevant fields in the settings table
 * are synced to workspace settings via PIPELINE_FIELDS.
 *
 * If you add a new field to `settings` that the reply pipeline reads from
 * `workspaceSettings`, add it to PIPELINE_FIELDS in settings.ts — this
 * test will remind you.
 */

// We can't import PIPELINE_FIELDS directly (it's a module-scoped const),
// so we read the source and extract it.
import { readFileSync } from 'fs';
import { resolve } from 'path';

function extractPipelineFields(): string[] {
    const src = readFileSync(
        resolve(__dirname, '../../src/services/settings.ts'),
        'utf-8',
    );
    const match = src.match(/const PIPELINE_FIELDS\s*=\s*\[([\s\S]*?)\]\s*as const/);
    if (!match) throw new Error('Could not find PIPELINE_FIELDS in settings.ts');
    return [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
}

describe('PIPELINE_FIELDS sync guard', () => {
    const fields = extractPipelineFields();

    it('should include dualReplyNudgeVariations', () => {
        expect(fields).toContain('dualReplyNudgeVariations');
    });

    it('should include all core pipeline fields', () => {
        const required = [
            'commentsAutoReply',
            'messagesAutoReply',
            'commentReplyMode',
            'dualReplyNudge',
            'dualReplyNudgeMulti',
            'dualReplyNudgeVariations',
            'aiEnabled',
            'replyStyle',
            'holdLowConfidence',
        ];
        for (const field of required) {
            expect(fields, `Missing pipeline field: ${field}`).toContain(field);
        }
    });
});
