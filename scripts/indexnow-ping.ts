/**
 * Ping IndexNow so Bing, Microsoft Copilot, ChatGPT Search, and Yandex
 * (re)crawl Jawab24's public pages quickly after a deploy. Submits every
 * <loc> URL from the live sitemap.
 *
 * Non-fatal by design: any failure logs and exits 0 so it never blocks a deploy.
 *
 * Requires INDEXNOW_KEY — the same key served at https://jawab24.com/<key>.txt
 * (via the rewrite in frontend/next.config.js → /api/indexnow-key).
 *
 * Usage: INDEXNOW_KEY=... npx tsx scripts/indexnow-ping.ts [sitemapUrl]
 */

const HOST = 'jawab24.com';
const ORIGIN = `https://${HOST}`;
const ENDPOINT = 'https://api.indexnow.org/indexnow';

/** Extract production <loc> URLs from a sitemap XML string. */
export function extractSitemapUrls(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1].trim())
    .filter((u) => u.startsWith(`${ORIGIN}/`) || u === ORIGIN || u === `${ORIGIN}/`);
}

async function main() {
  const key = process.env.INDEXNOW_KEY;
  if (!key) {
    console.log('INDEXNOW_KEY not set — skipping IndexNow ping.');
    return;
  }

  const sitemapUrl = process.argv[2] || `${ORIGIN}/sitemap.xml`;
  // Only ever fetch our own origin. The deploy passes no argument; this guards a
  // mistyped/hostile override and rejects any redirect off jawab24.com (SSRF).
  if (new URL(sitemapUrl).origin !== ORIGIN) {
    throw new Error(`Refusing to fetch sitemap off-origin: ${sitemapUrl}`);
  }
  const res = await fetch(sitemapUrl, { redirect: 'error' });
  if (!res.ok) throw new Error(`Could not fetch sitemap ${sitemapUrl}: HTTP ${res.status}`);

  const urlList = extractSitemapUrls(await res.text());
  if (urlList.length === 0) {
    console.log('No production URLs found in sitemap — nothing to submit.');
    return;
  }

  const ping = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: HOST,
      key,
      keyLocation: `${ORIGIN}/${key}.txt`,
      urlList,
    }),
  });

  // IndexNow returns 200 (accepted) or 202 (accepted, pending validation).
  console.log(`IndexNow: submitted ${urlList.length} URLs → HTTP ${ping.status}`);
  if (ping.status >= 400) {
    console.warn('IndexNow rejected the submission (check the key file is live and matches INDEXNOW_KEY).');
  }
}

main().catch((err) => {
  console.error('IndexNow ping failed (non-fatal):', err instanceof Error ? err.message : err);
  process.exit(0); // never fail the deploy
});
