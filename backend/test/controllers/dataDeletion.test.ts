import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// --- Hoisted mocks (vi.mock factories are hoisted, so variables must be too) ---
const { mockSelectLimit, mockDeleteUser, mockAuditLog, APP_SECRET } = vi.hoisted(() => ({
    mockSelectLimit: vi.fn().mockResolvedValue([]),
    mockDeleteUser: vi.fn().mockResolvedValue(undefined),
    mockAuditLog: vi.fn().mockResolvedValue(undefined),
    APP_SECRET: 'test_app_secret_123',
}));

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: mockSelectLimit,
                }),
            }),
        }),
    },
}));

vi.mock('../../src/db/schema', () => ({
    users: { id: 'id', facebookId: 'facebookId' },
}));

vi.mock('../../src/config', () => ({
    config: {
        facebook: {
            appId: 'test_app_id',
            appSecret: APP_SECRET,
            webhookVerifyToken: 'test_verify',
        },
        shopify: { hostName: 'jawab24.com' },
    },
}));

vi.mock('../../src/lib/replyQueue', () => ({
    enqueueComment: vi.fn().mockResolvedValue('job-1'),
    enqueueMessage: vi.fn().mockResolvedValue('job-2'),
}));

vi.mock('../../src/lib/redis', () => ({
    redis: {
        get: vi.fn(),
        set: vi.fn(),
        quit: vi.fn(),
    },
}));

vi.mock('../../src/services/auth', () => ({
    authService: { deleteUser: mockDeleteUser },
}));

vi.mock('../../src/services/messages', () => ({
    messagesService: { findOrCreateFromWebhook: vi.fn() },
}));

vi.mock('../../src/services/pages', () => ({
    pagesService: { getPageByFacebookId: vi.fn() },
}));

vi.mock('../../src/services/auditLog', () => ({
    auditLog: mockAuditLog,
}));

vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

import { WebhookController } from '../../src/controllers/webhook';

// --- Helpers ---

/** Build a valid Facebook signed_request for testing */
function buildSignedRequest(payload: object): string {
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto
        .createHmac('sha256', APP_SECRET)
        .update(encodedPayload)
        .digest('base64url');
    return `${sig}.${encodedPayload}`;
}

function makeRequest(body: any) {
    return {
        body,
        headers: {},
        log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), fatal: vi.fn(), trace: vi.fn(), child: vi.fn() },
    } as any;
}

function makeReply() {
    const reply: any = {
        statusCode: 200,
        _body: null,
        status(code: number) { reply.statusCode = code; return reply; },
        send(body?: any) { reply._body = body; return reply; },
    };
    return reply;
}

describe('WebhookController.handleDataDeletion', () => {
    let controller: WebhookController;

    beforeEach(() => {
        vi.clearAllMocks();
        controller = new WebhookController();
        mockSelectLimit.mockResolvedValue([]);
    });

    it('should return 400 when signed_request is missing', async () => {
        const req = makeRequest({});
        const reply = makeReply();

        await controller.handleDataDeletion(req, reply);

        expect(reply.statusCode).toBe(400);
        expect(reply._body).toEqual({ error: 'Missing signed_request' });
    });

    it('should return 400 for malformed signed_request (no dot)', async () => {
        const req = makeRequest({ signed_request: 'no-dot-here' });
        const reply = makeReply();

        await controller.handleDataDeletion(req, reply);

        expect(reply.statusCode).toBe(400);
        expect(reply._body).toEqual({ error: 'Malformed signed_request' });
    });

    it('should return 403 for invalid signature', async () => {
        const encodedPayload = Buffer.from(JSON.stringify({ user_id: '123' })).toString('base64url');
        const badSig = Buffer.from('bad_signature').toString('base64url');
        const req = makeRequest({ signed_request: `${badSig}.${encodedPayload}` });
        const reply = makeReply();

        await controller.handleDataDeletion(req, reply);

        expect(reply.statusCode).toBe(403);
        expect(reply._body).toEqual({ error: 'Invalid signature' });
    });

    it('should return 400 when payload has no user_id', async () => {
        const signedReq = buildSignedRequest({ some_field: 'value' });
        const req = makeRequest({ signed_request: signedReq });
        const reply = makeReply();

        await controller.handleDataDeletion(req, reply);

        expect(reply.statusCode).toBe(400);
        expect(reply._body).toEqual({ error: 'Missing user_id in payload' });
    });

    it('should return confirmation response for valid request', async () => {
        const signedReq = buildSignedRequest({ user_id: 'fb-user-789' });
        const req = makeRequest({ signed_request: signedReq });
        const reply = makeReply();

        await controller.handleDataDeletion(req, reply);

        expect(reply.statusCode).toBe(200);
        expect(reply._body).toHaveProperty('url');
        expect(reply._body).toHaveProperty('confirmation_code');
        expect(reply._body.url).toContain('jawab24.com');
        expect(reply._body.url).toContain(reply._body.confirmation_code);
    });

    it('should trigger async user deletion when user exists', async () => {
        mockSelectLimit.mockResolvedValueOnce([{ id: 'internal-user-123' }]);

        const signedReq = buildSignedRequest({ user_id: 'fb-user-789' });
        const req = makeRequest({ signed_request: signedReq });
        const reply = makeReply();

        await controller.handleDataDeletion(req, reply);

        // Response is returned immediately
        expect(reply._body).toHaveProperty('confirmation_code');

        // Wait for the async IIFE to complete
        await new Promise(r => setTimeout(r, 50));

        expect(mockAuditLog).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'internal-user-123',
                action: 'account.fb_data_deletion',
            }),
        );
        expect(mockDeleteUser).toHaveBeenCalledWith('internal-user-123');
    });

    it('should not call deleteUser when no user is found', async () => {
        mockSelectLimit.mockResolvedValueOnce([]); // no user found

        const signedReq = buildSignedRequest({ user_id: 'fb-unknown' });
        const req = makeRequest({ signed_request: signedReq });
        const reply = makeReply();

        await controller.handleDataDeletion(req, reply);

        await new Promise(r => setTimeout(r, 50));

        expect(mockDeleteUser).not.toHaveBeenCalled();
        expect(mockAuditLog).not.toHaveBeenCalled();
    });
});
