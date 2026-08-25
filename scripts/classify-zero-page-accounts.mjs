// Classify WHY existing zero-page accounts have no connected page:
// Instagram-only merchant / declined the pages permission / personal account
// managing nothing / token expired (unknowable until they log in again).
//
// READ-ONLY: issues one SELECT and per-user Facebook Graph GETs (debug_token,
// /me/accounts). Writes nothing to the database and prints no tokens.
//
// Must run INSIDE the production backend container (the token-decryption key
// and DB credentials live only there). From the production server:
//
//   docker exec -i jawab24-backend node --input-type=module - \
//     < /var/www/jawab24/scripts/classify-zero-page-accounts.mjs
//
// (Or pipe it over SSH from a checkout:
//   ssh -i ~/.ssh/id_jawab24_deploy root@91.99.95.196 \
//     'docker exec -i jawab24-backend node --input-type=module -' \
//     < scripts/classify-zero-page-accounts.mjs )
//
// Forward-looking accounts don't need this script: since feat/no-pages-diagnosis
// every zero-page login/sync records the same classification on the user's
// no_fb_pages activation event (activation_events.metadata).

import { createRequire } from 'module';
import crypto from 'crypto';

const require = createRequire('/app/backend/');
const postgres = require('postgres');

const GRAPH = 'https://graph.facebook.com/v23.0';
const { DATABASE_URL, FACEBOOK_TOKEN_ENCRYPTION_KEY, FACEBOOK_APP_ID, FACEBOOK_APP_SECRET } = process.env;
if (!DATABASE_URL || !FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
    console.error('Missing DATABASE_URL / FACEBOOK_APP_ID / FACEBOOK_APP_SECRET in env — run inside the backend container.');
    process.exit(1);
}

// Mirrors backend/src/services/facebookCrypto.ts (enc:v1:<iv_hex>:<ct_b64>.<tag_b64>,
// AES-256-GCM, key = sha256(secret)). Legacy plaintext tokens pass through.
function decryptToken(stored) {
    if (!stored) return '';
    if (!stored.startsWith('enc:v1:')) return stored;
    if (!FACEBOOK_TOKEN_ENCRYPTION_KEY) throw new Error('FACEBOOK_TOKEN_ENCRYPTION_KEY missing');
    const body = stored.slice('enc:v1:'.length);
    const colonIdx = body.indexOf(':');
    const ivHex = body.slice(0, colonIdx);
    const rest = body.slice(colonIdx + 1);
    const dotIdx = rest.lastIndexOf('.');
    const key = crypto.createHash('sha256').update(FACEBOOK_TOKEN_ENCRYPTION_KEY).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'), { authTagLength: 16 });
    decipher.setAuthTag(Buffer.from(rest.slice(dotIdx + 1), 'base64'));
    let out = decipher.update(rest.slice(0, dotIdx), 'base64', 'utf8');
    out += decipher.final('utf8');
    return out;
}

async function graphGet(path, params) {
    const url = new URL(`${GRAPH}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url);
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, json };
}

const sql = postgres(DATABASE_URL, { max: 1 });
try {
    const rows = await sql`
        SELECT u.id, u.email, u.name, u.created_at, u.facebook_access_token
        FROM workspaces w
        JOIN users u ON u.id = w.owner_id
        LEFT JOIN pages p ON p.workspace_id = w.id
        GROUP BY w.id, u.id
        HAVING COUNT(p.id) = 0
        ORDER BY u.created_at DESC`;

    console.log(`Zero-page workspaces: ${rows.length}\n`);
    const counts = {};
    const appToken = `${FACEBOOK_APP_ID}|${FACEBOOK_APP_SECRET}`;

    for (const row of rows) {
        let reason = 'no_token';
        let detail = '';
        const token = (() => { try { return decryptToken(row.facebook_access_token); } catch { return ''; } })();

        if (token) {
            const dbg = await graphGet('debug_token', { input_token: token, access_token: appToken });
            const data = dbg.json?.data;
            if (!dbg.ok || !data) {
                reason = 'debug_failed';
                detail = dbg.json?.error?.message ?? '';
            } else if (!data.is_valid) {
                reason = 'token_expired';
            } else {
                const scopes = data.scopes ?? [];
                const granular = data.granular_scopes ?? [];
                const igTargets = granular.find(s => s.scope === 'instagram_basic')?.target_ids?.length ?? 0;
                const pageTargets = new Set(
                    granular.filter(s => s.scope.startsWith('pages_')).flatMap(s => s.target_ids ?? []),
                ).size;
                const accounts = await graphGet('me/accounts', { access_token: token, fields: 'id', limit: '100' });
                const pagesNow = accounts.ok ? (accounts.json?.data?.length ?? 0) : -1;

                reason = !scopes.includes('pages_show_list') ? 'permissions_declined'
                    : pagesNow > 0 || pageTargets > 0 ? 'has_pages_now'
                    : igTargets > 0 ? 'instagram_only'
                    : 'no_pages';
                detail = `igTargets=${igTargets} pageTargets=${pageTargets} pagesNow=${pagesNow}`;
            }
        }

        counts[reason] = (counts[reason] ?? 0) + 1;
        const created = new Date(row.created_at).toISOString().slice(0, 10);
        console.log(`${reason.padEnd(20)} ${created}  ${row.email ?? '(no email)'}  ${row.name ?? ''}  ${detail}`);
    }

    console.log('\nSummary:');
    for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${k.padEnd(20)} ${v}`);
    }
} finally {
    await sql.end();
}
