import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Serves the IndexNow key-verification file as plain text.
 *
 * IndexNow requires the key to be reachable at https://<host>/<key>.txt; the
 * rewrite in next.config.js maps `/<token>.txt` here with `?key=<token>`. The
 * key is validated against the RUNTIME env (INDEXNOW_KEY) — public by design
 * (IndexNow keys are not secrets) but never committed — so the served file does
 * not depend on build-time env. Returns 404 unless the requested token matches
 * the configured key (and 404 when the key is unset).
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const key = process.env.INDEXNOW_KEY;
  const requested = req.query.key;
  if (!key || requested !== key) {
    res.status(404).end();
    return;
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.status(200).send(key);
}
