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

vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        createSubscription: vi.fn().mockResolvedValue({ id: 'sub_1', status: 'trialing' }),
        getUserSubscription: vi.fn().mockResolvedValue(null),
    },
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

        it('should encode userId in token', () => {
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
            expect(decoded.facebookId).toBeUndefined();
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
            const fbToken = 'fb_token_123';

            const response = service.createAuthResponse(user, token, fbToken);

            expect(response.token).toBe('test_token');
            expect(response.fbAccessToken).toBe('fb_token_123');
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
            const fbToken = 'fb_token_123';

            const response = service.createAuthResponse(user, token, fbToken);

            expect(response.user.name).toBe('');
        });

        it('should include settings when provided', () => {
            const user = {
                id: 'user_123',
                facebookId: 'fb_456',
                name: 'John Doe',
                email: 'john@example.com',
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            const token = 'test_token';
            const fbToken = 'fb_token_123';
            const settings = {
                dashboardLanguage: 'ar'
            };

            const response = service.createAuthResponse(user, token, fbToken, settings);

            expect(response.settings).toBeDefined();
            expect(response.settings?.dashboardLanguage).toBe('ar');
        });

        it('should include picture when available', () => {
            const user = {
                id: 'user_123',
                facebookId: 'fb_456',
                name: 'John Doe',
                email: 'john@example.com',
                picture: 'https://example.com/photo.jpg',
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            const token = 'test_token';
            const fbToken = 'fb_token_123';

            const response = service.createAuthResponse(user, token, fbToken);

            expect(response.user.picture).toBe('https://example.com/photo.jpg');
        });

        it('should handle user without picture', () => {
            const user = {
                id: 'user_123',
                facebookId: 'fb_456',
                name: 'John Doe',
                email: 'john@example.com',
                picture: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            const token = 'test_token';
            const fbToken = 'fb_token_123';

            const response = service.createAuthResponse(user, token, fbToken);

            expect(response.user.picture).toBeUndefined();
        });
    });

    describe('findOrCreateUser', () => {
        it('should call ensureSubscription for returning users', async () => {
            const { db } = await import('../../src/db');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            // Mock existing user found
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([{
                        id: 'user_existing',
                        facebookId: 'fb_123',
                        name: 'Existing User',
                        email: 'existing@example.com',
                        picture: null,
                        facebookAccessToken: 'old_token',
                        facebookTokenExpiresAt: null,
                        isAdmin: false,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    }]),
                }),
            } as any);

            await service.findOrCreateUser('fb_123', 'Updated Name', 'existing@example.com', 'new_token');

            // Should check for subscription and create if missing
            expect(subscriptionsService.getUserSubscription).toHaveBeenCalledWith('user_existing');
            expect(subscriptionsService.createSubscription).toHaveBeenCalledWith('user_existing');
        });

        it('should not create subscription if returning user already has one', async () => {
            const { db } = await import('../../src/db');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            // Mock existing user found
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([{
                        id: 'user_existing',
                        facebookId: 'fb_123',
                        name: 'Existing User',
                        email: 'existing@example.com',
                        picture: null,
                        facebookAccessToken: 'old_token',
                        facebookTokenExpiresAt: null,
                        isAdmin: false,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    }]),
                }),
            } as any);

            // User already has subscription
            vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValueOnce({ id: 'sub_existing' } as any);

            await service.findOrCreateUser('fb_123', 'Updated Name', 'existing@example.com', 'new_token');

            expect(subscriptionsService.getUserSubscription).toHaveBeenCalledWith('user_existing');
            // Should NOT create a new one since it already exists
            expect(subscriptionsService.createSubscription).not.toHaveBeenCalled();
        });

        it('should create subscription for new users', async () => {
            const { db } = await import('../../src/db');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            // Mock no existing user
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            } as any);

            // Mock insert returning new user
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{
                        id: 'user_new',
                        facebookId: 'fb_new',
                        name: 'New User',
                        email: 'new@example.com',
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    }]),
                }),
            } as any);

            await service.findOrCreateUser('fb_new', 'New User', 'new@example.com');

            expect(subscriptionsService.createSubscription).toHaveBeenCalledWith('user_new');
        });
    });

    describe('createSubscriptionForNewUser - retry logic', () => {
        it('should retry once if first subscription creation fails', async () => {
            const { db } = await import('../../src/db');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            // Mock no existing user → new user path
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            } as any);
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{
                        id: 'user_retry',
                        facebookId: 'fb_retry',
                        name: 'Retry User',
                        email: null,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    }]),
                }),
            } as any);

            // First call fails, second succeeds
            vi.mocked(subscriptionsService.createSubscription)
                .mockRejectedValueOnce(new Error('DB connection lost'))
                .mockResolvedValueOnce({ id: 'sub_retry' } as any);

            await service.findOrCreateUser('fb_retry', 'Retry User');

            // Should have been called twice (initial + retry)
            expect(subscriptionsService.createSubscription).toHaveBeenCalledTimes(2);
            expect(subscriptionsService.createSubscription).toHaveBeenNthCalledWith(1, 'user_retry');
            expect(subscriptionsService.createSubscription).toHaveBeenNthCalledWith(2, 'user_retry');
        });

        it('should not throw if both subscription creation attempts fail', async () => {
            const { db } = await import('../../src/db');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            } as any);
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{
                        id: 'user_fail',
                        facebookId: 'fb_fail',
                        name: 'Fail User',
                        email: null,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    }]),
                }),
            } as any);

            // Both calls fail
            vi.mocked(subscriptionsService.createSubscription)
                .mockRejectedValueOnce(new Error('First fail'))
                .mockRejectedValueOnce(new Error('Second fail'));

            // Should NOT throw — user creation should still succeed
            const user = await service.findOrCreateUser('fb_fail', 'Fail User');
            expect(user).toBeDefined();
            expect(user.id).toBe('user_fail');
            expect(subscriptionsService.createSubscription).toHaveBeenCalledTimes(2);
        });
    });

    describe('ensureSubscription - error handling', () => {
        it('should silently catch errors in ensureSubscription', async () => {
            const { db } = await import('../../src/db');
            const { subscriptionsService } = await import('../../src/services/subscriptions');

            // Mock returning user
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([{
                        id: 'user_err',
                        facebookId: 'fb_err',
                        name: 'Error User',
                        email: null,
                        picture: null,
                        facebookAccessToken: null,
                        facebookTokenExpiresAt: null,
                        isAdmin: false,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    }]),
                }),
            } as any);

            // getUserSubscription throws
            vi.mocked(subscriptionsService.getUserSubscription).mockRejectedValueOnce(
                new Error('DB timeout')
            );

            // Should NOT throw — login should still succeed
            const user = await service.findOrCreateUser('fb_err', 'Error User');
            expect(user).toBeDefined();
            expect(user.facebookId).toBe('fb_err');
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
        });
    });
});

