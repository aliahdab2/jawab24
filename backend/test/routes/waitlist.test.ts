import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import waitlistRoutes from '../../src/routes/waitlist';

const mockInsert = vi.fn();
const mockValues = vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn() });

// Mock the database
vi.mock('../../src/db', () => ({
    db: {
        insert: () => ({ values: mockValues }),
    },
}));

vi.mock('../../src/db/schema', () => ({
    waitlistEmails: {},
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
                    email: 'test@example.com',
                    feature: 'early_access',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
        });

        it('should reject invalid email', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/waitlist',
                payload: {
                    email: 'not-an-email',
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
                    email: 'test@example.com',
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
});
