import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authenticate } from '../../src/middleware/auth';
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
      facebookId: 'fb-123',
    } as any);

    await authenticate(mockRequest as FastifyRequest, mockReply as FastifyReply);

    // Assertions
    expect(mockRequest.unsignCookie).toHaveBeenCalledWith(signedToken);
    expect(authService.verifyToken).toHaveBeenCalledWith(validToken);
    expect(mockRequest.user).toEqual({
      userId: 'user-123',
      facebookId: 'fb-123',
    });
    expect(mockReply.status).not.toHaveBeenCalled();
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
