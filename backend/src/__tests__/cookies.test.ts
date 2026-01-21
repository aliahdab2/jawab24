import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cookiesService, COOKIE_OPTIONS, CSRF_COOKIE_OPTIONS } from '../services/cookies';

describe('CookiesService', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockReply: any;
    const mockToken = 'test-token-123';

    beforeEach(() => {
        mockReply = {
            setCookie: vi.fn(),
            clearCookie: vi.fn(),
        };
    });

    it('should set cookies with correct options', () => {
        cookiesService.setAuthCookies(mockReply, mockToken);

        // Expect main token cookie
        expect(mockReply.setCookie).toHaveBeenCalledWith('token', mockToken, expect.objectContaining({
            ...COOKIE_OPTIONS,
            maxAge: expect.any(Number),
        }));

        // Expect CSRF token cookie
        expect(mockReply.setCookie).toHaveBeenCalledWith('csrfToken', expect.any(String), expect.objectContaining({
            ...CSRF_COOKIE_OPTIONS,
            maxAge: expect.any(Number),
        }));
    });

    it('should clear cookies with correct options', () => {
        cookiesService.clearAuthCookies(mockReply);

        expect(mockReply.clearCookie).toHaveBeenCalledWith('token', expect.objectContaining({
            ...COOKIE_OPTIONS,
            path: '/'
        }));

        expect(mockReply.clearCookie).toHaveBeenCalledWith('csrfToken', expect.objectContaining({
            ...CSRF_COOKIE_OPTIONS,
            path: '/'
        }));
    });
});
