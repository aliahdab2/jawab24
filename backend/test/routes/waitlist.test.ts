import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import waitlistRoutes from '../../src/routes/waitlist';

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
});
