/**
 * Throttled cold-load measurement of the Jawab24 dashboard against PRODUCTION,
 * using the public shared demo account.
 *
 * Method:
 *   1. UNTHROTTLED: load /login, click "Try Demo" so the app's own Zustand auth
 *      store is populated and persisted to localStorage (the guard reads the
 *      store, not localStorage.token — seeding the token alone bounces to /login).
 *   2. Apply throttling + setCacheDisabled.
 *   3. FULL reload of /dashboard. This reproduces the APK cold start: persisted
 *      auth rehydrates from storage, then the real boot burst fires.
 *
 * Buckets:
 *   api / image        -> real APK cost
 *   bundled            -> ships inside the APK, NOT an APK cost (subtract it)
 *
 * Usage: node measure-slow.mjs "<Slow 3G|Fast 3G|Fast 4G|none>"
 */
const pw = await import('playwright');
const chromium = pw.chromium ?? pw.default?.chromium;

const PRESETS = {
  'Slow 3G': { latency: 2000, download: (400 * 1024) / 8, upload: (400 * 1024) / 8 },
  'Fast 3G': { latency: 562.5, download: (1.6 * 1024 * 1024) / 8, upload: (750 * 1024) / 8 },
  'Fast 4G': { latency: 20, download: (9 * 1024 * 1024) / 8, upload: (9 * 1024 * 1024) / 8 },
  none: null,
};
const presetName = process.argv[2] || 'Slow 3G';
const preset = PRESETS[presetName];
if (preset === undefined) throw new Error(`unknown preset ${presetName}`);

const ORIGIN = 'https://jawab24.com';
const log = (...a) => { console.log(...a); };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36',
});
const page = await context.newPage();

// ---- 1. Real UI demo login, unthrottled
await page.goto(`${ORIGIN}/en/login`, { waitUntil: 'networkidle', timeout: 90000 });
const btn = page.getByRole('button', { name: /Try Demo/i });
await btn.waitFor({ state: 'visible', timeout: 30000 });
await btn.click();
await page.waitForURL(/\/dashboard/, { timeout: 90000 });
// Let the dashboard settle so the auth store is persisted
await page.waitForTimeout(6000);
const authed = await page.evaluate(() => {
  const keys = Object.keys(localStorage);
  const authKey = keys.find((k) => k.includes('auth'));
  return {
    url: location.pathname,
    keys,
    authSnippet: authKey ? localStorage.getItem(authKey)?.slice(0, 160) : null,
  };
});
log('after UI demo login:', JSON.stringify(authed).slice(0, 500));
if (!/dashboard/.test(authed.url)) {
  await browser.close();
  throw new Error('demo login did not land on /dashboard');
}

// ---- 2. Throttle + disable cache
// cacheMode=apk  -> keep the HTTP cache WARM. Next.js static chunks carry
//   immutable Cache-Control so they are served locally, exactly like the APK's
//   bundled assets, while /api/* has NO Cache-Control and still hits the
//   network. This is the faithful Android-app proxy.
// cacheMode=web  -> cold cache, i.e. a first-visit browser load.
const cacheMode = process.argv[3] || 'web';
const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: cacheMode !== 'apk' });
log('target: ' + (process.argv[4] || '/en/dashboard'));
log('cache mode: ' + cacheMode + ' (cacheDisabled=' + (cacheMode !== 'apk') + ')');
if (preset) {
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: preset.latency,
    downloadThroughput: preset.download,
    uploadThroughput: preset.upload,
    connectionType: 'cellular3g',
  });
}

const reqs = new Map();
const finished = [];
cdp.on('Network.requestWillBeSent', (e) => {
  reqs.set(e.requestId, { url: e.request.url, type: e.type, start: e.timestamp });
});
cdp.on('Network.responseReceived', (e) => {
  const r = reqs.get(e.requestId);
  if (r) { r.status = e.response.status; r.type = e.type || r.type; }
});
cdp.on('Network.loadingFinished', (e) => {
  const r = reqs.get(e.requestId);
  if (r) { r.end = e.timestamp; r.bytes = e.encodedDataLength; finished.push(r); }
});
cdp.on('Network.loadingFailed', (e) => {
  const r = reqs.get(e.requestId);
  if (r) { r.end = e.timestamp; r.failed = e.errorText; r.bytes = 0; finished.push(r); }
});

// ---- 3. Cold reload of the dashboard under throttling
const t0 = Date.now();
let contentMs = null;
const poll = (async () => {
  while (Date.now() - t0 < 170000) {
    try {
      const done = await page.evaluate(() => {
        const pulses = document.querySelectorAll('.animate-pulse').length;
        const nodes = document.querySelectorAll('main *').length;
        return { pulses, nodes };
      });
      if (done.pulses === 0 && done.nodes > 40 && contentMs === null) {
        contentMs = Date.now() - t0;
        return;
      }
    } catch { /* mid-navigation */ }
    await new Promise((r) => setTimeout(r, 200));
  }
})();

const TARGET = process.argv[4] || '/en/dashboard';
await page.goto(ORIGIN + TARGET, { waitUntil: 'commit', timeout: 170000 }).catch((e) =>
  log('goto note:', e.message.slice(0, 120)),
);
await Promise.race([poll, new Promise((r) => setTimeout(r, 120000))]);
await new Promise((r) => setTimeout(r, 6000));
const totalMs = Date.now() - t0;

// ---- 4. Report
const group = (r) => {
  const t = r.type || 'Other';
  if (t === 'XHR' || t === 'Fetch' || t === 'EventSource') return 'api';
  if (t === 'Image') return 'image';
  return 'bundled';
};
const host = (u) => { try { return new URL(u).host; } catch { return '?'; } };
const path = (u) => { try { const x = new URL(u); return x.pathname + (x.search ? '?' + x.search.slice(0, 60) : ''); } catch { return u; } };
const sum = (a) => a.reduce((s, r) => s + (r.bytes || 0), 0);

const byGroup = { api: [], image: [], bundled: [] };
for (const r of finished) byGroup[group(r)].push(r);

log('\n================ RESULT: ' + presetName + ' / cache=' + cacheMode + ' ================');
log('time to dashboard content : ' + (contentMs ?? '>' + totalMs + ' (never)') + ' ms');
log('observed window           : ' + totalMs + ' ms');

for (const g of ['api', 'image', 'bundled']) {
  const list = byGroup[g];
  const label = g === 'bundled' ? 'bundled-in-APK (NOT an APK cost)' : g.toUpperCase();
  log(`\n--- ${label}: ${list.length} requests, ${(sum(list) / 1024).toFixed(1)} kB ---`);
  const hosts = {};
  for (const r of list) {
    const h = host(r.url);
    hosts[h] = hosts[h] || { n: 0, b: 0 };
    hosts[h].n++; hosts[h].b += r.bytes || 0;
  }
  for (const [h, v] of Object.entries(hosts).sort((a, b) => b[1].n - a[1].n)) {
    log(`  ${h}: ${v.n} req, ${(v.b / 1024).toFixed(1)} kB`);
  }
}

log('\n--- ALL api-bucket requests (xhr/fetch), slowest first ---');
for (const r of byGroup.api
  .map((r) => ({ p: host(r.url) + path(r.url), kb: ((r.bytes || 0) / 1024).toFixed(1),
                 ms: r.end && r.start ? Math.round((r.end - r.start) * 1000) : null,
                 off: r.start }))
  .sort((a, b) => (b.ms || 0) - (a.ms || 0))) {
  log(`  ${r.ms} ms | ${r.kb} kB | ${r.p.slice(0, 90)}`);
}

log('\n--- /api calls, slowest first ---');
const apiRows = byGroup.api
  .filter((r) => r.url.includes('/api/'))
  .map((r) => ({
    p: path(r.url),
    s: r.failed ? 'FAIL:' + r.failed : r.status,
    kb: ((r.bytes || 0) / 1024).toFixed(1),
    ms: r.end && r.start ? Math.round((r.end - r.start) * 1000) : null,
  }))
  .sort((a, b) => (b.ms || 0) - (a.ms || 0));
for (const r of apiRows) log(`  ${r.ms} ms | ${r.kb} kB | ${r.s} | ${r.p}`);

const counts = {};
for (const r of apiRows) { const k = r.p.split('?')[0]; counts[k] = (counts[k] || 0) + 1; }
const rep = Object.entries(counts).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
if (rep.length) {
  log('\n--- repeated /api paths (duplicates / retries) ---');
  for (const [p, n] of rep) log(`  ${p} x${n}`);
}

// Wave structure: when was each /api request ISSUED, relative to the first one?
// A single wave => all starts clustered. Multiple waves => gaps ~1 RTT apart,
// which is dependency depth and the thing worth removing.
const apiOnly = byGroup.api.filter((r) => r.url.includes('/api/') && r.start);
if (apiOnly.length) {
  const base = Math.min(...apiOnly.map((r) => r.start));
  log('\n--- request ISSUE timeline (ms after first /api request) ---');
  for (const r of apiOnly.sort((a, b) => a.start - b.start)) {
    const off = Math.round((r.start - base) * 1000);
    const dur = r.end ? Math.round((r.end - r.start) * 1000) : null;
    log(`  +${String(off).padStart(6)} ms  (${String(dur).padStart(5)} ms)  ${path(r.url).slice(0, 62)}`);
  }
}

log('\n--- images (Facebook avatar fan-out) ---');
const imgHosts = {};
for (const r of byGroup.image) {
  const h = host(r.url);
  imgHosts[h] = imgHosts[h] || { n: 0, b: 0, ms: 0 };
  imgHosts[h].n++; imgHosts[h].b += r.bytes || 0;
  imgHosts[h].ms = Math.max(imgHosts[h].ms, r.end && r.start ? Math.round((r.end - r.start) * 1000) : 0);
}
for (const [h, v] of Object.entries(imgHosts)) {
  log(`  ${h}: ${v.n} req, ${(v.b / 1024).toFixed(1)} kB, slowest ${v.ms} ms`);
}

log('\nAPK-relevant subtotal (api + image): ' +
  (byGroup.api.length + byGroup.image.length) + ' requests, ' +
  ((sum(byGroup.api) + sum(byGroup.image)) / 1024).toFixed(1) + ' kB');

await browser.close();
