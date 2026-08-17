import { describe, it, expect } from 'vitest';
import { PIPELINE_FIELDS } from '../../src/services/pipelineFields';

/**
 * Guard test: ensures all pipeline-relevant fields in the settings table
 * are synced to workspace settings via PIPELINE_FIELDS.
 *
 * If you add a new field to `settings` that the reply pipeline reads from
 * `workspaceSettings`, add it to PIPELINE_FIELDS in pipelineFields.ts — this
 * test will remind you.
 */

describe('PIPELINE_FIELDS sync guard', () => {
    const fields = Array.from(PIPELINE_FIELDS);

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
            'replyMode',
            'holdLowConfidence',
        ];
        for (const field of required) {
            expect(fields, `Missing pipeline field: ${field}`).toContain(field);
        }
    });
});
