/**
 * LIVE golden test — proves the extractor on the REAL Damascus-institute KB
 * (the actual prod failure fixture), using a real OpenAI call. The mocked unit
 * tests in operationalFactsExtractor.test.ts cover post-processing; this one
 * answers the question that actually matters: does the model parse messy Arabic
 * prose ("كل ايام الاسبوع من 9 صباحا الى 8 مساء ماعدا الجمعة") into the right
 * structured hours AND ignore the course-schedule decoys ("٨ ساعات تدريبية",
 * the course day-lists) that caused the bug?
 *
 * Skipped by default (no network in unit CI). Run on demand:
 *   cd backend && RUN_LIVE_AI=1 node --env-file=.env --import tsx \
 *     ./node_modules/.bin/vitest run test/services/kb/operationalFactsExtractor.live.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { operationalFactsExtractor } from '../../../src/services/kb/operationalFactsExtractor';

const LIVE = process.env.RUN_LIVE_AI === '1' && !!process.env.OPENAI_API_KEY;

describe.runIf(LIVE)('operationalFactsExtractor — LIVE (real OpenAI, institute KB)', () => {
    it('extracts 09:00-20:00 Sat–Thu + Friday closed, ignoring course schedules', async () => {
        const kb = readFileSync(join(__dirname, '../../fixtures/institute-kb.txt'), 'utf8');

        const facts = await operationalFactsExtractor.extract(kb, {
            userId: 'live-test',
            model: 'gpt-4.1', // pin a strong model (backfill-grade); bypasses DB model resolution
        });

        // The reported bug: Friday (closed) was inverted to "open"; the start time
        // 9 became 8 (from "٨ ساعات تدريبية"); the day range was confabulated.
        expect(facts.hours?.fri).toEqual(['closed']);
        for (const d of ['sat', 'sun', 'mon', 'tue', 'wed', 'thu'] as const) {
            expect(facts.hours?.[d]).toEqual(['09:00-20:00']);
        }
        // Must NOT have invented an 08:00 start from the "8 training hours" decoy.
        expect(JSON.stringify(facts.hours)).not.toContain('08:00');
        // Address surfaced from the free text.
        expect(facts.address).toMatch(/برامكة/);
    }, 30_000);
});
