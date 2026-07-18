import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authenticate, csrfProtection } from '../../src/middleware/auth';
import { authService } from '../../src/services/auth';
import { FastifyReply, FastifyRequest } from 'fastify';

// Mock dependencies
vi.mock('../../src/services/auth', () => ({
  authService: {
    verifyToken: vi.fn(),
  },
}));

describe('Authenticate Middleware', () => {
  let mockRequest: any;
  let mockReply: any;

  beforeEach(() => {
    mockRequest = {
      headers: {},
      cookies: {},
      log: { error: vi.fn() },
      unsignCookie: vi.fn(),
      user: undefined,
    };
    
    mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    vi.clearAllMocks();
  });

  it('should authenticate with valid signed cookie', async () => {
    const validToken = 'valid.jwt.token';
    const signedToken = 'valid.jwt.token.signed';
    
    // Setup request with signed cookie
    mockRequest.cookies.token = signedToken;
    
    // Mock unsignCookie to return the valid token
    mockRequest.unsignCookie.mockReturnValue({
      valid: true,
      value: validToken,
    });

    // Mock verifyToken to return payload
    vi.mocked(authService.verifyToken).mockReturnValue({
      userId: 'user-123',
    } as any);

    await authenticate(mockRequest as FastifyRequest, mockReply as FastifyReply);

    // Assertions
    expect(mockRequest.unsignCookie).toHaveBeenCalledWith(signedToken);
    expect(authService.verifyToken).toHaveBeenCalledWith(validToken);
    expect(mockRequest.user).toEqual({
      userId: 'user-123',
      isAdmin: false,
    });
    expect(mockReply.status).not.toHaveBeenCalled();
  });

  it('should handle null cookies gracefully', async () => {
    mockRequest.cookies = null;
    mockRequest.headers.authorization = 'Bearer valid-token';

    vi.mocked(authService.verifyToken).mockReturnValue({
      userId: 'user-123',
    } as any);

    await authenticate(mockRequest as FastifyRequest, mockReply as FastifyReply);

    expect(authService.verifyToken).toHaveBeenCalledWith('valid-token');
  });

  it('should fail if cookie signature is invalid', async () => {
    const signedToken = 'tampered.token.signed';

    mockRequest.cookies.token = signedToken;

    // Mock unsignCookie to fail
    mockRequest.unsignCookie.mockReturnValue({
      valid: false,
      value: null,
    });

    await authenticate(mockRequest as FastifyRequest, mockReply as FastifyReply);

    expect(mockRequest.unsignCookie).toHaveBeenCalledWith(signedToken);
    // Should verifyToken NOT be called (or called with undefined if logic falls through?
    // In our implementation, if unsign fails, token remains undefined)
    expect(authService.verifyToken).not.toHaveBeenCalled();

    expect(mockReply.status).toHaveBeenCalledWith(401);
    expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
      code: 'AUTH_FAILED',
    }));
  });

  // The csrfProtection Bearer-skip is only safe because authenticate() gives a "Bearer ..."
  // header absolute priority and NEVER falls back to the cookie, while a NON-Bearer header
  // DOES fall through to the cookie. These pin that exact split so the skip can't silently
  // become unsafe (e.g. if someone later loosens the Bearer branch to any header).
  it('uses the Bearer token and never the cookie when the header is "Bearer ..."', async () => {
    mockRequest.headers.authorization = 'Bearer garbage';
    mockRequest.cookies.token = 'valid-looking-cookie';
    vi.mocked(authService.verifyToken).mockReturnValue(null); // Bearer token invalid

    await authenticate(mockRequest as FastifyRequest, mockReply as FastifyReply);

    // Verified the Bearer value, not the cookie → 401. Cookie was never unsigned/consulted.
    expect(authService.verifyToken).toHaveBeenCalledWith('garbage');
    expect(authService.verifyToken).toHaveBeenCalledTimes(1);
    expect(mockRequest.unsignCookie).not.toHaveBeenCalled();
    expect(mockReply.status).toHaveBeenCalledWith(401);
  });

  it('falls through to the cookie for a NON-Bearer Authorization header (why non-Bearer keeps CSRF)', async () => {
    mockRequest.headers.authorization = 'Basic Zm9vOmJhcg==';
    mockRequest.cookies.token = 'signed-cookie';
    mockRequest.unsignCookie.mockReturnValue({ valid: true, value: 'cookie-token' });
    vi.mocked(authService.verifyToken).mockReturnValue({ userId: 'u1' } as any);

    await authenticate(mockRequest as FastifyRequest, mockReply as FastifyReply);

    // Non-Bearer header is ignored; the cookie is the auth source.
    expect(mockRequest.unsignCookie).toHaveBeenCalledWith('signed-cookie');
    expect(authService.verifyToken).toHaveBeenCalledWith('cookie-token');
    expect(mockRequest.user).toMatchObject({ userId: 'u1' });
    expect(mockReply.status).not.toHaveBeenCalled();
  });
});

describe('CSRF Protection Middleware', () => {
  let mockRequest: any;
  let mockReply: any;

  beforeEach(() => {
    mockRequest = {
      headers: {},
      cookies: {},
      method: 'POST',
    };

    mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
  });

  it('should skip for Bearer-only auth (mobile, no auth cookie)', async () => {
    mockRequest.headers.authorization = 'Bearer some-token';
    mockRequest.cookies = {};
    await csrfProtection(mockRequest as FastifyRequest, mockReply as FastifyReply);
    expect(mockReply.status).not.toHaveBeenCalled();
  });

  it('should SKIP CSRF for a Bearer request even when a token cookie is also present (the app fix)', async () => {
    // The Capacitor app is served from app.jawab24.com while the API + cookies live on
    // jawab24.com. Same-site rules make the WebView SEND the token+csrfToken cookies, but
    // document.cookie can't READ csrfToken cross-host, so the axios interceptor can't
    // attach X-CSRF-Token. The app authenticates via Bearer, so authenticate() uses the
    // header and never the cookie — CSRF (a defense against ambient cookie credentials)
    // does not apply. Enforcing it here 403'd every app mutation for 15 min after login.
    //
    // Safe against the real CSRF threat model: a cross-origin attacker cannot set an
    // Authorization header at all (CORS blocks it). The prior "XSS could inject a header
    // to bypass CSRF" rationale conflated threat models — XSS already fully defeats CSRF
    // by reading the httpOnly:false csrfToken cookie and forging a valid header, so the
    // Bearer-skip adds no XSS exposure.
    mockRequest.headers.authorization = 'Bearer some-token';
    mockRequest.cookies = { token: 'valid-session' }; // no csrfToken
    await csrfProtection(mockRequest as FastifyRequest, mockReply as FastifyReply);
    expect(mockReply.status).not.toHaveBeenCalled();
  });

  it('should STILL enforce CSRF for a NON-Bearer Authorization header + token cookie (closed gap)', async () => {
    // authenticate() only takes the Bearer branch when the header starts with "Bearer ".
    // A non-Bearer header (e.g. Basic ...) falls through to the cookie, so the cookie IS
    // the auth source and CSRF must still apply. The skip is gated on the "Bearer " prefix
    // (not merely "a header exists") precisely to keep this case protected.
    mockRequest.headers.authorization = 'Basic Zm9vOmJhcg==';
    mockRequest.cookies = { token: 'valid-session' }; // no csrfToken
    await csrfProtection(mockRequest as FastifyRequest, mockReply as FastifyReply);
    expect(mockReply.status).toHaveBeenCalledWith(403);
    expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
      code: 'CSRF_INVALID',
    }));
  });

  it('should skip for GET requests', async () => {
    mockRequest.method = 'GET';
    await csrfProtection(mockRequest as FastifyRequest, mockReply as FastifyReply);
    expect(mockReply.status).not.toHaveBeenCalled();
  });

  it('should skip for HEAD requests', async () => {
    mockRequest.method = 'HEAD';
    await csrfProtection(mockRequest as FastifyRequest, mockReply as FastifyReply);
    expect(mockReply.status).not.toHaveBeenCalled();
  });

  it('should skip for OPTIONS requests', async () => {
    mockRequest.method = 'OPTIONS';
    await csrfProtection(mockRequest as FastifyRequest, mockReply as FastifyReply);
    expect(mockReply.status).not.toHaveBeenCalled();
  });

  it('should skip when cookies is null (pre-parse state)', async () => {
    mockRequest.cookies = null;
    await csrfProtection(mockRequest as FastifyRequest, mockReply as FastifyReply);
    expect(mockReply.status).not.toHaveBeenCalled();
  });

  it('should skip when cookies is undefined', async () => {
    mockRequest.cookies = undefined;
    await csrfProtection(mockRequest as FastifyRequest, mockReply as FastifyReply);
    expect(mockReply.status).not.toHaveBeenCalled();
  });

  it('should skip when no auth cookie (unauthenticated request)', async () => {
    mockRequest.cookies = {};
    await csrfProtection(mockRequest as FastifyRequest, mockReply as FastifyReply);
    expect(mockReply.status).not.toHaveBeenCalled();
  });

  it('should reject when auth cookie exists but no CSRF token', async () => {
    mockRequest.cookies = { token: 'valid-session' };
    await csrfProtection(mockRequest as FastifyRequest, mockReply as FastifyReply);
    expect(mockReply.status).toHaveBeenCalledWith(403);
    expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({
      code: 'CSRF_INVALID',
    }));
  });

  it('should reject when CSRF tokens do not match', async () => {
    mockRequest.cookies = { token: 'valid-session', csrfToken: 'token-a' };
    mockRequest.headers['x-csrf-token'] = 'token-b';
    await csrfProtection(mockRequest as FastifyRequest, mockReply as FastifyReply);
    expect(mockReply.status).toHaveBeenCalledWith(403);
  });

  it('should pass when CSRF tokens match', async () => {
    mockRequest.cookies = { token: 'valid-session', csrfToken: 'matching-token' };
    mockRequest.headers['x-csrf-token'] = 'matching-token';
    await csrfProtection(mockRequest as FastifyRequest, mockReply as FastifyReply);
    expect(mockReply.status).not.toHaveBeenCalled();
  });

  // Regression (JAWAB24-FRONTEND-2M): a returning user whose browser still holds a
  // valid `token` cookie was 403'd out of logging in — the /auth/callback login POST
  // is a raw fetch that carries the cookie but no X-CSRF-Token header. The OAuth
  // login/exchange endpoints authenticate from the body `code`, not the cookie, so
  // they are CSRF-exempt.
  it.each([
    '/auth/facebook',
    '/auth/facebook/native',
    '/auth/facebook/link',
    '/auth/phone/request',
    '/auth/phone/verify',
  ])('should skip CSRF for the auth exchange endpoint %s even with a stale token cookie and no header', async (url) => {
    mockRequest.routeOptions = { url };
    mockRequest.cookies = { token: 'stale-session' }; // present, but no csrfToken / header
    await csrfProtection(mockRequest as FastifyRequest, mockReply as FastifyReply);
    expect(mockReply.status).not.toHaveBeenCalled();
  });

  it('should NOT exempt /auth/phone/link — it acts on the current session', async () => {
    // Unlike request/verify (identity from the OTP), link mutates the logged-in user and
    // rides the authenticated api client, so it keeps CSRF (web) / Bearer-skip (app).
    mockRequest.routeOptions = { url: '/auth/phone/link' };
    mockRequest.cookies = { token: 'valid-session' };
    await csrfProtection(mockRequest as FastifyRequest, mockReply as FastifyReply);
    expect(mockReply.status).toHaveBeenCalledWith(403);
    expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'CSRF_INVALID' }));
  });

  it('should STILL enforce CSRF on a non-exempt route with a token cookie and no header', async () => {
    mockRequest.routeOptions = { url: '/pages/:id/whatsapp' };
    mockRequest.cookies = { token: 'valid-session' };
    await csrfProtection(mockRequest as FastifyRequest, mockReply as FastifyReply);
    expect(mockReply.status).toHaveBeenCalledWith(403);
    expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'CSRF_INVALID' }));
  });
});
