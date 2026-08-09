/**
 * Orphan audit for stored merchant images. READ-ONLY — never deletes.
 * Covers every prefix the app writes: `trigger-images/` (Post Reply) and
 * `generated-posts/` («بوست اليوم» suggestions).
 *
 * Reports two kinds of drift between the DB and the object store:
 *   - DB rows whose image key object is MISSING from the bucket (a live
 *     image was lost — investigate; should never happen).
 *   - Bucket objects under an audited prefix with NO matching DB row (orphans
 *     left by a failed best-effort delete — safe to clean up).
 *
 * Run before any bulk cleanup:
 *   npx ts-node src/scripts/audit-trigger-images.ts
 *
 * Deletion is intentionally NOT automated here — the reference-based lifecycle
 * (delete-on-replace/remove + page-delete cleanup) and the bucket lifecycle rule
 * are the primary mechanisms. This is the belt-and-braces visibility check.
 */
import { S3Client, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import { db } from '../db';
import { posts, instagramMedia, postSuggestions } from '../db/schema';
import { isNotNull } from 'drizzle-orm';
import { config } from '../config';
import { imageStorage } from '../services/imageStorage';

const AUDITED_PREFIXES = ['trigger-images/', 'generated-posts/'] as const;

async function main() {
    if (!imageStorage.isConfigured()) {
        console.error('Object storage is not configured (S3_* env). Nothing to audit.');
        process.exit(1);
    }
    const { endpoint, region, bucket, accessKeyId, secretAccessKey } = config.objectStorage;
    const s3 = new S3Client({
        region,
        credentials: { accessKeyId, secretAccessKey },
        ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });

    // 1. All keys referenced by live rows, across every writer of the bucket.
    const dbKeys = new Set<string>();
    for (const row of await db.select({ key: posts.triggerImageKey }).from(posts).where(isNotNull(posts.triggerImageKey))) {
        if (row.key) dbKeys.add(row.key);
    }
    for (const row of await db.select({ key: instagramMedia.triggerImageKey }).from(instagramMedia).where(isNotNull(instagramMedia.triggerImageKey))) {
        if (row.key) dbKeys.add(row.key);
    }
    for (const row of await db.select({ key: postSuggestions.imageKey }).from(postSuggestions).where(isNotNull(postSuggestions.imageKey))) {
        if (row.key) dbKeys.add(row.key);
    }

    // 2. All objects under the audited prefixes.
    const bucketKeys = new Set<string>();
    for (const prefix of AUDITED_PREFIXES) {
        let token: string | undefined;
        do {
            const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
            for (const obj of res.Contents ?? []) {
                if (obj.Key) bucketKeys.add(obj.Key);
            }
            token = res.IsTruncated ? res.NextContinuationToken : undefined;
        } while (token);
    }

    // 3a. DB rows whose object is missing (live image lost — investigate).
    const missing: string[] = [];
    for (const key of dbKeys) {
        if (!bucketKeys.has(key)) {
            try {
                await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
            } catch {
                missing.push(key);
            }
        }
    }

    // 3b. Bucket objects with no DB row (safe-to-clean orphans).
    const orphans = [...bucketKeys].filter(k => !dbKeys.has(k));

    console.log(`DB-referenced keys:   ${dbKeys.size}`);
    console.log(`Bucket objects:       ${bucketKeys.size}`);
    console.log(`\nMISSING (live image lost — INVESTIGATE): ${missing.length}`);
    missing.forEach(k => console.log(`  ! ${k}`));
    console.log(`\nORPHANS (no DB row — safe to clean): ${orphans.length}`);
    orphans.forEach(k => console.log(`  - ${k}`));

    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
