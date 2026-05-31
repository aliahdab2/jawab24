import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Serves the IndexNow key-verification file as plain text.
 *
 * IndexNow requires the key to be reachable at https://<host>/<key>.txt; the
 * rewrite in next.config.js maps that path here. The key is public by design
 * (IndexNow keys are not secrets) but is sourced from the INDEXNOW_KEY env var
 * so it is never committed. Returns 404 when the key is not configured.
 */
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  const key = process.env.INDEXNOW_KEY;
  if (!key) {
    res.status(404).end();
    return;
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.status(200).send(key);
}
