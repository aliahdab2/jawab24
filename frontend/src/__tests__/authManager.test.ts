/**
 * AuthManager Test Suite - Comprehensive Coverage
 * 
 * Tests the centralized authentication manager that handles:
 * - Singleton pattern
 * - Token refresh with request queuing
 * - Centralized logout
 * - Auth state change notifications (Observer pattern)
 * - Error handling and edge cases
 * - Browser reopen with expired token (regression)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AxiosResponse } from 'axios';
import { createMockAxios, axiosErrorWith } from './testUtils/mockAxios';

// Mock the store module before importing authManager
vi.mock('../lib/store', () => ({
  useAuthStore: {
    setState: vi.fn(),
    getState: vi.fn(() => ({
      user: null,
      token: null,
      fbToken: null,
      isAuthenticated: false,
      // refreshToken() adopts the rotated access token through this action.
      // Omitting it here makes a successful refresh throw and report FAILURE —
      // the hand-rolled-mock trap: the mock, not the code, decides the verdict.
      setToken: vi.fn(),
    })),
  },
}));

// Mock publicApi to prevent actual API calls
vi.mock('../lib/api', () => ({
  publicApi: {
    post: vi.fn().mockResolvedValue({ data: { success: true } }),
  },
}));

// Mock sentryHelpers
const mockCaptureError = vi.fn();
vi.mock('../lib/sentryHelpers', () => ({
  captureError: (...args: unknown[]) => mockCaptureError(...args),
  addErrorBreadcrumb: vi.fn(),
}));

describe('AuthManager', () => {
  let authManager: typeof import('../lib/authManager').authManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Reset the module to get a fresh singleton instance
    vi.resetModules();
    
    // Re-import after reset
    const authModule = await import('../lib/authManager');
    authManager = authModule.authManager;
    
    // Mock window.location
    Object.defineProperty(window, 'location', {
      value: {
        pathname: '/dashboard',
        href: '/dashboard',
      },
      writable: true,
    });
    
    // Mock localStorage
    const localStorageMock = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    };
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================================
  // SINGLETON PATTERN TESTS
  // ============================================================================
  describe('Singleton Pattern', () => {
    it('should return the same instance on multiple calls', async () => {
      const authModule = await import('../lib/authManager');
      const instance1 = authModule.authManager;
      const instance2 = authModule.authManager;
      expect(instance1).toBe(instance2);
    });

    it('should maintain state across getInstance calls', async () => {
      const callback = vi.fn();
      authManager.onAuthStateChange(callback);
      
      // Get "another" instance (should be same)
      const authModule = await import('../lib/authManager');
      await authModule.authManager.logout({ redirect: false });
      
      // Callback should be called because it's the same instance
      expect(callback).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // AUTH STATE CHANGE (OBSERVER PATTERN) TESTS
  // ============================================================================
  describe('onAuthStateChange (Observer Pattern)', () => {
    it('should register a listener and call it on auth state change', async () => {
      const callback = vi.fn();
      authManager.onAuthStateChange(callback);
      
      await authManager.logout({ redirect: false });
      
      expect(callback).toHaveBeenCalledWith(false);
    });

    it('should support multiple listeners', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();
      
      authManager.onAuthStateChange(callback1);
      authManager.onAuthStateChange(callback2);
      authManager.onAuthStateChange(callback3);
      
      await authManager.logout({ redirect: false });
      
      expect(callback1).toHaveBeenCalledWith(false);
      expect(callback2).toHaveBeenCalledWith(false);
      expect(callback3).toHaveBeenCalledWith(false);
    });

    it('should allow unsubscribing from auth state changes', async () => {
      const callback = vi.fn();
      const unsubscribe = authManager.onAuthStateChange(callback);
      
      unsubscribe();
      
      await authManager.logout({ redirect: false });
      
      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle listener errors gracefully without affecting other listeners', async () => {
      const errorCallback = vi.fn().mockImplementation(() => {
        throw new Error('Listener error');
      });
      const successCallback = vi.fn();
      mockCaptureError.mockClear();

      authManager.onAuthStateChange(errorCallback);
      authManager.onAuthStateChange(successCallback);

      await authManager.logout({ redirect: false });

      // Error should be captured via Sentry
      expect(mockCaptureError).toHaveBeenCalledWith(expect.any(Error), 'Auth state listener error');
      // Other listeners should still be called
      expect(successCallback).toHaveBeenCalledWith(false);
    });

    it('should return a working unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = authManager.onAuthStateChange(callback);
      
      expect(typeof unsubscribe).toBe('function');
      
      // Should not throw when called
      expect(() => unsubscribe()).not.toThrow();
      
      // Should be safe to call multiple times
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  // ============================================================================
  // LOGOUT TESTS
  // ============================================================================
  describe('logout', () => {
    it('should clear localStorage token and user', async () => {
      await authManager.logout({ redirect: false });
      
      expect(localStorage.removeItem).toHaveBeenCalledWith('token');
      expect(localStorage.removeItem).toHaveBeenCalledWith('user');
    });

    it('should clear Zustand auth store', async () => {
      const { useAuthStore } = await import('../lib/store');
      
      await authManager.logout({ redirect: false });
      
      expect(useAuthStore.setState).toHaveBeenCalledWith({
        user: null,
        token: null,
        fbToken: null,
        isAuthenticated: false,
        workspaces: [],
        activeWorkspaceId: null,
      });
    });

    it('should call server logout endpoint', async () => {
      const { publicApi } = await import('../lib/api');
      
      await authManager.logout({ redirect: false });
      
      expect(publicApi.post).toHaveBeenCalledWith('/auth/logout');
    });

    it('should not redirect when redirect option is false', async () => {
      const originalHref = window.location.href;
      
      await authManager.logout({ redirect: false });
      
      expect(window.location.href).toBe(originalHref);
    });

    it('should redirect to login when redirect is true and not on login page', async () => {
      window.location.pathname = '/dashboard';
      
      await authManager.logout({ redirect: true });
      
      expect(window.location.href).toBe('/login');
    });

    it('should not redirect if already on login page', async () => {
      window.location.pathname = '/login';
      const originalHref = window.location.href;
      
      await authManager.logout({ redirect: true });
      
      expect(window.location.href).toBe(originalHref);
    });

    it('should not redirect if on root page', async () => {
      window.location.pathname = '/';
      window.location.href = '/';

      await authManager.logout({ redirect: true });

      expect(window.location.href).toBe('/');
    });

    it('should log reason when provided', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      await authManager.logout({ redirect: false, reason: 'User clicked logout' });
      
      expect(consoleSpy).toHaveBeenCalledWith('Logout triggered: User clicked logout');
    });

    it('should not log when reason is not provided', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      await authManager.logout({ redirect: false });
      
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should prevent multiple simultaneous logouts', async () => {
      const { useAuthStore } = await import('../lib/store');
      
      // Trigger two logouts at the same time
      const logout1 = authManager.logout({ redirect: false });
      const logout2 = authManager.logout({ redirect: false });
      
      await Promise.all([logout1, logout2]);
      
      // setState should only be called once
      expect(useAuthStore.setState).toHaveBeenCalledTimes(1);
    });

    it('should complete logout even if server logout fails', async () => {
      const { useAuthStore } = await import('../lib/store');
      const { publicApi } = await import('../lib/api');
      
      (publicApi.post as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));
      
      await authManager.logout({ redirect: false });
      
      // Local state should still be cleared
      expect(localStorage.removeItem).toHaveBeenCalledWith('token');
      expect(useAuthStore.setState).toHaveBeenCalled();
    });

    it('should reset isLoggingOut flag after logout completes (allows subsequent logouts)', async () => {
      // First logout
      await authManager.logout({ redirect: false });
      
      // Clear the mock to track the second call
      const { useAuthStore } = await import('../lib/store');
      (useAuthStore.setState as ReturnType<typeof vi.fn>).mockClear();
      
      // Second logout should work (flag was reset)
      await authManager.logout({ redirect: false });
      
      expect(useAuthStore.setState).toHaveBeenCalled();
    });

    it('should use default options when none provided', async () => {
      window.location.pathname = '/dashboard';
      
      await authManager.logout();
      
      // Default redirect is true
      expect(window.location.href).toBe('/login');
    });
  });

  // ============================================================================
  // REFRESH TOKEN TESTS
  // ============================================================================
  describe('refreshToken', () => {
    it('should return true when refresh succeeds with success: true', async () => {
      const mockAxios = createMockAxios();
      mockAxios.post.mockResolvedValue({
        data: { success: true, token: 'new-token' }
      });

      const result = await authManager.refreshToken(mockAxios.instance);

      expect(result).toBe(true);
      expect(mockAxios.post).toHaveBeenCalledWith('/auth/refresh');
    });

    it('should return false when refresh succeeds but success is false', async () => {
      const mockAxios = createMockAxios();
      mockAxios.post.mockResolvedValue({
        data: { success: false }
      });

      const result = await authManager.refreshToken(mockAxios.instance);

      expect(result).toBe(false);
    });

    it('should return false when refresh succeeds but data is missing', async () => {
      const mockAxios = createMockAxios();
      mockAxios.post.mockResolvedValue({
        data: null
      });

      const result = await authManager.refreshToken(mockAxios.instance);

      expect(result).toBe(false);
    });

    it('should return false when refresh request fails', async () => {
      const mockAxios = createMockAxios();
      mockAxios.post.mockRejectedValue(new Error('Network error'));

      const result = await authManager.refreshToken(mockAxios.instance);

      expect(result).toBe(false);
    });

    it('should return false when refresh returns 401', async () => {
      const mockAxios = createMockAxios();
      mockAxios.post.mockRejectedValue({
        response: { status: 401 },
        message: 'Unauthorized',
      });

      const result = await authManager.refreshToken(mockAxios.instance);

      expect(result).toBe(false);
    });
  });

  // ============================================================================
  // SETUP AUTH INTERCEPTOR TESTS
  // ============================================================================
  describe('setupAuthInterceptor', () => {
    it('should attach response interceptor to axios instance', () => {
      const mockAxios = createMockAxios();

      authManager.setupAuthInterceptor(mockAxios.instance);

      expect(mockAxios.use).toHaveBeenCalled();
    });

    it('should pass through successful responses unchanged', async () => {
      const mockAxios = createMockAxios();
      authManager.setupAuthInterceptor(mockAxios.instance);

      const mockResponse = { data: { test: true }, status: 200 } as AxiosResponse;
      const result = mockAxios.response.onFulfilled(mockResponse);

      expect(result).toBe(mockResponse);
    });

    it('should reject non-401 errors without attempting refresh', async () => {
      const mockAxios = createMockAxios();
      authManager.setupAuthInterceptor(mockAxios.instance);
      
      const error500 = axiosErrorWith(500, { url: '/api/test' });
      
      const refreshSpy = vi.spyOn(authManager, 'refreshToken');
      
      await expect(mockAxios.response.onRejected(error500)).rejects.toBeDefined();
      expect(refreshSpy).not.toHaveBeenCalled();
    });

    it('should reject 403 errors without attempting refresh', async () => {
      const mockAxios = createMockAxios();
      authManager.setupAuthInterceptor(mockAxios.instance);
      
      const error403 = axiosErrorWith(403, { url: '/api/test' });
      
      const refreshSpy = vi.spyOn(authManager, 'refreshToken');
      
      await expect(mockAxios.response.onRejected(error403)).rejects.toBeDefined();
      expect(refreshSpy).not.toHaveBeenCalled();
    });

    it('should reject errors without response object', async () => {
      const mockAxios = createMockAxios();
      authManager.setupAuthInterceptor(mockAxios.instance);
      
      const networkError = {
        message: 'Network Error',
        config: { url: '/api/test' },
        };
      
      await expect(mockAxios.response.onRejected(networkError)).rejects.toBeDefined();
    });

    it('should reject errors without config', async () => {
      const mockAxios = createMockAxios();
      authManager.setupAuthInterceptor(mockAxios.instance);
      
      const error401NoConfig = { response: { status: 401 } };
      
      await expect(mockAxios.response.onRejected(error401NoConfig)).rejects.toBeDefined();
    });

    it('should prevent retry loops by checking _retry flag', async () => {
      const mockAxios = createMockAxios();
      authManager.setupAuthInterceptor(mockAxios.instance);
      
      // Error with _retry already set
      const error401Retry = axiosErrorWith(401, { url: '/api/test', _retry: true });
      
      const refreshSpy = vi.spyOn(authManager, 'refreshToken');
      
      await expect(mockAxios.response.onRejected(error401Retry)).rejects.toBeDefined();
      expect(refreshSpy).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // SKIP AUTH ENDPOINTS TESTS (Infinite Loop Prevention)
  // ============================================================================
  describe('Skip Auth Endpoints (Infinite Loop Prevention)', () => {
    const authEndpoints = [
      '/auth/login',
      '/auth/refresh',
      '/auth/logout',
      '/auth/facebook',
      '/auth/facebook/native',
    ];

    authEndpoints.forEach(endpoint => {
      it(`should skip 401 handling for ${endpoint}`, async () => {
        const mockAxios = createMockAxios();
        authManager.setupAuthInterceptor(mockAxios.instance);
        
        const error401 = axiosErrorWith(401, { url: endpoint });
        
        const logoutSpy = vi.spyOn(authManager, 'logout');
        const refreshSpy = vi.spyOn(authManager, 'refreshToken');
        
        await expect(mockAxios.response.onRejected(error401)).rejects.toBeDefined();
        
        expect(refreshSpy).not.toHaveBeenCalled();
        expect(logoutSpy).not.toHaveBeenCalled();
      });
    });
  });

  // ============================================================================
  // BROWSER REOPEN WITH EXPIRED TOKEN (CRITICAL REGRESSION TESTS)
  // ============================================================================
  describe('Browser Reopen with Expired Token (Regression Test)', () => {
    it('should gracefully logout when both access and refresh tokens are expired', async () => {
      const mockAxios = createMockAxios();
      authManager.setupAuthInterceptor(mockAxios.instance);
      
      // Mock expired access token (401 on /auth/me)
      const error401 = axiosErrorWith(401, { url: '/auth/me', _retry: false });
      
      // Mock refreshToken to fail (expired refresh token)
      mockAxios.post.mockRejectedValue({
        response: { status: 401 },
        message: 'Refresh token expired',
      });
      
      const logoutSpy = vi.spyOn(authManager, 'logout');
      
      try {
        await mockAxios.response.onRejected(error401);
      } catch {
        // Expected to throw after failed refresh
      }
      
      expect(logoutSpy).toHaveBeenCalledWith({
        redirect: true,
        reason: expect.stringContaining('refresh'),
      });
    });

    it('should clear localStorage before redirecting', async () => {
      const mockAxios = createMockAxios();
      authManager.setupAuthInterceptor(mockAxios.instance);
      
      const error401 = axiosErrorWith(401, { url: '/auth/me', _retry: false });

      mockAxios.post.mockRejectedValue({
        response: { status: 401 },
      });

      try {
        await mockAxios.response.onRejected(error401);
      } catch {
        // Expected
      }

      expect(localStorage.removeItem).toHaveBeenCalledWith('token');
      expect(localStorage.removeItem).toHaveBeenCalledWith('user');
    });

    it('should not hang when refresh fails (no infinite Promise)', async () => {
      const mockAxios = createMockAxios();
      authManager.setupAuthInterceptor(mockAxios.instance);
      
      const error401 = axiosErrorWith(401, { url: '/api/test', _retry: false });

      mockAxios.post.mockRejectedValue(new Error('Refresh failed'));

      // This should complete (not hang) within a reasonable time
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Test timed out - possible hang')), 1000)
      );
      
      const testPromise = mockAxios.response.onRejected(error401).catch(() => 'completed');
      
      const result = await Promise.race([testPromise, timeoutPromise]);
      expect(result).toBe('completed');
    });
  });

  // ============================================================================
  // REQUEST QUEUING (CONCURRENT 401 HANDLING) TESTS
  // ============================================================================
  describe('Request Queuing (Concurrent 401 Handling)', () => {
    it('should queue requests while refreshing', async () => {
      const mockAxios = createMockAxios();
      authManager.setupAuthInterceptor(mockAxios.instance);
      
      let refreshCallCount = 0;
      mockAxios.post.mockImplementation((url) => {
        if (url === '/auth/refresh') {
          refreshCallCount++;
          return Promise.resolve({ data: { success: true } });
        }
        return Promise.resolve({ data: {} });
      });
      
      const error401_1 = axiosErrorWith(401, { url: '/api/endpoint1', _retry: false });

      const error401_2 = axiosErrorWith(401, { url: '/api/endpoint2', _retry: false });

      const promise1 = mockAxios.response.onRejected(error401_1).catch(() => {});
      const promise2 = mockAxios.response.onRejected(error401_2).catch(() => {});

      await Promise.all([promise1, promise2]);

      // Refresh should only be called ONCE
      expect(refreshCallCount).toBe(1);
    });

    it('should reject all queued requests when refresh fails', async () => {
      const mockAxios = createMockAxios();
      authManager.setupAuthInterceptor(mockAxios.instance);
      
      mockAxios.post.mockRejectedValue({
        response: { status: 401 },
      });
      
      const error401_1 = axiosErrorWith(401, { url: '/api/endpoint1', _retry: false });

      const error401_2 = axiosErrorWith(401, { url: '/api/endpoint2', _retry: false });

      let rejectedCount = 0;
      const promise1 = mockAxios.response.onRejected(error401_1).catch(() => { rejectedCount++; });
      const promise2 = mockAxios.response.onRejected(error401_2).catch(() => { rejectedCount++; });

      await Promise.all([promise1, promise2]);

      expect(rejectedCount).toBe(2);
    });

    it('should reset isRefreshing flag after refresh completes', async () => {
      const mockAxios = createMockAxios();
      authManager.setupAuthInterceptor(mockAxios.instance);
      
      let refreshCallCount = 0;
      mockAxios.post.mockImplementation(() => {
        refreshCallCount++;
        return Promise.resolve({ data: { success: true } });
      });
      
      // First 401
      const error401_1 = axiosErrorWith(401, { url: '/api/test1', _retry: false });

      await mockAxios.response.onRejected(error401_1).catch(() => {});

      // Second 401 (after first completed)
      const error401_2 = axiosErrorWith(401, { url: '/api/test2', _retry: false });
      
      await mockAxios.response.onRejected(error401_2).catch(() => {});
      
      // Should have refreshed twice (once per 401, sequentially)
      expect(refreshCallCount).toBe(2);
    });

    it('should reset isRefreshing flag even when refresh throws', async () => {
      const mockAxios = createMockAxios();
      authManager.setupAuthInterceptor(mockAxios.instance);
      
      let callCount = 0;
      mockAxios.post.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Refresh error');
        }
        return Promise.resolve({ data: { success: true } });
      });
      
      const error401 = axiosErrorWith(401, { url: '/api/test', _retry: false });

      // First should fail
      await mockAxios.response.onRejected({ ...error401, config: { ...error401.config, _retry: false } }).catch(() => {});

      // Second should work (isRefreshing was reset)
      await mockAxios.response.onRejected({ ...error401, config: { ...error401.config, _retry: false } }).catch(() => {});

      expect(callCount).toBe(2);
    });
  });

  // ============================================================================
  // REFRESH SUCCESS WITH RETRY TESTS
  // ============================================================================
  describe('Refresh Success with Request Retry', () => {
    it('should call refresh endpoint when 401 is received', async () => {
      const mockAxios = createMockAxios();
      authManager.setupAuthInterceptor(mockAxios.instance);
      
      mockAxios.post.mockResolvedValue({ data: { success: true } });
      
      const error401 = axiosErrorWith(401, { url: '/api/test', _retry: false });

      try {
        await mockAxios.response.onRejected(error401);
      } catch {
        // May throw depending on mock setup
      }

      // Verify refresh was called
      expect(mockAxios.post).toHaveBeenCalledWith('/auth/refresh');
    });

    it('should mark original request as _retry before retrying', async () => {
      const mockAxios = createMockAxios();
      authManager.setupAuthInterceptor(mockAxios.instance);
      
      mockAxios.post.mockResolvedValue({ data: { success: true } });
      
      const originalConfig = { url: '/api/test', _retry: false };
      const error401 = axiosErrorWith(401, originalConfig);
      
      try {
        await mockAxios.response.onRejected(error401);
      } catch {
        // Expected
      }
      
      // The config should have been marked as retry
      expect(originalConfig._retry).toBe(true);
    });

    it('should re-issue the original request through the same instance after a successful refresh', async () => {
      const mockAxios = createMockAxios();
      authManager.setupAuthInterceptor(mockAxios.instance);

      mockAxios.post.mockResolvedValue({ data: { success: true } });
      const error401 = axiosErrorWith(401, { url: '/api/messages', _retry: false });

      await mockAxios.response.onRejected(error401);

      // The retry is what the caller is waiting on — assert it actually happened,
      // and with the original request, not a copy. Nothing else in this file
      // covered it, which is why a live retry could sit here issuing real HTTP.
      expect(mockAxios.retry).toHaveBeenCalledTimes(1);
      expect(mockAxios.retry).toHaveBeenCalledWith(error401.config);
    });
  });

  // ============================================================================
  // 403 WORKSPACE_ACCESS_DENIED (STALE WORKSPACE SELF-HEAL)
  // ============================================================================
  describe('403 WORKSPACE_ACCESS_DENIED', () => {
    it('should clear the stale workspace, drop the header, and retry once', async () => {
      const { useAuthStore } = await import('../lib/store');
      const mockAxios = createMockAxios();
      authManager.setupAuthInterceptor(mockAxios.instance);

      const error403 = axiosErrorWith(
        403,
        { url: '/api/pages', headers: { 'X-Workspace-Id': 'stale-id' } as never },
        { code: 'WORKSPACE_ACCESS_DENIED' },
      );

      await mockAxios.response.onRejected(error403);

      expect(useAuthStore.setState).toHaveBeenCalledWith({ activeWorkspaceId: null });
      // The stale header must be gone so the backend can auto-resolve the workspace
      expect(error403.config.headers['X-Workspace-Id']).toBeUndefined();
      expect(mockAxios.retry).toHaveBeenCalledWith(error403.config);
      expect(error403.config._retry).toBe(true);
    });

    it('should not retry a WORKSPACE_ACCESS_DENIED that was already retried', async () => {
      const mockAxios = createMockAxios();
      authManager.setupAuthInterceptor(mockAxios.instance);

      const error403 = axiosErrorWith(
        403,
        { url: '/api/pages', _retry: true },
        { code: 'WORKSPACE_ACCESS_DENIED' },
      );

      await expect(mockAxios.response.onRejected(error403)).rejects.toBeDefined();
      expect(mockAxios.retry).not.toHaveBeenCalled();
    });
  });
});
