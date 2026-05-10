/**
 * AuthManager - Centralized Authentication State Manager
 * 
 * Industry Standard Patterns Applied:
 * 1. Singleton Pattern - Single source of truth for auth state
 * 2. Request Queue Pattern - Prevents race conditions during token refresh
 * 3. Observer Pattern - Notifies components of auth state changes
 * 4. Fail-Safe Logout - Ensures clean logout even when API calls fail
 * 
 * References:
 * - Auth0 SPA SDK architecture
 * - Firebase Auth patterns
 * - OAuth 2.0 best practices (RFC 6749)
 */

import type { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { captureError } from '@/lib/sentryHelpers';
import { tError } from '@/lib/i18nErrors';

// Types
interface AuthStateChangeCallback {
  (isAuthenticated: boolean): void;
}

interface QueuedRequest {
  resolve: (value?: unknown) => void;
  reject: (error: unknown) => void;
}

interface RefreshResponse {
  success: boolean;
  token?: string;
}

/**
 * AuthManager handles all authentication-related operations:
 * - Token refresh with request queuing
 * - Centralized logout
 * - Auth state change notifications
 */
class AuthManager {
  private static instance: AuthManager;
  
  // Request queue for handling concurrent 401s
  private isRefreshing = false;
  private failedQueue: QueuedRequest[] = [];
  
  // Auth state observers
  private authStateListeners: Set<AuthStateChangeCallback> = new Set();
  
  // Prevent multiple logouts
  private isLoggingOut = false;

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): AuthManager {
    if (!AuthManager.instance) {
      AuthManager.instance = new AuthManager();
    }
    return AuthManager.instance;
  }

  /**
   * Subscribe to auth state changes
   */
  onAuthStateChange(callback: AuthStateChangeCallback): () => void {
    this.authStateListeners.add(callback);
    return () => this.authStateListeners.delete(callback);
  }

  /**
   * Notify all listeners of auth state change
   */
  private notifyAuthStateChange(isAuthenticated: boolean): void {
    this.authStateListeners.forEach(callback => {
      try {
        callback(isAuthenticated);
      } catch (e) {
        captureError(e, 'Auth state listener error');
      }
    });
  }

  /**
   * Process queued requests after refresh completes
   */
  private processQueue(error: Error | null): void {
    this.failedQueue.forEach(request => {
      if (error) {
        request.reject(error);
      } else {
        request.resolve();
      }
    });
    this.failedQueue = [];
  }

  /**
   * Centralized logout - clears all auth state
   * This is the ONLY place logout should happen to ensure consistency
   */
  async logout(options: { redirect?: boolean; reason?: string } = {}): Promise<void> {
    const { redirect = true, reason } = options;
    
    // Prevent multiple simultaneous logouts
    if (this.isLoggingOut) {
      return;
    }
    this.isLoggingOut = true;

    if (reason) {
      console.warn(`Logout triggered: ${reason}`);
    }

    try {
      // 0. Remove push notification token before clearing auth (best-effort)
      if (typeof window !== 'undefined') {
        try {
          const { Capacitor } = await import('@capacitor/core');
          if (Capacitor.isNativePlatform()) {
            const token = localStorage.getItem('token');
            if (token) {
              const { removePushToken } = await import('./notifications');
              await removePushToken(token);
            }
          }
        } catch (e) {
          captureError(e, 'Failed to remove push token during logout', { tags: { context: 'auth-logout' } });
        }
      }

      // 1. Clear local storage first (synchronous, always works)
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }

      // 2. Clear Zustand store (async import to avoid circular deps)
      try {
        const { useAuthStore } = await import('./store');
        // Use setState directly to avoid calling the store's logout which hits the API
        useAuthStore.setState({
          user: null,
          token: null,
          fbToken: null,
          isAuthenticated: false,
          workspaces: [],
          activeWorkspaceId: null,
        });
      } catch (e) {
        captureError(e, 'Failed to clear auth store', { tags: { context: 'auth-logout' } });
      }

      // 3. Notify listeners
      this.notifyAuthStateChange(false);

      // 4. Try to call server logout (non-blocking, best effort)
      // This clears HttpOnly cookies and revokes refresh token
      try {
        const { publicApi } = await import('./api');
        await publicApi.post('/auth/logout');
      } catch {
        // Server logout failed - that's OK, cookies will expire
        // The important thing is client state is cleared
      }

      // 5. Redirect to login (if requested and not already there)
      if (redirect && typeof window !== 'undefined') {
        const currentPath = window.location.pathname;
        if (!currentPath.includes('/login') && currentPath !== '/' && !currentPath.match(/^\/[a-z]{2}\/?$/)) {
          window.location.href = '/login';
        }
      }
    } finally {
      this.isLoggingOut = false;
    }
  }

  /**
   * Attempt to refresh the access token
   * Returns true if refresh was successful, false otherwise
   *
   * On native (mobile), the new access token must be persisted to localStorage
   * because requests authenticate via the `Authorization: Bearer` header rather
   * than the HttpOnly cookie. Without this, every request after the 15-min
   * access-token TTL keeps sending the expired Bearer token and 401s — making
   * the session appear to drop even though refresh-token rotation succeeded.
   */
  async refreshToken(axiosInstance: AxiosInstance): Promise<boolean> {
    try {
      const response = await axiosInstance.post<RefreshResponse>('/auth/refresh');
      if (response.data?.success !== true) {
        return false;
      }

      const newToken = response.data.token;
      if (newToken && typeof window !== 'undefined') {
        try {
          const { Capacitor } = await import('@capacitor/core');
          if (Capacitor.isNativePlatform()) {
            localStorage.setItem('token', newToken);
            const { useAuthStore } = await import('./store');
            useAuthStore.setState({ token: newToken });
          }
        } catch (e) {
          captureError(e, 'Failed to persist refreshed token', { tags: { context: 'auth-refresh' } });
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Setup the auth error interceptor on an Axios instance
   *
   * Handles:
   * - 401 (expired/invalid token) → refresh token → retry
   * - 403 WORKSPACE_ACCESS_DENIED → clear stale workspace → retry (auto-resolves)
   *
   * Pattern:
   * 1. On auth error, check if already refreshing
   * 2. If refreshing, queue the request
   * 3. If not refreshing, attempt refresh
   * 4. On success, retry all queued requests
   * 5. On failure, logout and reject all
   */
  setupAuthInterceptor(axiosInstance: AxiosInstance): void {
    axiosInstance.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

        // Skip auth/refresh endpoints to prevent infinite loops
        const skipUrls = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/facebook'];
        if (!originalRequest || skipUrls.some(url => originalRequest.url?.includes(url))) {
          return Promise.reject(error);
        }

        const status = error.response?.status;
        const errorCode = (error.response?.data as { code?: string })?.code;

        // 403 WORKSPACE_ACCESS_DENIED: stale workspace ID in store — clear it and retry
        // The backend auto-resolves workspace for users with a single workspace
        if (status === 403 && errorCode === 'WORKSPACE_ACCESS_DENIED' && !originalRequest._retry) {
          originalRequest._retry = true;
          try {
            const { useAuthStore } = await import('./store');
            useAuthStore.setState({ activeWorkspaceId: null });
            // Remove stale header so backend can auto-resolve
            delete originalRequest.headers['X-Workspace-Id'];
            return axiosInstance(originalRequest);
          } catch {
            return Promise.reject(error);
          }
        }

        // 403 INSUFFICIENT_ROLE: user tried an action above their permission level
        if (status === 403 && errorCode === 'INSUFFICIENT_ROLE') {
          const { toast } = await import('sonner');
          toast.error(tError('insufficientRole'));
          return Promise.reject(error);
        }

        // Only handle 401 (expired token) from here on
        if (status !== 401) {
          return Promise.reject(error);
        }

        // Prevent retry loops
        if (originalRequest._retry) {
          return Promise.reject(error);
        }

        // If already refreshing, queue this request
        if (this.isRefreshing) {
          return new Promise((resolve, reject) => {
            this.failedQueue.push({ resolve, reject });
          }).then(() => {
            return axiosInstance(originalRequest);
          });
        }

        // Mark as retrying and start refresh
        originalRequest._retry = true;
        this.isRefreshing = true;

        try {
          const refreshSuccess = await this.refreshToken(axiosInstance);

          if (refreshSuccess) {
            // Refresh succeeded - process queue and retry original request
            this.processQueue(null);
            return axiosInstance(originalRequest);
          } else {
            // Refresh failed - logout and reject all
            const logoutError = new Error('Session expired');
            this.processQueue(logoutError);
            await this.logout({ redirect: true, reason: 'Token refresh failed' });
            return Promise.reject(logoutError);
          }
        } catch (refreshError) {
          // Refresh threw an error - logout and reject all
          const error = refreshError instanceof Error ? refreshError : new Error('Refresh failed');
          this.processQueue(error);
          await this.logout({ redirect: true, reason: 'Token refresh error' });
          return Promise.reject(error);
        } finally {
          this.isRefreshing = false;
        }
      }
    );
  }
}

// Export singleton instance
export const authManager = AuthManager.getInstance();
