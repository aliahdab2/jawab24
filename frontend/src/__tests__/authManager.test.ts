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
import axios, { AxiosError } from 'axios';

// Mock the store module before importing authManager
vi.mock('../lib/store', () => ({
  useAuthStore: {
    setState: vi.fn(),
    getState: vi.fn(() => ({
      user: null,
      token: null,
      fbToken: null,
      isAuthenticated: false,
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

    it('should not redirect if on landing page', async () => {
      window.location.pathname = '/landing';
      window.location.href = '/landing';
      
      await authManager.logout({ redirect: true });
      
      expect(window.location.href).toBe('/landing');
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
      const mockAxiosInstance = axios.create();
      mockAxiosInstance.post = vi.fn().mockResolvedValue({ 
        data: { success: true, token: 'new-token' } 
      });
      
      const result = await authManager.refreshToken(mockAxiosInstance);
      
      expect(result).toBe(true);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/refresh');
    });

    it('should return false when refresh succeeds but success is false', async () => {
      const mockAxiosInstance = axios.create();
      mockAxiosInstance.post = vi.fn().mockResolvedValue({ 
        data: { success: false } 
      });
      
      const result = await authManager.refreshToken(mockAxiosInstance);
      
      expect(result).toBe(false);
    });

    it('should return false when refresh succeeds but data is missing', async () => {
      const mockAxiosInstance = axios.create();
      mockAxiosInstance.post = vi.fn().mockResolvedValue({ 
        data: null 
      });
      
      const result = await authManager.refreshToken(mockAxiosInstance);
      
      expect(result).toBe(false);
    });

    it('should return false when refresh request fails', async () => {
      const mockAxiosInstance = axios.create();
      mockAxiosInstance.post = vi.fn().mockRejectedValue(new Error('Network error'));
      
      const result = await authManager.refreshToken(mockAxiosInstance);
      
      expect(result).toBe(false);
    });

    it('should return false when refresh returns 401', async () => {
      const mockAxiosInstance = axios.create();
      mockAxiosInstance.post = vi.fn().mockRejectedValue({
        response: { status: 401 },
        message: 'Unauthorized',
      });
      
      const result = await authManager.refreshToken(mockAxiosInstance);
      
      expect(result).toBe(false);
    });
  });

  // ============================================================================
  // SETUP AUTH INTERCEPTOR TESTS
  // ============================================================================
  describe('setupAuthInterceptor', () => {
    it('should attach response interceptor to axios instance', () => {
      const mockAxiosInstance = axios.create();
      const interceptorSpy = vi.spyOn(mockAxiosInstance.interceptors.response, 'use');
      
      authManager.setupAuthInterceptor(mockAxiosInstance);
      
      expect(interceptorSpy).toHaveBeenCalled();
    });

    it('should pass through successful responses unchanged', async () => {
      const mockAxiosInstance = axios.create();
      let responseInterceptor: any;
      
      vi.spyOn(mockAxiosInstance.interceptors.response, 'use').mockImplementation(
        (onFulfilled) => {
          responseInterceptor = { onFulfilled };
          return 0;
        }
      );
      
      authManager.setupAuthInterceptor(mockAxiosInstance);
      
      const mockResponse = { data: { test: true }, status: 200 };
      const result = responseInterceptor.onFulfilled(mockResponse);
      
      expect(result).toBe(mockResponse);
    });

    it('should reject non-401 errors without attempting refresh', async () => {
      const mockAxiosInstance = axios.create();
      let responseInterceptor: any;
      
      vi.spyOn(mockAxiosInstance.interceptors.response, 'use').mockImplementation(
        (onFulfilled, onRejected) => {
          responseInterceptor = { onFulfilled, onRejected };
          return 0;
        }
      );
      
      authManager.setupAuthInterceptor(mockAxiosInstance);
      
      const error500 = {
        response: { status: 500 },
        config: { url: '/api/test' },
      } as unknown as AxiosError;
      
      const refreshSpy = vi.spyOn(authManager, 'refreshToken');
      
      await expect(responseInterceptor.onRejected(error500)).rejects.toBeDefined();
      expect(refreshSpy).not.toHaveBeenCalled();
    });

    it('should reject 403 errors without attempting refresh', async () => {
      const mockAxiosInstance = axios.create();
      let responseInterceptor: any;
      
      vi.spyOn(mockAxiosInstance.interceptors.response, 'use').mockImplementation(
        (onFulfilled, onRejected) => {
          responseInterceptor = { onFulfilled, onRejected };
          return 0;
        }
      );
      
      authManager.setupAuthInterceptor(mockAxiosInstance);
      
      const error403 = {
        response: { status: 403 },
        config: { url: '/api/test' },
      } as unknown as AxiosError;
      
      const refreshSpy = vi.spyOn(authManager, 'refreshToken');
      
      await expect(responseInterceptor.onRejected(error403)).rejects.toBeDefined();
      expect(refreshSpy).not.toHaveBeenCalled();
    });

    it('should reject errors without response object', async () => {
      const mockAxiosInstance = axios.create();
      let responseInterceptor: any;
      
      vi.spyOn(mockAxiosInstance.interceptors.response, 'use').mockImplementation(
        (onFulfilled, onRejected) => {
          responseInterceptor = { onFulfilled, onRejected };
          return 0;
        }
      );
      
      authManager.setupAuthInterceptor(mockAxiosInstance);
      
      const networkError = {
        message: 'Network Error',
        config: { url: '/api/test' },
      } as unknown as AxiosError;
      
      await expect(responseInterceptor.onRejected(networkError)).rejects.toBeDefined();
    });

    it('should reject errors without config', async () => {
      const mockAxiosInstance = axios.create();
      let responseInterceptor: any;
      
      vi.spyOn(mockAxiosInstance.interceptors.response, 'use').mockImplementation(
        (onFulfilled, onRejected) => {
          responseInterceptor = { onFulfilled, onRejected };
          return 0;
        }
      );
      
      authManager.setupAuthInterceptor(mockAxiosInstance);
      
      const error401NoConfig = {
        response: { status: 401 },
      } as unknown as AxiosError;
      
      await expect(responseInterceptor.onRejected(error401NoConfig)).rejects.toBeDefined();
    });

    it('should prevent retry loops by checking _retry flag', async () => {
      const mockAxiosInstance = axios.create();
      let responseInterceptor: any;
      
      vi.spyOn(mockAxiosInstance.interceptors.response, 'use').mockImplementation(
        (onFulfilled, onRejected) => {
          responseInterceptor = { onFulfilled, onRejected };
          return 0;
        }
      );
      
      authManager.setupAuthInterceptor(mockAxiosInstance);
      
      // Error with _retry already set
      const error401Retry = {
        response: { status: 401 },
        config: { url: '/api/test', _retry: true },
      } as unknown as AxiosError;
      
      const refreshSpy = vi.spyOn(authManager, 'refreshToken');
      
      await expect(responseInterceptor.onRejected(error401Retry)).rejects.toBeDefined();
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
        const mockAxiosInstance = axios.create();
        let responseInterceptor: any;
        
        vi.spyOn(mockAxiosInstance.interceptors.response, 'use').mockImplementation(
          (onFulfilled, onRejected) => {
            responseInterceptor = { onFulfilled, onRejected };
            return 0;
          }
        );
        
        authManager.setupAuthInterceptor(mockAxiosInstance);
        
        const error401 = {
          response: { status: 401 },
          config: { url: endpoint },
        } as unknown as AxiosError;
        
        const logoutSpy = vi.spyOn(authManager, 'logout');
        const refreshSpy = vi.spyOn(authManager, 'refreshToken');
        
        await expect(responseInterceptor.onRejected(error401)).rejects.toBeDefined();
        
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
      const mockAxiosInstance = axios.create();
      let responseInterceptor: any;
      
      vi.spyOn(mockAxiosInstance.interceptors.response, 'use').mockImplementation(
        (onFulfilled, onRejected) => {
          responseInterceptor = { onFulfilled, onRejected };
          return 0;
        }
      );
      
      authManager.setupAuthInterceptor(mockAxiosInstance);
      
      // Mock expired access token (401 on /auth/me)
      const error401 = {
        response: { status: 401 },
        config: { url: '/auth/me', _retry: false },
      } as unknown as AxiosError;
      
      // Mock refreshToken to fail (expired refresh token)
      mockAxiosInstance.post = vi.fn().mockRejectedValue({
        response: { status: 401 },
        message: 'Refresh token expired',
      });
      
      const logoutSpy = vi.spyOn(authManager, 'logout');
      
      try {
        await responseInterceptor.onRejected(error401);
      } catch {
        // Expected to throw after failed refresh
      }
      
      expect(logoutSpy).toHaveBeenCalledWith({
        redirect: true,
        reason: expect.stringContaining('refresh'),
      });
    });

    it('should clear localStorage before redirecting', async () => {
      const mockAxiosInstance = axios.create();
      let responseInterceptor: any;
      
      vi.spyOn(mockAxiosInstance.interceptors.response, 'use').mockImplementation(
        (onFulfilled, onRejected) => {
          responseInterceptor = { onFulfilled, onRejected };
          return 0;
        }
      );
      
      authManager.setupAuthInterceptor(mockAxiosInstance);
      
      const error401 = {
        response: { status: 401 },
        config: { url: '/auth/me', _retry: false },
      } as unknown as AxiosError;

      mockAxiosInstance.post = vi.fn().mockRejectedValue({
        response: { status: 401 },
      });

      try {
        await responseInterceptor.onRejected(error401);
      } catch {
        // Expected
      }

      expect(localStorage.removeItem).toHaveBeenCalledWith('token');
      expect(localStorage.removeItem).toHaveBeenCalledWith('user');
    });

    it('should not hang when refresh fails (no infinite Promise)', async () => {
      const mockAxiosInstance = axios.create();
      let responseInterceptor: any;
      
      vi.spyOn(mockAxiosInstance.interceptors.response, 'use').mockImplementation(
        (onFulfilled, onRejected) => {
          responseInterceptor = { onFulfilled, onRejected };
          return 0;
        }
      );
      
      authManager.setupAuthInterceptor(mockAxiosInstance);
      
      const error401 = {
        response: { status: 401 },
        config: { url: '/api/test', _retry: false },
      } as unknown as AxiosError;

      mockAxiosInstance.post = vi.fn().mockRejectedValue(new Error('Refresh failed'));

      // This should complete (not hang) within a reasonable time
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Test timed out - possible hang')), 1000)
      );
      
      const testPromise = responseInterceptor.onRejected(error401).catch(() => 'completed');
      
      const result = await Promise.race([testPromise, timeoutPromise]);
      expect(result).toBe('completed');
    });
  });

  // ============================================================================
  // REQUEST QUEUING (CONCURRENT 401 HANDLING) TESTS
  // ============================================================================
  describe('Request Queuing (Concurrent 401 Handling)', () => {
    it('should queue requests while refreshing', async () => {
      const mockAxiosInstance = axios.create();
      let responseInterceptor: any;
      
      vi.spyOn(mockAxiosInstance.interceptors.response, 'use').mockImplementation(
        (onFulfilled, onRejected) => {
          responseInterceptor = { onFulfilled, onRejected };
          return 0;
        }
      );
      
      authManager.setupAuthInterceptor(mockAxiosInstance);
      
      let refreshCallCount = 0;
      mockAxiosInstance.post = vi.fn().mockImplementation((url) => {
        if (url === '/auth/refresh') {
          refreshCallCount++;
          return Promise.resolve({ data: { success: true } });
        }
        return Promise.resolve({ data: {} });
      });
      
      const error401_1 = {
        response: { status: 401 },
        config: { url: '/api/endpoint1', _retry: false },
      } as unknown as AxiosError;

      const error401_2 = {
        response: { status: 401 },
        config: { url: '/api/endpoint2', _retry: false },
      } as unknown as AxiosError;

      const promise1 = responseInterceptor.onRejected(error401_1).catch(() => {});
      const promise2 = responseInterceptor.onRejected(error401_2).catch(() => {});

      await Promise.all([promise1, promise2]);

      // Refresh should only be called ONCE
      expect(refreshCallCount).toBe(1);
    });

    it('should reject all queued requests when refresh fails', async () => {
      const mockAxiosInstance = axios.create();
      let responseInterceptor: any;
      
      vi.spyOn(mockAxiosInstance.interceptors.response, 'use').mockImplementation(
        (onFulfilled, onRejected) => {
          responseInterceptor = { onFulfilled, onRejected };
          return 0;
        }
      );
      
      authManager.setupAuthInterceptor(mockAxiosInstance);
      
      mockAxiosInstance.post = vi.fn().mockRejectedValue({
        response: { status: 401 },
      });
      
      const error401_1 = {
        response: { status: 401 },
        config: { url: '/api/endpoint1', _retry: false },
      } as unknown as AxiosError;

      const error401_2 = {
        response: { status: 401 },
        config: { url: '/api/endpoint2', _retry: false },
      } as unknown as AxiosError;

      let rejectedCount = 0;
      const promise1 = responseInterceptor.onRejected(error401_1).catch(() => { rejectedCount++; });
      const promise2 = responseInterceptor.onRejected(error401_2).catch(() => { rejectedCount++; });

      await Promise.all([promise1, promise2]);

      expect(rejectedCount).toBe(2);
    });

    it('should reset isRefreshing flag after refresh completes', async () => {
      const mockAxiosInstance = axios.create();
      let responseInterceptor: any;
      
      vi.spyOn(mockAxiosInstance.interceptors.response, 'use').mockImplementation(
        (onFulfilled, onRejected) => {
          responseInterceptor = { onFulfilled, onRejected };
          return 0;
        }
      );
      
      authManager.setupAuthInterceptor(mockAxiosInstance);
      
      let refreshCallCount = 0;
      mockAxiosInstance.post = vi.fn().mockImplementation(() => {
        refreshCallCount++;
        return Promise.resolve({ data: { success: true } });
      });
      
      // First 401
      const error401_1 = {
        response: { status: 401 },
        config: { url: '/api/test1', _retry: false },
      } as unknown as AxiosError;

      await responseInterceptor.onRejected(error401_1).catch(() => {});

      // Second 401 (after first completed)
      const error401_2 = {
        response: { status: 401 },
        config: { url: '/api/test2', _retry: false },
      } as unknown as AxiosError;
      
      await responseInterceptor.onRejected(error401_2).catch(() => {});
      
      // Should have refreshed twice (once per 401, sequentially)
      expect(refreshCallCount).toBe(2);
    });

    it('should reset isRefreshing flag even when refresh throws', async () => {
      const mockAxiosInstance = axios.create();
      let responseInterceptor: any;
      
      vi.spyOn(mockAxiosInstance.interceptors.response, 'use').mockImplementation(
        (onFulfilled, onRejected) => {
          responseInterceptor = { onFulfilled, onRejected };
          return 0;
        }
      );
      
      authManager.setupAuthInterceptor(mockAxiosInstance);
      
      let callCount = 0;
      mockAxiosInstance.post = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Refresh error');
        }
        return Promise.resolve({ data: { success: true } });
      });
      
      const error401 = {
        response: { status: 401 },
        config: { url: '/api/test', _retry: false },
      } as unknown as AxiosError;

      // First should fail
      await responseInterceptor.onRejected({ ...error401, config: { ...error401.config, _retry: false } }).catch(() => {});

      // Second should work (isRefreshing was reset)
      await responseInterceptor.onRejected({ ...error401, config: { ...error401.config, _retry: false } }).catch(() => {});

      expect(callCount).toBe(2);
    });
  });

  // ============================================================================
  // REFRESH SUCCESS WITH RETRY TESTS
  // ============================================================================
  describe('Refresh Success with Request Retry', () => {
    it('should call refresh endpoint when 401 is received', async () => {
      const mockAxiosInstance = axios.create();
      let responseInterceptor: any;
      
      vi.spyOn(mockAxiosInstance.interceptors.response, 'use').mockImplementation(
        (onFulfilled, onRejected) => {
          responseInterceptor = { onFulfilled, onRejected };
          return 0;
        }
      );
      
      authManager.setupAuthInterceptor(mockAxiosInstance);
      
      const postMock = vi.fn().mockResolvedValue({ data: { success: true } });
      mockAxiosInstance.post = postMock;
      
      const error401 = {
        response: { status: 401 },
        config: { url: '/api/test', _retry: false },
      } as unknown as AxiosError;

      try {
        await responseInterceptor.onRejected(error401);
      } catch {
        // May throw depending on mock setup
      }

      // Verify refresh was called
      expect(postMock).toHaveBeenCalledWith('/auth/refresh');
    });

    it('should mark original request as _retry before retrying', async () => {
      const mockAxiosInstance = axios.create();
      let responseInterceptor: any;
      
      vi.spyOn(mockAxiosInstance.interceptors.response, 'use').mockImplementation(
        (onFulfilled, onRejected) => {
          responseInterceptor = { onFulfilled, onRejected };
          return 0;
        }
      );
      
      authManager.setupAuthInterceptor(mockAxiosInstance);
      
      mockAxiosInstance.post = vi.fn().mockResolvedValue({ data: { success: true } });
      
      const originalConfig = { url: '/api/test', _retry: false };
      const error401 = {
        response: { status: 401 },
        config: originalConfig,
      } as unknown as AxiosError;
      
      try {
        await responseInterceptor.onRejected(error401);
      } catch {
        // Expected
      }
      
      // The config should have been marked as retry
      expect(originalConfig._retry).toBe(true);
    });
  });
});
