import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CookiesService, COOKIE_OPTIONS, CSRF_COOKIE_OPTIONS, REFRESH_COOKIE_OPTIONS } from '../../src/services/cookies';

describe('CookiesService', () => {
    let service: CookiesService;
    let mockReply: { setCookie: ReturnType<typeof vi.fn>; clearCookie: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        vi.clearAllMocks();
        service = new CookiesService();
        mockReply = {
            setCookie: vi.fn(),
            clearCookie: vi.fn(),
        };
    });

    describe('COOKIE_OPTIONS constants', () => {
        it('should have httpOnly enabled for main cookie', () => {
            expect(COOKIE_OPTIONS.httpOnly).toBe(true);
        });

        it('should have strict sameSite', () => {
            expect(COOKIE_OPTIONS.sameSite).toBe('strict');
        });

        it('should be signed', () => {
            expect(COOKIE_OPTIONS.signed).toBe(true);
        });

        it('CSRF cookie should NOT be httpOnly (JS needs access)', () => {
            expect(CSRF_COOKIE_OPTIONS.httpOnly).toBe(false);
        });

        it('CSRF cookie should NOT be signed', () => {
            expect(CSRF_COOKIE_OPTIONS.signed).toBe(false);
        });

        it('REFRESH cookie should have restricted path', () => {
            expect(REFRESH_COOKIE_OPTIONS.path).toBe('/auth/refresh');
        });
    });

    describe('setAuthCookies', () => {
        it('should set token cookie with correct options', () => {
            service.setAuthCookies(mockReply as any, 'jwt-token-123');

            expect(mockReply.setCookie).toHaveBeenCalledWith('token', 'jwt-token-123', expect.objectContaining({
                httpOnly: true,
                sameSite: 'strict',
                signed: true,
                path: '/',
            }));
        });

        it('should set CSRF token cookie', () => {
            service.setAuthCookies(mockReply as any, 'jwt-token-123');

            // Second call should be the CSRF cookie
            expect(mockReply.setCookie).toHaveBeenCalledTimes(2);
            const csrfCall = mockReply.setCookie.mock.calls[1];
            expect(csrfCall[0]).toBe('csrfToken');
            expect(csrfCall[1]).toMatch(/^[0-9a-f]{64}$/); // 32 bytes = 64 hex chars
            expect(csrfCall[2]).toMatchObject({
                httpOnly: false,
                signed: false,
            });
        });

        it('should set maxAge on both cookies', () => {
            service.setAuthCookies(mockReply as any, 'jwt-token-123');

            const tokenCall = mockReply.setCookie.mock.calls[0];
            const csrfCall = mockReply.setCookie.mock.calls[1];
            expect(tokenCall[2].maxAge).toBeGreaterThan(0);
            expect(csrfCall[2].maxAge).toBeGreaterThan(0);
        });
    });

    describe('setRefreshTokenCookie', () => {
        it('should set refresh token cookie with restricted path', () => {
            service.setRefreshTokenCookie(mockReply as any, 'refresh-token-456');

            expect(mockReply.setCookie).toHaveBeenCalledWith('refreshToken', 'refresh-token-456', expect.objectContaining({
                path: '/auth/refresh',
                httpOnly: true,
                signed: true,
            }));
        });

        it('should set maxAge for 7 days', () => {
            service.setRefreshTokenCookie(mockReply as any, 'refresh-token-456');

            const call = mockReply.setCookie.mock.calls[0];
            const expectedMaxAge = (7 * 24 * 60 * 60 * 1000) / 1000;
            expect(call[2].maxAge).toBe(expectedMaxAge);
        });
    });

    describe('clearAuthCookies', () => {
        it('should clear all three cookies', () => {
            service.clearAuthCookies(mockReply as any);

            expect(mockReply.clearCookie).toHaveBeenCalledTimes(3);
            expect(mockReply.clearCookie).toHaveBeenCalledWith('token', expect.objectContaining({ path: '/' }));
            expect(mockReply.clearCookie).toHaveBeenCalledWith('csrfToken', expect.objectContaining({ path: '/' }));
            expect(mockReply.clearCookie).toHaveBeenCalledWith('refreshToken', expect.objectContaining({
                path: '/auth/refresh',
            }));
        });
    });
});
