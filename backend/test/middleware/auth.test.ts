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

  it('should skip for Bearer token auth (mobile)', async () => {
    mockRequest.headers.authorization = 'Bearer some-token';
    await csrfProtection(mockRequest as FastifyRequest, mockReply as FastifyReply);
    expect(mockReply.status).not.toHaveBeenCalled();
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
});
