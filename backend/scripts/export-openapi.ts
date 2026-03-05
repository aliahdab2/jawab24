/**
 * Export OpenAPI spec from a running Jawab24 backend server.
 *
 * Usage:
 *   1. Start the backend: npm run dev (in backend/)
 *   2. Run: npx tsx scripts/export-openapi.ts
 *   Output: ../docs/openapi.json
 *
 * The server exposes the spec at GET /docs/json when @fastify/swagger-ui is registered.
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';

const API_URL = process.env.API_URL || 'http://localhost:3000';

async function main() {
  const res = await fetch(`${API_URL}/docs/json`);
  if (!res.ok) {
    throw new Error(`Failed to fetch OpenAPI spec: ${res.status} ${res.statusText}`);
  }

  const spec = await res.json();
  const outPath = resolve(__dirname, '../../docs/openapi.json');
  writeFileSync(outPath, JSON.stringify(spec, null, 2));

  console.log(`OpenAPI spec written to ${outPath} (${Object.keys(spec.paths || {}).length} paths)`);
}

main().catch((err) => {
  console.error('Failed to export OpenAPI spec:', err.message);
  process.exit(1);
});
