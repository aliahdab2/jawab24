import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import waitlistRoutes, { generateUnsubscribeToken } from '../../src/routes/waitlist';

const mockValues = vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn() });
const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockUpsertOnConflict = vi.fn().mockResolvedValue(undefined);
const mockInsertValues = vi.fn().mockReturnValue({ onConflictDoNothing: mockUpsertOnConflict });

// Mock the database
vi.mock('../../src/db', () => ({
    db: {
        insert: () => ({ values: (...args: unknown[]) => {
            // First call (waitlist signup) uses .values().onConflictDoNothing()
            // Second call (unsubscribe upsert) uses .values().onConflictDoNothing({ target })
            // mockValues handles signup; mockInsertValues handles unsubscribe — pick by call shape
            return args.length > 0 && typeof args[0] === 'object' && args[0] !== null && 'source' in (args[0] as object)
                ? mockInsertValues(args[0])
                : mockValues(...args);
        } }),
        update: () => ({ set: () => ({ where: mockUpdateWhere }) }),
    },
}));

vi.mock('../../src/db/schema', () => ({
    waitlistEmails: { email: 'email', unsubscribedAt: 'unsubscribed_at' },
    emailUnsubscribes: { email: 'email' },
}));

describe('Waitlist Routes', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        vi.clearAllMocks();
        app = Fastify();
        await app.register(waitlistRoutes, { prefix: '/api/waitlist' });
        await app.ready();
    });

    describe('POST /api/waitlist', () => {
        it('should accept a valid email and feature', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/waitlist',
                payload: {
                    contact: 'test@example.com',
                    feature: 'early_access',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
        });

        it('should accept a valid phone number and feature', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/waitlist',
                payload: {
                    contact: '+966501234567',
                    feature: 'launch',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
        });

        it('should reject invalid contact (not email or phone)', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/waitlist',
                payload: {
                    contact: 'not-valid',
                    feature: 'early_access',
                },
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(false);
        });

        it('should reject missing feature', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/waitlist',
                payload: {
                    contact: 'test@example.com',
                },
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(false);
        });

        it('should reject empty body', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/waitlist',
                payload: {},
            });

            expect(response.statusCode).toBe(400);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(false);
        });
    });

    describe('POST /api/waitlist/unsubscribe', () => {
        it('marks the waitlist row AND adds the email to the global suppression list', async () => {
            const email = 'unsubscribe-me@example.com';
            const token = generateUnsubscribeToken(email);

            const response = await app.inject({
                method: 'POST',
                url: '/api/waitlist/unsubscribe',
                payload: { email, token },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            // Both writes happened: waitlist update + global suppression upsert
            expect(mockUpdateWhere).toHaveBeenCalledTimes(1);
            expect(mockInsertValues).toHaveBeenCalledWith(
                expect.objectContaining({ email, source: 'waitlist' })
            );
            expect(mockUpsertOnConflict).toHaveBeenCalledTimes(1);
        });

        it('rejects an invalid token', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/waitlist/unsubscribe',
                payload: { email: 'a@b.com', token: 'wrong' },
            });

            expect(response.statusCode).toBe(403);
            expect(mockUpdateWhere).not.toHaveBeenCalled();
            expect(mockInsertValues).not.toHaveBeenCalled();
        });
    });
});
