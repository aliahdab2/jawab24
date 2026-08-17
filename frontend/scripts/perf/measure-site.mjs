/**
 * PUBLIC WEBSITE measurement — jawab24.com, cold cache, DevTools "Slow 3G".
 *
 * Same CDP knobs the DevTools network-conditions dropdown sets:
 *   Slow 3G = 400 kbps down / 400 kbps up / 2,000 ms RTT.
 *
 * Unlike the APK-equivalent runs, the JS/CSS/font bundle IS a real cost here:
 * on the website every visitor downloads it, including the merchant who taps a
 * link inside the Facebook app.
 *
 * Usage: node measure-site.mjs "<preset>" "<path>"
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
const target = process.argv[3] || '/ar';
const preset = PRESETS[presetName];
const ORIGIN = 'https://jawab24.com';
const log = (...a) => console.log(...a);

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

// Collect web vitals from inside the page, before any app script runs.
await page.addInitScript(() => {
  window.__vitals = { fcp: null, lcp: null, cls: 0 };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__vitals.fcp = e.startTime;
    }).observe({ type: 'paint', buffered: true });
    new PerformanceObserver((l) => {
      const es = l.getEntries();
      if (es.length) window.__vitals.lcp = es[es.length - 1].startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) window.__vitals.cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  } catch { /* older chromium */ }
});

const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }); // first visit
if (preset) {
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: preset.latency,
    downloadThroughput: preset.download, uploadThroughput: preset.upload,
    connectionType: 'cellular3g',
  });
}

const reqs = new Map();
const done = [];
cdp.on('Network.requestWillBeSent', (e) => reqs.set(e.requestId, { url: e.request.url, type: e.type, start: e.timestamp }));
cdp.on('Network.responseReceived', (e) => { const r = reqs.get(e.requestId); if (r) { r.status = e.response.status; r.type = e.type || r.type; r.mime = e.response.mimeType; } });
cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) { r.end = e.timestamp; r.bytes = e.encodedDataLength; done.push(r); } });
cdp.on('Network.loadingFailed', (e) => { const r = reqs.get(e.requestId); if (r) { r.end = e.timestamp; r.failed = e.errorText; r.bytes = 0; done.push(r); } });

const t0 = Date.now();
await page.goto(ORIGIN + target, { waitUntil: 'commit', timeout: 240000 }).catch((e) => log('goto note:', e.message.slice(0, 100)));
// Wait for the network to go quiet, capped.
let quietSince = null;
let inflight = 0;
cdp.on('Network.requestWillBeSent', () => { inflight++; quietSince = null; });
const settle = async () => {
  while (Date.now() - t0 < 200000) {
    const n = done.length;
    await new Promise((r) => setTimeout(r, 1000));
    if (done.length === n) { if (!quietSince) quietSince = Date.now(); if (Date.now() - quietSince > 3000) return; }
    else quietSince = null;
  }
};
await settle();
const totalMs = Date.now() - t0;
const vitals = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  return {
    ...window.__vitals,
    ttfb: nav.responseStart,
    dcl: nav.domContentLoadedEventEnd,
    load: nav.loadEventEnd,
    title: document.title,
    h1: document.querySelector('h1')?.textContent?.trim().slice(0, 80) || null,
  };
});

const bucket = (r) => {
  const t = (r.type || '').toLowerCase();
  if (t === 'document') return 'html';
  if (t === 'script') return 'js';
  if (t === 'stylesheet') return 'css';
  if (t === 'font') return 'font';
  if (t === 'image') return 'image';
  if (t === 'xhr' || t === 'fetch') return 'xhr';
  return 'other';
};
const host = (u) => { try { return new URL(u).host; } catch { return '?'; } };
const short = (u) => { try { const x = new URL(u); return x.host + x.pathname.slice(0, 70); } catch { return u.slice(0, 80); } };
const kb = (b) => (b / 1024).toFixed(1);

log(`\n============ ${presetName} | cold cache | ${ORIGIN}${target} ============`);
log(`title: ${vitals.title}`);
log(`h1   : ${vitals.h1}`);
log('');
log(`TTFB                 : ${Math.round(vitals.ttfb)} ms`);
log(`First Contentful Paint: ${vitals.fcp ? Math.round(vitals.fcp) + ' ms' : 'n/a'}`);
log(`Largest Contentful Paint: ${vitals.lcp ? Math.round(vitals.lcp) + ' ms' : 'n/a'}   ${vitals.lcp > 4000 ? '<-- FAILS Core Web Vitals (>4.0 s = poor)' : ''}`);
log(`DOMContentLoaded     : ${Math.round(vitals.dcl)} ms`);
log(`load event           : ${Math.round(vitals.load)} ms`);
log(`CLS                  : ${vitals.cls?.toFixed(3)}   ${vitals.cls > 0.1 ? '<-- over the 0.1 budget' : ''}`);
log(`network quiet after   : ${totalMs} ms`);

const groups = {};
let total = 0;
for (const r of done) {
  const g = bucket(r);
  groups[g] = groups[g] || { n: 0, b: 0 };
  groups[g].n++; groups[g].b += r.bytes || 0; total += r.bytes || 0;
}
log(`\n--- bytes by type (total ${kb(total)} kB over ${done.length} requests) ---`);
for (const [g, v] of Object.entries(groups).sort((a, b) => b[1].b - a[1].b)) {
  log(`  ${g.padEnd(6)} ${String(v.n).padStart(3)} req  ${kb(v.b).padStart(8)} kB  ${(100 * v.b / total).toFixed(0).padStart(3)}%`);
}
const hosts = {};
for (const r of done) { const h = host(r.url); hosts[h] = hosts[h] || { n: 0, b: 0 }; hosts[h].n++; hosts[h].b += r.bytes || 0; }
log('\n--- third-party hosts ---');
for (const [h, v] of Object.entries(hosts).sort((a, b) => b[1].b - a[1].b)) log(`  ${h.padEnd(38)} ${String(v.n).padStart(3)} req  ${kb(v.b).padStart(8)} kB`);

log('\n--- 15 heaviest requests ---');
for (const r of done.sort((a, b) => (b.bytes || 0) - (a.bytes || 0)).slice(0, 15)) {
  const dur = r.end && r.start ? Math.round((r.end - r.start) * 1000) : null;
  log(`  ${kb(r.bytes || 0).padStart(8)} kB | ${String(dur).padStart(6)} ms | ${bucket(r).padEnd(6)} | ${short(r.url)}`);
}
log('\n--- 10 slowest requests ---');
for (const r of done.sort((a, b) => ((b.end - b.start) || 0) - ((a.end - a.start) || 0)).slice(0, 10)) {
  const dur = r.end && r.start ? Math.round((r.end - r.start) * 1000) : null;
  log(`  ${String(dur).padStart(6)} ms | ${kb(r.bytes || 0).padStart(8)} kB | ${bucket(r).padEnd(6)} | ${short(r.url)}`);
}
await browser.close();
