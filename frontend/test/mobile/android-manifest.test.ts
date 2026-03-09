import { describe, it, expect } from 'vitest';

/**
 * Guards against Android manifest misconfigurations that break OAuth login.
 *
 * History:
 * - App Links for /auth/callback intercepted the Facebook OAuth redirect,
 *   preventing the web server from exchanging the authorization code.
 *   This caused "Error validating verification code" after app idle
 *   (native FB SDK fails → web OAuth fallback → App Links intercept → failure).
 *   Fix: removed App Links for /auth/callback paths (2026-03-09).
 */

async function readManifest(): Promise<string> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const manifestPath = path.resolve(__dirname, '../../android/app/src/main/AndroidManifest.xml');
  return fs.readFileSync(manifestPath, 'utf-8');
}

describe('AndroidManifest.xml — OAuth safety', () => {
  it('must NOT have App Links for /auth/callback (breaks web OAuth fallback)', async () => {
    const manifest = await readManifest();

    // App Links use autoVerify="true" — any intent-filter with autoVerify
    // that matches /auth/callback would intercept the Facebook redirect
    // before the web server can exchange the authorization code.
    const lines = manifest.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('pathPrefix') && lines[i].includes('auth/callback')) {
        // Walk backwards to find the parent intent-filter
        for (let j = i; j >= 0; j--) {
          if (lines[j].includes('intent-filter')) {
            expect(
              lines[j].includes('autoVerify'),
              `Line ${j + 1}: Found App Link (autoVerify) for auth/callback. ` +
              `This intercepts the OAuth redirect and breaks login after app idle. ` +
              `The web server callback must handle the code exchange, not the app.`
            ).toBe(false);
            break;
          }
        }
      }
    }
  });

  it('must keep com.jawab24.app:// custom URL scheme for deep linking', async () => {
    const manifest = await readManifest();
    expect(
      manifest.includes('android:scheme="com.jawab24.app"'),
      'Missing com.jawab24.app:// scheme — the web callback uses this to redirect back to the app after auth'
    ).toBe(true);
  });

  it('must keep Facebook SDK activities', async () => {
    const manifest = await readManifest();
    expect(
      manifest.includes('com.facebook.FacebookActivity'),
      'Missing FacebookActivity — required for native Facebook SDK login'
    ).toBe(true);
    expect(
      manifest.includes('com.facebook.CustomTabActivity'),
      'Missing CustomTabActivity — required for Chrome Custom Tab OAuth fallback'
    ).toBe(true);
  });

  it('must have INTERNET permission', async () => {
    const manifest = await readManifest();
    expect(manifest.includes('android.permission.INTERNET')).toBe(true);
  });
});
