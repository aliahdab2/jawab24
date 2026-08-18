import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const nginxConf = readFileSync(
  resolve(__dirname, '../../../nginx/nginx.conf'),
  'utf-8',
);

const deployOnServer = readFileSync(
  resolve(__dirname, '../../../scripts/deploy-on-server.sh'),
  'utf-8',
);

const deployScript = readFileSync(
  resolve(__dirname, '../../../scripts/deploy.sh'),
  'utf-8',
);

/**
 * Guard against the CSP + www mismatch bug.
 *
 * The frontend's NEXT_PUBLIC_API_URL points to https://jawab24.com/api (non-www).
 * If nginx serves the site from www.jawab24.com, CSP "connect-src 'self'" blocks
 * all API calls because 'self' = www.jawab24.com ≠ jawab24.com.
 *
 * These tests ensure nginx always redirects www → non-www.
 */
describe('nginx.conf - www redirect (CSP guard)', () => {
  it('should have a dedicated www redirect block that 301s to non-www', () => {
    // There must be a server block for www.jawab24.com that returns 301
    // Pattern: server_name www.jawab24.com; ... return 301 https://jawab24.com
    const lines = nginxConf.split('\n');

    let inWwwBlock = false;
    let wwwBlockHasRedirect = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.includes('server_name') && trimmed.includes('www.jawab24.com')) {
        // Check this is a www-ONLY block (not "jawab24.com www.jawab24.com")
        const names = trimmed.replace('server_name', '').replace(';', '').trim().split(/\s+/);
        if (names.length === 1 && names[0] === 'www.jawab24.com') {
          inWwwBlock = true;
        }
      }
      if (inWwwBlock && trimmed.startsWith('return 301') && trimmed.includes('https://jawab24.com')) {
        wwwBlockHasRedirect = true;
        break;
      }
    }

    expect(wwwBlockHasRedirect).toBe(true);
  });

  it('should NOT serve the main HTTPS site from www.jawab24.com', () => {
    // The main HTTPS block (with proxy_pass to frontend/backend) must not
    // have www.jawab24.com in its server_name.
    // The HTTP block (port 80) can list both since it only redirects.
    const lines = nginxConf.split('\n');

    let inHttpsBlock = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('listen 443')) {
        inHttpsBlock = true;
      }
      if (inHttpsBlock && trimmed.startsWith('server_name')) {
        const names = trimmed.replace('server_name', '').replace(';', '').trim().split(/\s+/);
        if (names.includes('jawab24.com') && names.includes('www.jawab24.com')) {
          expect.fail(
            'Main HTTPS server_name must not include www.jawab24.com alongside jawab24.com. ' +
            'This breaks CSP because self=www but API is at jawab24.com.',
          );
        }
        inHttpsBlock = false;
      }
    }
  });

  it('should redirect HTTP to non-www HTTPS (not $host)', () => {
    // HTTP catch-all must redirect to the canonical non-www origin
    expect(nginxConf).toContain('return 301 https://jawab24.com$request_uri');
    // Must not preserve $host (which would keep www)
    expect(nginxConf).not.toContain('return 301 https://$host$request_uri');
  });

  it('should include self in CSP connect-src', () => {
    const cspMatch = nginxConf.match(/Content-Security-Policy\s+"([^"]+)"/);
    expect(cspMatch).not.toBeNull();

    const csp = (cspMatch as RegExpMatchArray)[1];
    const connectSrc = csp.match(/connect-src\s+([^;]+)/);
    expect(connectSrc).not.toBeNull();
    expect((connectSrc as RegExpMatchArray)[1]).toContain("'self'");
  });

  /**
   * GA4 beacons go to regional collection endpoints (region1.google-analytics.com,
   * etc.), NOT to www.google-analytics.com. Without a wildcard, the browser
   * blocks the `/g/collect` request and we lose analytics data silently.
   * Test guards against a future "tighten the wildcard" pass.
   */
  it('CSP connect-src allows GA4 regional collection endpoints', () => {
    const cspMatch = nginxConf.match(/Content-Security-Policy\s+"([^"]+)"/);
    const csp = (cspMatch as RegExpMatchArray)[1];
    const connectSrc = (csp.match(/connect-src\s+([^;]+)/) as RegExpMatchArray)[1];

    expect(connectSrc).toContain('https://*.google-analytics.com');
    expect(connectSrc).toContain('https://*.analytics.google.com');
    expect(connectSrc).toContain('https://*.googletagmanager.com');
  });

  /**
   * Media thumbnails must be allow-listed per CDN. Facebook posts come from fbcdn.net,
   * but Instagram posts are served from cdninstagram.com — omitting it silently breaks
   * the IG post picker (thumbnails render broken while the FB tab works). Merchant-uploaded
   * Post Reply images come from the object-storage host. Guards against a "tighten img-src"
   * regression that would blank these.
   */
  it('CSP img-src allows the Meta (FB + IG) CDNs and the object-storage host', () => {
    const cspMatch = nginxConf.match(/Content-Security-Policy\s+"([^"]+)"/);
    const csp = (cspMatch as RegExpMatchArray)[1];
    const imgSrc = (csp.match(/img-src\s+([^;]+)/) as RegExpMatchArray)[1];

    expect(imgSrc).toContain('https://*.fbcdn.net');
    expect(imgSrc).toContain('https://*.cdninstagram.com');
    expect(imgSrc).toContain('https://*.backblazeb2.com');
  });

  /**
   * Displaying merchant media and DOWNLOADING it are two different CSP
   * directives against the same URL. `downloadImage()`
   * (frontend/src/utils/imageDownload.ts) fetches the object to hand a Blob to
   * the share sheet, because a cross-origin <a download> navigates instead of
   * downloading — and a fetch is governed by connect-src, not img-src.
   *
   * The host was listed only in img-src, so every post-suggestion image preview
   * rendered while every download threw "TypeError: Failed to fetch" (Sentry
   * JAWAB24-FRONTEND-31). Nothing else catches this: the CSP header is added by
   * nginx, which unit and E2E tests never go through.
   */
  it('CSP connect-src allows fetching from the object-storage host', () => {
    const cspMatch = nginxConf.match(/Content-Security-Policy\s+"([^"]+)"/);
    const csp = (cspMatch as RegExpMatchArray)[1];
    const connectSrc = (csp.match(/connect-src\s+([^;]+)/) as RegExpMatchArray)[1];

    expect(connectSrc).toContain('https://*.backblazeb2.com');
  });

  /**
   * Google Ads audience/conversion signals. gtag.js posts to /ccm/collect on
   * www.google.com and /ccm/s/collect on ad.doubleclick.net; both were missing
   * from connect-src, so every ping was refused and no remarketing audience was
   * ever built from site traffic. Measured 2026-08-18 with
   * `npx lighthouse https://jawab24.com/ --output=json` — the violations appear
   * in the `errors-in-console` and `inspector-issues` audits, which is the only
   * way to see them: nginx adds this header, so unit and E2E tests never go
   * through it.
   *
   * www.google.com is needed in BOTH directives, for one URL: gtag sends a
   * fetch (connect-src) and falls back to an <img> beacon (img-src). Listing it
   * in only one is the same defect the backblazeb2 case shipped.
   */
  it('CSP allows the Google Ads signal endpoints in both directives', () => {
    const cspMatch = nginxConf.match(/Content-Security-Policy\s+"([^"]+)"/);
    const csp = (cspMatch as RegExpMatchArray)[1];
    const connectSrc = (csp.match(/connect-src\s+([^;]+)/) as RegExpMatchArray)[1];
    const imgSrc = (csp.match(/img-src\s+([^;]+)/) as RegExpMatchArray)[1];

    // fetch POST to https://ad.doubleclick.net/ccm/s/collect
    expect(connectSrc).toContain('https://ad.doubleclick.net');
    // fetch POST to https://www.google.com/ccm/collect
    expect(connectSrc).toContain('https://www.google.com');
    // the <img> beacon fallback for the same endpoint
    expect(imgSrc).toContain('https://www.google.com');
    // The tag also beacons an image to the host that serves gtag.js. Allowed in
    // script-src since 2026-02-09 but never in img-src; Lighthouse never showed
    // it, the Ads tag-diagnostics panel named it directly.
    expect(imgSrc).toContain('https://www.googletagmanager.com');
  });

  /**
   * The CSP is one long header string, so a careless edit can widen a directive
   * far past what was intended — `https://www.google.com` mistyped as
   * `https://*.google.com` would admit every Google subdomain, and a bare
   * `*` or `https:` would admit the internet. Nothing else in the suite would
   * notice: every other CSP test asserts that something IS present.
   */
  it('CSP grants no blanket wildcard in any fetch-directive', () => {
    const cspMatch = nginxConf.match(/Content-Security-Policy\s+"([^"]+)"/);
    const csp = (cspMatch as RegExpMatchArray)[1];

    for (const directive of ['script-src', 'connect-src', 'img-src', 'frame-src', 'default-src']) {
      const value = (csp.match(new RegExp(`${directive}\\s+([^;]+)`)) as RegExpMatchArray)[1];
      const sources = value.trim().split(/\s+/);
      expect(sources, `${directive} must not allow all origins`).not.toContain('*');
      expect(sources, `${directive} must not allow all https origins`).not.toContain('https:');
      expect(sources, `${directive} must not allow every Google subdomain`).not.toContain('https://*.google.com');
    }
  });

  /**
   * WhatsApp Embedded Signup (`frontend/src/lib/whatsappSignup.ts`) injects the
   * Facebook JS SDK at runtime. The SDK was missing from script-src, so the
   * <script> was blocked, script.onerror fired, and every merchant clicking
   * "connect WhatsApp" got "Failed to load Facebook SDK" (Sentry
   * JAWAB24-FRONTEND-2Q). CSP failures are invisible to unit and E2E tests —
   * only a real browser against real nginx enforces the header — so this test
   * is the only automated guard. Sources verified against the live loader:
   * it fetches a second script from connect.facebook.net and builds the
   * xd_arbiter frame on staticxx.facebook.com.
   */
  it('CSP allows the Facebook JS SDK used by WhatsApp Embedded Signup', () => {
    const cspMatch = nginxConf.match(/Content-Security-Policy\s+"([^"]+)"/);
    const csp = (cspMatch as RegExpMatchArray)[1];
    const scriptSrc = (csp.match(/script-src\s+([^;]+)/) as RegExpMatchArray)[1];
    const frameSrc = (csp.match(/frame-src\s+([^;]+)/) as RegExpMatchArray)[1];
    const connectSrc = (csp.match(/connect-src\s+([^;]+)/) as RegExpMatchArray)[1];

    // sdk.js itself, plus the /en_US/bundle/… chunk the loader injects
    expect(scriptSrc).toContain('https://connect.facebook.net');
    // xd_arbiter cross-domain frame created during FB.init, and the login dialog
    expect(frameSrc).toContain('https://staticxx.facebook.com');
    expect(frameSrc).toContain('https://www.facebook.com');
    // Graph XHR from the SDK
    expect(connectSrc).toContain('https://graph.facebook.com');
  });
});

describe('deploy scripts - nginx upstream keepalive', () => {
  it('deploy.sh should include keepalive in all upstream blocks', () => {
    expect(deployScript).toContain('keepalive 32;');
    expect(deployScript).toContain('keepalive 16;');
  });

  it('deploy-on-server.sh should include keepalive in upstream blocks', () => {
    expect(deployOnServer).toContain('keepalive 32;');
    expect(deployOnServer).toContain('keepalive 16;');
  });

  it('keepalive must be on its own line (not same line as server directive)', () => {
    // Nginx requires keepalive on a separate line from server
    const lines = deployOnServer.split('\n');
    for (const line of lines) {
      if (line.includes('server ') && line.includes('keepalive')) {
        expect.fail(
          `keepalive must be on a separate line from server directive: "${line.trim()}"`,
        );
      }
    }
  });
});
