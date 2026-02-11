import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const nginxConf = readFileSync(
  resolve(__dirname, '../../../nginx/nginx.conf'),
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

    const csp = cspMatch![1];
    const connectSrc = csp.match(/connect-src\s+([^;]+)/);
    expect(connectSrc).not.toBeNull();
    expect(connectSrc![1]).toContain("'self'");
  });
});
