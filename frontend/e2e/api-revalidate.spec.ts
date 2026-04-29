import { test, expect } from '@playwright/test';

/**
 * E2E coverage for the on-demand ISR revalidation endpoint at /api/revalidate.
 *
 * The success path (200 + actual page regeneration) is exercised by the unit
 * tests that mock `res.revalidate`; here we verify the HTTP contract end to
 * end against a real Next.js server: method enforcement, auth, and request
 * validation.
 */

const SECRET = process.env.REVALIDATE_SECRET || 'e2e-revalidate-secret';

test.describe('/api/revalidate', () => {
  test('returns 405 with Allow: POST for GET requests', async ({ request }) => {
    const response = await request.get('/api/revalidate');
    expect(response.status()).toBe(405);
    expect(response.headers()['allow']).toBe('POST');
  });

  test('returns 401 when the secret header is missing', async ({ request }) => {
    const response = await request.post('/api/revalidate', {
      data: { paths: ['/pricing'] },
    });
    expect(response.status()).toBe(401);
  });

  test('returns 401 when the secret header is wrong', async ({ request }) => {
    const response = await request.post('/api/revalidate', {
      headers: { 'x-revalidate-secret': 'this-is-not-the-secret' },
      data: { paths: ['/pricing'] },
    });
    expect(response.status()).toBe(401);
  });

  test('returns 400 when paths array is missing or empty', async ({ request }) => {
    const missing = await request.post('/api/revalidate', {
      headers: { 'x-revalidate-secret': SECRET },
      data: {},
    });
    expect(missing.status()).toBe(400);

    const empty = await request.post('/api/revalidate', {
      headers: { 'x-revalidate-secret': SECRET },
      data: { paths: [] },
    });
    expect(empty.status()).toBe(400);
  });

  test('accepts a valid request and returns per-path results', async ({ request }) => {
    const response = await request.post('/api/revalidate', {
      headers: { 'x-revalidate-secret': SECRET },
      data: { paths: ['/pricing', '/en/pricing'] },
    });

    // 200 if both succeed, 207 if some failed — either is acceptable here as
    // the pages may not exist yet in dev mode where this E2E runs. What we
    // care about is auth + validation + per-path response shape.
    expect([200, 207]).toContain(response.status());
    const body = await response.json();
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results).toHaveLength(2);
    expect(body.results.map((r: { path: string }) => r.path)).toEqual(['/pricing', '/en/pricing']);
  });

  test('rejects malformed paths without invoking revalidation', async ({ request }) => {
    const response = await request.post('/api/revalidate', {
      headers: { 'x-revalidate-secret': SECRET },
      data: { paths: ['pricing'] }, // missing leading /
    });
    expect(response.status()).toBe(207);
    const body = await response.json();
    expect(body.results[0].revalidated).toBe(false);
    expect(body.results[0].error).toMatch(/start with \//);
  });
});
