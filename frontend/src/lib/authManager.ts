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
import { captureError, addErrorBreadcrumb, clearSentryUser } from '@/lib/sentryHelpers';
import { tError } from '@/lib/i18nErrors';
import { AUTH_BRIDGE_PATHS } from '@/constants/auth';
import { isEmbeddedSession, refreshEmbeddedToken, clearEmbeddedSession, getEmbeddedPlatform } from '@/lib/embeddedSession';

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
   * The embedded entry page for a platform frame — the only honest place a
   * signed-out merchant can land there: it explains how to reopen the app.
   */
  private static embeddedEntryPath(platform: string): string {
    return `/${platform}/embedded?expired=1`;
  }

  /**
   * Where a signed-out (or never-signed-in) user belongs.
   *
   * Inside a platform dashboard frame that is the embedded entry, never
   * `/login`: the merchant was auto-provisioned from their store and has no
   * credentials to pass a login wall with, and a sign-in prompt inside the
   * frame is the exact defect the embedded flow exists to remove (Zid
   * rejection 2026-08-10; the login page was observed inside the Zid dashboard
   * again on 2026-08-30, reached through the three hard-coded
   * `router.push('/login')` sites). Every one of them reads this instead (D-A).
   */
  signedOutPath(): string {
    const platform = typeof window !== 'undefined' ? getEmbeddedPlatform() : null;
    return platform ? AuthManager.embeddedEntryPath(platform) : '/login';
  }

  /**
   * Drop LOCAL session state only — the server session is left completely
   * alone. No `/auth/logout`, no cookie clearing, no push-token revocation.
   *
   * ⛔ That restraint is the whole point, and it is why this is not `logout()`
   * behind a flag. The web session lives in an HttpOnly cookie shared by every
   * tab of the browser PROFILE, so when this runs because the cookie now
   * belongs to a DIFFERENT user (lib/sessionSync), a server logout would revoke
   * the session the merchant is actively using in the tab they just signed in
   * on — fixing this tab's stale state by breaking the working one. Local state
   * is the only thing that is wrong here, so it is the only thing cleared.
   *
   * `logout()` layers the server-side half on top of this.
   */
  async clearLocalSession(reason?: string): Promise<void> {
    if (reason) {
      addErrorBreadcrumb('auth', reason);
    }

    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      clearEmbeddedSession();
    }

    // Async import: `lib/api` ↔ `lib/store` is a cycle at module load.
    try {
      const { useAuthStore } = await import('./store');
      // setState directly — the store's own `logout` calls back into the API.
      useAuthStore.setState({
        user: null,
        token: null,
        fbToken: null,
        isAuthenticated: false,
        workspaces: [],
        activeWorkspaceId: null,
      });
    } catch (e) {
      captureError(e, 'Failed to clear auth store', { tags: { context: 'auth-clear-local' } });
    }

    clearSentryUser();

    this.notifyAuthStateChange(false);
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

    // Captured before the clear below: an embedded tab must never be sent to
    // /login — inside a platform dashboard that IS the sign-in prompt the
    // embedded flow exists to remove. It goes to the embedded entry instead,
    // which explains how to reopen the app.
    const embeddedPlatform = typeof window !== 'undefined' ? getEmbeddedPlatform() : null;

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

      // 1-3. Every piece of local session state, plus the listeners.
      await this.clearLocalSession();

      // 4. Try to call server logout (non-blocking, best effort)
      // This clears HttpOnly cookies and revokes refresh token
      try {
        const { publicApi } = await import('./api');
        await publicApi.post('/auth/logout');
      } catch {
        // Server logout failed - that's OK, cookies will expire
        // The important thing is client state is cleared
      }

      // 5. Redirect (if requested and not already there)
      if (redirect && typeof window !== 'undefined') {
        const currentPath = window.location.pathname;
        if (embeddedPlatform) {
          // Embedded: back to the entry page, which shows "reopen the app from
          // your dashboard" rather than a login form we know cannot be used.
          if (!currentPath.includes(`/${embeddedPlatform}/embedded`)) {
            window.location.href = AuthManager.embeddedEntryPath(embeddedPlatform);
          }
        } else if (!currentPath.includes('/login') && currentPath !== '/' && !currentPath.match(/^\/[a-z]{2}\/?$/)) {
          window.location.href = '/login';
        }
      }
    } finally {
      this.isLoggingOut = false;
    }
  }

  /**
   * Transient auth-bridge pages exist only to hand the session to the native
   * app and navigate away within milliseconds. A background 401 there must not
   * start a token refresh: the rotation's Set-Cookie response can be lost when
   * the page tears down mid-flight, leaving the cookie jar holding a revoked
   * token — the "login wall on every visit" bug (nginx-verified 2026-07-30).
   * It must not force a logout either; the session may be perfectly valid.
   * Matched with includes() so locale prefixes (/en/auth/sync) are covered.
   */
  private isOnAuthBridgePage(): boolean {
    if (typeof window === 'undefined') return false;
    const path = window.location.pathname;
    return AUTH_BRIDGE_PATHS.some((bridgePath) => path.includes(bridgePath));
  }

  /**
   * Attempt to refresh the access token
   * Returns true if refresh was successful, false otherwise
   *
   * Embedded surfaces (platform dashboard iframe) take a different route:
   * `/auth/refresh` rotates the HttpOnly refresh COOKIE, which a third-party
   * frame never sends — it would 401 forever. There the platform credential
   * re-mints the access token instead. See lib/embeddedSession.ts.
   */
  async refreshToken(axiosInstance: AxiosInstance): Promise<boolean> {
    if (isEmbeddedSession()) {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';
      return (await refreshEmbeddedToken(apiUrl)) !== null;
    }
    try {
      const response = await axiosInstance.post<RefreshResponse>('/auth/refresh');
      if (response.data?.success !== true) return false;

      // Adopt the rotated access token. Mandatory, not an optimisation: the
      // request interceptor sends `localStorage.token` as a Bearer header on
      // native, and the backend prefers that header over the cookie this
      // refresh just set (middleware/auth.ts authenticate()). Dropping the
      // token here left the retry re-sending the EXPIRED one, so it 401'd
      // again, `_retry` rejected it, and no logout ever fired — a silent,
      // permanent 401 loop on every native API call. See store.setToken.
      if (response.data.token) {
        const { useAuthStore } = await import('./store');
        useAuthStore.getState().setToken(response.data.token);
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

        // 403 ADMIN_REQUIRED: the persisted store claims this device is an
        // admin and the server — reading the session it actually received —
        // says it is not. The store is the stale one; correct it so AdminLayout
        // redirects off the admin area instead of rendering a shell whose every
        // panel 403s ("Failed to load customers" over "0 customers").
        //
        // A net, not the fix: sessionSync catches the usual cause (the cookie
        // now belongs to another user) on mount. This also covers the flag
        // being revoked mid-session, which nothing else would notice until the
        // next page mount.
        if (status === 403 && errorCode === 'ADMIN_REQUIRED') {
          const { useAuthStore } = await import('./store');
          if (useAuthStore.getState().user?.isAdmin) {
            useAuthStore.getState().updateUser({ isAdmin: false });
          }
          return Promise.reject(error);
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

        // No refresh (and no logout) from transient auth-bridge pages —
        // see isOnAuthBridgePage. The failed call is background noise there.
        if (this.isOnAuthBridgePage()) {
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
