import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '@/pages/api/indexnow-key';

interface CapturedRes {
  statusCode?: number;
  headers: Record<string, string>;
  body?: unknown;
}

function mockRes(): { res: NextApiResponse; captured: CapturedRes } {
  const captured: CapturedRes = { headers: {} };
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return res;
    },
    setHeader(key: string, value: string) {
      captured.headers[key.toLowerCase()] = value;
      return res;
    },
    send(body: unknown) {
      captured.body = body;
      return res;
    },
    end() {
      return res;
    },
  } as unknown as NextApiResponse;
  return { res, captured };
}

const reqWithKey = (key?: string) => ({ query: key === undefined ? {} : { key } }) as unknown as NextApiRequest;
const KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

describe('GET /api/indexnow-key', () => {
  const original = process.env.INDEXNOW_KEY;
  beforeEach(() => {
    delete process.env.INDEXNOW_KEY;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.INDEXNOW_KEY;
    else process.env.INDEXNOW_KEY = original;
  });

  it('returns 404 when INDEXNOW_KEY is not configured', () => {
    const { res, captured } = mockRes();
    handler(reqWithKey(KEY), res);
    expect(captured.statusCode).toBe(404);
    expect(captured.body).toBeUndefined();
  });

  it('serves the key as plain text when the requested token matches', () => {
    process.env.INDEXNOW_KEY = KEY;
    const { res, captured } = mockRes();
    handler(reqWithKey(KEY), res);
    expect(captured.statusCode).toBe(200);
    expect(captured.body).toBe(KEY);
    expect(captured.headers['content-type']).toContain('text/plain');
  });

  it('returns 404 when the requested token does not match the configured key', () => {
    process.env.INDEXNOW_KEY = KEY;
    const { res, captured } = mockRes();
    handler(reqWithKey('not-the-key'), res);
    expect(captured.statusCode).toBe(404);
    expect(captured.body).toBeUndefined();
  });

  it('returns 404 when hit directly without a key token', () => {
    process.env.INDEXNOW_KEY = KEY;
    const { res, captured } = mockRes();
    handler(reqWithKey(undefined), res);
    expect(captured.statusCode).toBe(404);
  });
});
