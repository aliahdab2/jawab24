import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';

/**
 * Verifies that our CORS configuration allows all HTTP methods needed by the app.
 *
 * Background: @fastify/cors v11+ defaults `methods` to only GET,HEAD,POST
 * (CORS-safelisted methods). DELETE, PUT, and PATCH must be explicitly listed.
 * Without this, browsers will send a preflight OPTIONS request, receive a 204
 * that does NOT include DELETE in Access-Control-Allow-Methods, and then
 * refuse to send the actual request — silently failing on the client.
 */
describe('CORS preflight', () => {
  const mobileOrigins = [
    'capacitor://localhost',
    'http://localhost',
    'https://localhost',
    'https://app.jawab24.com',
    'capacitor://app.jawab24.com',
    'com.jawab24.app',
  ];

  async function buildApp() {
    const app = Fastify();
    await app.register(cors, {
      origin: ['https://jawab24.com', ...mobileOrigins],
      credentials: true,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
    });
    app.delete('/auth/me', async () => ({ ok: true }));
    app.patch('/auth/profile', async () => ({ ok: true }));
    return app;
  }

  it('should allow DELETE in preflight from mobile origin', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/auth/me',
      headers: {
        origin: 'https://localhost',
        'access-control-request-method': 'DELETE',
        'access-control-request-headers': 'authorization,content-type',
      },
    });

    expect(res.statusCode).toBe(204);
    const allowedMethods = res.headers['access-control-allow-methods'];
    expect(allowedMethods).toContain('DELETE');
    expect(allowedMethods).toContain('PUT');
    expect(allowedMethods).toContain('PATCH');
    expect(res.headers['access-control-allow-origin']).toBe('https://localhost');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('should allow PATCH in preflight from mobile origin', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/auth/profile',
      headers: {
        origin: 'https://localhost',
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'authorization,content-type',
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-methods']).toContain('PATCH');
  });

  it('should allow iOS Capacitor origin (capacitor://app.jawab24.com)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/auth/me',
      headers: {
        origin: 'capacitor://app.jawab24.com',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization,content-type',
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('capacitor://app.jawab24.com');
  });

  it('should allow Android Capacitor origin (https://app.jawab24.com)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/auth/me',
      headers: {
        origin: 'https://app.jawab24.com',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization,content-type',
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://app.jawab24.com');
  });

  it('should reject preflight from unknown origin', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/auth/me',
      headers: {
        origin: 'https://evil.com',
        'access-control-request-method': 'DELETE',
      },
    });

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
