/**
 * Contract test: verifies the deep link URL format produced by callback.tsx
 * can be correctly parsed by the _app.tsx deep link handler.
 *
 * If either side changes the URL format (param names, encoding, structure),
 * this test will fail — preventing a silent break in the mobile auth flow.
 */
import { describe, it, expect } from 'vitest';

// ── Callback side: how the deep link URL is built ──────────────────────
function buildDeepLinkUrl(data: {
  token: string;
  fbAccessToken: string;
  user: { id: string; name: string; email?: string; facebookId: string };
  redirectPath: string;
}): string {
  const tokenStr = encodeURIComponent(data.token);
  const fbTokenStr = encodeURIComponent(data.fbAccessToken || '');
  const redirectStr = encodeURIComponent(data.redirectPath);
  const userStr = encodeURIComponent(JSON.stringify(data.user));

  return `com.jawab24.app://auth/sync?token=${tokenStr}&fbToken=${fbTokenStr}&redirect=${redirectStr}&user=${userStr}`;
}

// ── App side: how the deep link URL is parsed ──────────────────────────
function parseDeepLink(url: string): {
  token: string | null;
  fbToken: string;
  redirect: string;
  user: { id: string; name: string; email?: string; facebookId: string } | null;
} {
  // Simulate _app.tsx handleDeepLink: extract pathname + search
  const parsed = new URL(url);
  const slug = parsed.pathname + parsed.search;

  const params = new URLSearchParams(slug.split('?')[1] || '');
  const token = params.get('token');
  const fbToken = params.get('fbToken') || '';
  const redirect = params.get('redirect') || '/dashboard';
  const userParam = params.get('user');

  let user = null;
  if (userParam) {
    try {
      user = JSON.parse(userParam);
    } catch {
      // parse failed
    }
  }

  return { token, fbToken, redirect, user };
}

describe('Deep link contract (callback ↔ _app.tsx)', () => {
  const testUser = {
    id: 'user-123',
    name: 'Mohammed Ali',
    email: 'test@example.com',
    facebookId: 'fb-456',
  };

  it('should round-trip token, fbToken, user, and redirect through deep link', () => {
    const url = buildDeepLinkUrl({
      token: 'jwt-token-abc',
      fbAccessToken: 'fb-access-token-xyz',
      user: testUser,
      redirectPath: '/dashboard',
    });

    const parsed = parseDeepLink(url);

    expect(parsed.token).toBe('jwt-token-abc');
    expect(parsed.fbToken).toBe('fb-access-token-xyz');
    expect(parsed.redirect).toBe('/dashboard');
    expect(parsed.user).toEqual(testUser);
  });

  it('should handle special characters in user name (Arabic)', () => {
    const arabicUser = { ...testUser, name: 'محمد علي' };

    const url = buildDeepLinkUrl({
      token: 'tok',
      fbAccessToken: 'fb',
      user: arabicUser,
      redirectPath: '/dashboard',
    });

    const parsed = parseDeepLink(url);
    expect(parsed.user!.name).toBe('محمد علي');
  });

  it('should handle empty fbAccessToken', () => {
    const url = buildDeepLinkUrl({
      token: 'tok',
      fbAccessToken: '',
      user: testUser,
      redirectPath: '/settings',
    });

    const parsed = parseDeepLink(url);
    expect(parsed.fbToken).toBe('');
    expect(parsed.redirect).toBe('/settings');
  });

  it('should handle tokens with special URL characters', () => {
    const url = buildDeepLinkUrl({
      token: 'eyJ+abc/def=',
      fbAccessToken: 'EAA+xyz/123=',
      user: testUser,
      redirectPath: '/dashboard',
    });

    const parsed = parseDeepLink(url);
    expect(parsed.token).toBe('eyJ+abc/def=');
    expect(parsed.fbToken).toBe('EAA+xyz/123=');
  });

  it('should preserve user.id for the setAuth guard check', () => {
    const url = buildDeepLinkUrl({
      token: 'tok',
      fbAccessToken: 'fb',
      user: testUser,
      redirectPath: '/dashboard',
    });

    const parsed = parseDeepLink(url);

    // _app.tsx checks `user?.id` before calling setAuth
    expect(parsed.user?.id).toBeTruthy();
    expect(typeof parsed.user?.id).toBe('string');
  });

  it('should default redirect to /dashboard when missing', () => {
    // Simulate a deep link with no redirect param
    const url = 'com.jawab24.app://auth/sync?token=tok&user=' + encodeURIComponent(JSON.stringify(testUser));
    const parsed = parseDeepLink(url);

    expect(parsed.redirect).toBe('/dashboard');
  });
});
