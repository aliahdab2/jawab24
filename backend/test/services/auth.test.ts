import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../../src/services/auth';

// Mock database
vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([]),
            }),
        }),
        insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{
                    id: 'user_uuid_123',
                    facebookId: 'fb_123',
                    name: 'John Doe',
                    email: 'john@example.com',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }]),
            }),
        }),
        update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            }),
        }),
    },
}));

vi.mock('../../src/db/schema', () => ({
    users: {},
    subscriptions: {},
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn(),
    sql: vi.fn(),
}));

describe('Auth Service', () => {
    let service: AuthService;

    beforeEach(() => {
        service = new AuthService();
        vi.clearAllMocks();
    });

    describe('generateToken', () => {
        it('should generate a base64 encoded token', () => {
            const user = {
                id: 'user_123',
                facebookId: 'fb_456',
                name: 'John Doe',
                email: 'john@example.com',
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const token = service.generateToken(user);

            expect(token).toBeDefined();
            expect(typeof token).toBe('string');
            expect(token.length).toBeGreaterThan(0);
        });

        it('should encode userId and facebookId in token', () => {
            const user = {
                id: 'user_123',
                facebookId: 'fb_456',
                name: 'John Doe',
                email: null,
                createdAt: null,
                updatedAt: null,
            };

            const token = service.generateToken(user);
            // Token format is now: base64url(payload).signature
            const [payloadStr] = token.split('.');
            const decoded = JSON.parse(Buffer.from(payloadStr, 'base64url').toString('utf-8'));

            expect(decoded.userId).toBe('user_123');
            expect(decoded.facebookId).toBe('fb_456');
            expect(decoded.exp).toBeDefined(); // Token now includes expiration
        });
    });

    describe('verifyToken', () => {
        it('should verify and decode a valid token', () => {
            const user = {
                id: 'user_123',
                facebookId: 'fb_456',
                name: 'John Doe',
                email: null,
                createdAt: null,
                updatedAt: null,
            };

            const token = service.generateToken(user);
            const payload = service.verifyToken(token);

            expect(payload).not.toBeNull();
            expect(payload?.userId).toBe('user_123');
            expect(payload?.facebookId).toBe('fb_456');
        });

        it('should return null for invalid token', () => {
            const payload = service.verifyToken('invalid_token');

            expect(payload).toBeNull();
        });

        it('should return null for malformed base64', () => {
            const payload = service.verifyToken('!!!not-base64!!!');

            expect(payload).toBeNull();
        });

        it('should return null for valid base64 but invalid JSON', () => {
            const invalidJson = Buffer.from('not json').toString('base64');
            const payload = service.verifyToken(invalidJson);

            expect(payload).toBeNull();
        });
    });

    describe('createAuthResponse', () => {
        it('should create auth response with user info', () => {
            const user = {
                id: 'user_123',
                facebookId: 'fb_456',
                name: 'John Doe',
                email: 'john@example.com',
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            const token = 'test_token';

            const response = service.createAuthResponse(user, token);

            expect(response.token).toBe('test_token');
            expect(response.user.id).toBe('user_123');
            expect(response.user.name).toBe('John Doe');
            expect(response.user.facebookId).toBe('fb_456');
        });

        it('should handle null name', () => {
            const user = {
                id: 'user_123',
                facebookId: 'fb_456',
                name: null,
                email: null,
                createdAt: null,
                updatedAt: null,
            };
            const token = 'test_token';

            const response = service.createAuthResponse(user, token);

            expect(response.user.name).toBe('');
        });
    });

    describe('Token round-trip', () => {
        it('should successfully encode and decode token', () => {
            const user = {
                id: 'unique_user_id_12345',
                facebookId: 'fb_unique_id_67890',
                name: 'Test User',
                email: 'test@example.com',
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const token = service.generateToken(user);
            const payload = service.verifyToken(token);

            expect(payload).not.toBeNull();
            expect(payload?.userId).toBe(user.id);
            expect(payload?.facebookId).toBe(user.facebookId);
        });
    });
});

