/**
 * One-off cleanup: clears the English placeholder summary
 * "No conversation provided to extract contact information or intent."
 * from leads created before the leadExtractor comment-context fix.
 *
 * Run once after deploy:
 *   npx tsx backend/src/scripts/cleanup-bad-lead-summaries.ts
 *
 * Behavior:
 *   - Finds leads whose extractedData.summary starts with "No conversation provided"
 *   - Deletes the summary key (leaves phone, fields, status untouched)
 *   - Resets extractionStatus to 'pending' so the next extraction attempt re-runs
 *     with the new comment-aware logic if the lead is touched again
 */
import { db } from '../db';
import { leads } from '../db/schema';
import { sql } from 'drizzle-orm';

async function main() {
    const result = await db.execute(sql`
        UPDATE ${leads}
        SET
            extracted_data = extracted_data - 'summary',
            extraction_status = 'pending',
            updated_at = NOW()
        WHERE extracted_data->>'summary' ILIKE 'No conversation provided%'
        RETURNING id
    `);

    const rowCount = Array.isArray(result) ? result.length : (result as { rowCount?: number }).rowCount ?? 0;
    console.log(`Cleared placeholder summary on ${rowCount} lead(s).`);
}

main()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Cleanup failed:', err);
        process.exit(1);
    });
