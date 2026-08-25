import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db before importing seedData
vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        query: {
            pages: { findMany: vi.fn() },
        },
    }
}));

import { db } from '../../src/db';
import { seedDemoData, DEMO_PAGES, DEMO_DISTRIBUTOR_COLLECTIONS, renderDemoDamascusLists } from '../../src/plugins/demo/seedData';
import {
    DAMASCUS_COURSE_PRICES,
    DAMASCUS_ONLINE_COURSES,
    DAMASCUS_SCHEDULES_LABEL,
    DAMASCUS_SCHEDULES_KEY,
    DAMASCUS_SCHEDULE_SLOTS,
    damascusPriceRowInputs,
    damascusScheduleRowInputs,
    resolveSlotDates,
} from '../../src/plugins/demo/damascusLists';

// Helper to build a chainable select mock.
//
// `.where()` both RESOLVES to the rows (callers that await it directly) and
// carries `.limit()` (seedDemoStore's "does a real store already own this
// fixture domain?" probe chains one). Returning a plain promise with the extra
// method keeps both shapes working from a single stub.
// `limitResult` defaults to [] — the only `.limit()` caller here is that probe,
// and "no existing store owns the fixture domain" is the normal case these tests
// exercise. Pass rows explicitly to simulate a domain already taken.
function mockSelectChain(result: any[], limitResult: any[] = []) {
    const whereResult = Object.assign(Promise.resolve(result), {
        limit: vi.fn().mockResolvedValue(limitResult),
    });
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue(whereResult),
        }),
    };
}

// Helper to build insert chain
function mockInsertChain(result: any = { id: 'new-id', facebookPageId: 'demo_page' }) {
    return {
        values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([result]),
        }),
    };
}

// Helper to build update chain
function mockUpdateChain() {
    return {
        set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
        }),
    };
}

// Helper to build delete chain
function mockDeleteChain() {
    return {
        where: vi.fn().mockResolvedValue(undefined),
    };
}

describe('seedDemoData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should refresh page names when demo pages already exist', async () => {
        // First call: select existing pages → return pages with old names
        const existingPages = [
            { facebookPageId: 'demo_page_institute', name: 'OLD NAME' },
            { facebookPageId: 'demo_page_school', name: 'OLD SCHOOL NAME' },
            { facebookPageId: 'demo_page_electronics', name: 'OLD STORE' },
            { facebookPageId: 'demo_page_fashion', name: 'OLD FASHION' },
        ];
        vi.mocked(db.select).mockReturnValue(mockSelectChain(existingPages) as any);

        // update() calls for refreshing page data
        vi.mocked(db.update).mockReturnValue(mockUpdateChain() as any);

        // delete() + insert() for refreshing notifications
        vi.mocked(db.delete).mockReturnValue(mockDeleteChain() as any);
        vi.mocked(db.insert).mockReturnValue(mockInsertChain() as any);

        await seedDemoData('user-123', 'ws-123');

        // Derived from the fixture list so adding a demo page doesn't break this
        // test: 1 settings dashboardLanguage refresh + one refresh per DEMO_PAGES
        // entry + 2 e-commerce page link updates (Shopify on electronics, Salla
        // on fashion, both via seedDemoStore) + the D-102 store-facts writes:
        // applyStoreFactsToLinkedPages (Salla store only) selects linked pages —
        // this suite's select mock returns the same `existingPages` fixture for
        // every select, so all 4 rows read as linked, fact-less pages and each
        // gets one business_profile update.
        const SETTINGS_REFRESH = 1;
        const ECOMMERCE_PAGE_LINKS = 2;
        const STORE_FACTS_WRITES = existingPages.length;
        expect(db.update).toHaveBeenCalledTimes(
            SETTINGS_REFRESH + DEMO_PAGES.length + ECOMMERCE_PAGE_LINKS + STORE_FACTS_WRITES,
        );
    });

    it('should create pages when no demo data exists', async () => {
        // select existing pages → none
        vi.mocked(db.select).mockReturnValue(mockSelectChain([]) as any);

        // insert for settings, pages, posts, comments, notifications
        vi.mocked(db.insert).mockReturnValue(mockInsertChain() as any);

        // update for settings (may not be called if no existing settings)
        vi.mocked(db.update).mockReturnValue(mockUpdateChain() as any);

        // delete for notifications refresh
        vi.mocked(db.delete).mockReturnValue(mockDeleteChain() as any);

        await seedDemoData('user-123', 'ws-123');

        // Should have called insert multiple times (settings + 3 pages + 6 posts + 10 comments + 7 notifications)
        expect(db.insert).toHaveBeenCalled();
        // Should NOT have called update for pages (they are new)
        // The first select returns [] so no update is triggered for pages
    });

    it('seeds e-commerce stores with platformData.demo so real-API paths skip them', async () => {
        // Regression for JAWAB24-BACKEND-19: the demo stores' placeholder tokens are
        // not real ciphertext; without this marker the sync cron / webhook paths
        // pick them up and fail on decrypt. Store seeding only runs for pages that
        // resolve, so use the refresh path with the store-linked pages present.
        const existingPages = [
            { id: 'page-electronics', facebookPageId: 'demo_page_electronics', name: 'OLD STORE' },
            { id: 'page-fashion', facebookPageId: 'demo_page_fashion', name: 'OLD FASHION' },
        ];
        vi.mocked(db.select).mockReturnValue(mockSelectChain(existingPages) as any);
        const insertChain = mockInsertChain();
        vi.mocked(db.insert).mockReturnValue(insertChain as any);
        vi.mocked(db.update).mockReturnValue(mockUpdateChain() as any);
        vi.mocked(db.delete).mockReturnValue(mockDeleteChain() as any);

        await seedDemoData('user-123', 'ws-123');

        const storeInserts = vi.mocked(insertChain.values).mock.calls
            .map(([values]) => values)
            .filter((values: any) => values?.storeDomain && values?.accessToken);
        expect(storeInserts).toHaveLength(2); // Shopify + Salla
        for (const store of storeInserts) {
            expect(store.platformData.demo).toBe(true);
        }
    });
});


/**
 * G1a fixture integrity. The distributor fixture's 236 outlets moved out of KB
 * prose into fact rows, and every eval case in Cat 69 now depends on properties of
 * that data rather than of a paragraph. These assertions machine-check the traps the
 * fixture comment documents — a silent edit to the list would otherwise turn #728 /
 * #737 green without fixing anything.
 */
describe('distributor fact-collections fixture (G1a)', () => {
    const CITY = DEMO_DISTRIBUTOR_COLLECTIONS[0];
    const WEST = DEMO_DISTRIBUTOR_COLLECTIONS[1];
    const keyValues = (c: typeof CITY) => c.rows.map(r => r.slice(r.lastIndexOf(' - ') + 3).trim());
    const allRows = DEMO_DISTRIBUTOR_COLLECTIONS.flatMap(c => c.rows);

    it('keeps the prod-scale directory: 236 entries across two keyed collections', () => {
        expect(allRows).toHaveLength(236);
        expect(CITY.keyAttr).toBe('المنطقة');
        expect(WEST.keyAttr).toBe('المدينة');
        expect(new Set(keyValues(CITY)).size).toBe(22);
        expect(new Set(keyValues(WEST)).size).toBe(3);
    });

    // H2 (the review's dangerous finding): a row with no key value is invisible to
    // the coverage index, and the renderer then refuses to present the index as a
    // boundary at all — silently dropping the mechanism these cases measure.
    it('gives EVERY row a key value, so the coverage index stays a boundary', () => {
        for (const line of allRows) {
            expect(line, `row must be «name - key»: ${line}`).toContain(' - ');
            expect(line.slice(line.lastIndexOf(' - ') + 3).trim().length).toBeGreaterThan(0);
        }
    });

    it('keeps العجيلات out of both collections (#728 / #737 depend on its absence)', () => {
        for (const line of allRows) expect(line).not.toContain('العجيلات');
    });

    it('keeps عين الدالية listed (#729 green guard: a listed area must still be answered)', () => {
        expect(keyValues(CITY)).toContain('عين الدالية');
    });

    // Trap 5: the near-miss pair that reproduces the probe battery's worst class —
    // the business's own address answered as an outlet location.
    it('lists سوق الخميس but never the page own address سوق الثلاثاء', () => {
        expect(keyValues(CITY)).toContain('سوق الخميس');
        expect(keyValues(CITY)).not.toContain('سوق الثلاثاء');
    });

    // #720: the same facts in prose AND rows is the contradiction factory. Prose
    // also carries no boundary, so a restored copy brings the fabrication straight
    // back while the rows make it look fixed.
    it('leaves neither an outlet directory NOR a prose price table in the fixture KB text', () => {
        const distributor = DEMO_PAGES.find(p => p.facebookPageId === 'demo_page_distributor');
        expect(distributor).toBeDefined();
        const kb = distributor?.suggestedKnowledgeBase ?? '';
        expect(kb).not.toContain('صيدلية');
        expect(kb).not.toContain('حي الرمال');
        // The prose price tail used to be asserted PRESENT here. `eaa9c0d4`
        // ("sizes/prices as the second list KIND — un-keyed, and the prose
        // table retires") deliberately moved it to fact rows but did not
        // update this test, leaving main red and blocking every deploy
        // (2026-07-31). Prices now belong to the same #720 rule as the outlet
        // directory — prose alongside rows is the contradiction factory — so
        // the assertion flips from present to absent rather than being dropped.
        expect(kb).not.toContain('45د');
        expect(kb).not.toContain('54 دينار');
    });
});

/**
 * Schedules-slice fixture integrity (D-052). The damascus institute's enumerable
 * facts moved out of KB prose into THREE collections whose split is load-bearing
 * (see damascusLists.ts): un-keyed undated prices (existence never expires),
 * keyed self-expiring cohort slots (the stale-date class killed by data), and
 * the closed online list (#503/#511 family). These assertions machine-check the
 * traps that design documents — a silent fixture edit would otherwise flip the
 * Cat 51 cases without proving anything.
 */
describe('damascus fact-collections fixture (schedules slice, D-052)', () => {
    const TODAY = '2026-07-31';

    it('splits into un-keyed prices, keyed schedules, keyed online list', () => {
        expect(DAMASCUS_SCHEDULES_KEY).toBe('الدورة');
        // The main price list is seeded with keyAttr: null (un-keyed): gating a
        // price table withholds every row from «قديش أسعار الدورات؟», which
        // names no course — the sizes-slice dead end (#551). The ONLINE list is
        // KEYED: measured 2026-07-31, the un-keyed generic absence line let
        // #503 affirm «الإنجليزية أونلاين»; the enumerated boundary stops it.
        const rendered = renderDemoDamascusLists(TODAY);
        expect(rendered).toContain(DAMASCUS_COURSE_PRICES.label);
        expect(rendered).toContain(DAMASCUS_SCHEDULES_LABEL);
        expect(rendered).toContain(DAMASCUS_ONLINE_COURSES.label);
        // Every online row carries the key so the coverage index stays a boundary.
        for (const r of DAMASCUS_ONLINE_COURSES.rows) {
            expect(r.course.trim().length, `online row missing key: ${r.name}`).toBeGreaterThan(0);
        }
    });

    // H2 guard: a slot without the key attribute is invisible to the coverage
    // index, and the renderer then refuses to present the index as a boundary.
    it('gives EVERY schedule slot a «الدورة» key value', () => {
        for (const row of damascusScheduleRowInputs(TODAY)) {
            const key = row.attributes.find(a => a.label === DAMASCUS_SCHEDULES_KEY);
            expect(key?.value.trim().length, `slot missing key: ${row.name}`).toBeGreaterThan(0);
        }
    });

    it('resolves slot dates: fixed stay fixed, relative land in the future, null never expires', () => {
        expect(resolveSlotDates('2026-06-25', TODAY)).toEqual({ startsAt: '2026-06-25', endsAt: '2026-06-25' });
        expect(resolveSlotDates({ inDays: 3 }, TODAY)).toEqual({ startsAt: '2026-08-03', endsAt: '2026-08-03' });
        expect(resolveSlotDates(null, TODAY)).toEqual({ startsAt: null, endsAt: null });
    });

    // The merchant's real cohort dates are kept AS-IS precisely because they are
    // past: they exercise suppression. A "real" date accidentally in the future
    // would silently stop testing the stale-date class.
    it('keeps every fixed-date slot in the past and every relative slot upcoming', () => {
        let fixed = 0, relative = 0, undated = 0;
        for (const s of DAMASCUS_SCHEDULE_SLOTS) {
            if (s.start === null) { undated++; continue; }
            if (typeof s.start === 'string') {
                fixed++;
                expect(s.start < TODAY, `fixed date must be past: ${s.name} ${s.start}`).toBe(true);
            } else {
                relative++;
                expect(s.start.inDays).toBeGreaterThan(0);
            }
        }
        // All three temporal shapes must stay represented — each proves a
        // different behaviour (suppression / upcoming quote / honest no-date).
        expect(fixed).toBeGreaterThan(0);
        expect(relative).toBeGreaterThan(0);
        expect(undated).toBeGreaterThan(0);
    });

    it('never renders an expired cohort — المكياج (all slots past) drops out of rows AND coverage', () => {
        const rendered = renderDemoDamascusLists(TODAY);
        // No stale date string survives into the prompt…
        expect(rendered).not.toContain('2026-06-25');
        expect(rendered).not.toContain('2026-07-04');
        // …and المكياج has no live slot, so the schedules coverage index must not
        // claim it. Its EXISTENCE stays grounded by the price list (which never
        // expires) — that separation is why prices and schedules are two
        // collections, not one.
        const scheduleBlock = rendered.slice(rendered.indexOf(DAMASCUS_SCHEDULES_LABEL));
        expect(scheduleBlock).not.toContain('المكياج');
        const priceBlock = rendered.slice(rendered.indexOf(DAMASCUS_COURSE_PRICES.label), rendered.indexOf(DAMASCUS_SCHEDULES_LABEL));
        expect(priceBlock).toContain('دورة المكياج او التجميل');
        // Upcoming cohorts DO render with their resolved dates.
        expect(scheduleBlock).toContain('دورة ICDL');
        expect(scheduleBlock).toContain('starts 2026-08-03');
    });

    // Eval #755 premise (prod الدمشقي 2026-08-05): the SUB-KEY hole. «محادثة» is a
    // real priced English level with NO cohort slot, while its sibling levels under
    // the SAME key value («انكليزي») do have live ones. That asymmetry is the whole
    // reproduction — the row gate admits the siblings and the coverage index, being
    // keyed on «الدورة», still asserts انكليزي is covered. If this premise ever
    // drifts (a محادثة slot gets added, or the English siblings all expire), #755
    // stops measuring anything and must be re-authored, not re-baselined.
    it('#755 premise: محادثة is priced but slot-less while sibling انكليزي levels are live', () => {
        const levelOf = (r: { attributes: { label: string; value: string }[] | null }) =>
            r.attributes?.find(a => a.label === 'المستوى')?.value;
        const pricedLevels = damascusPriceRowInputs(DAMASCUS_COURSE_PRICES)
            .filter(r => r.name === 'اللغة الإنكليزية')
            .map(levelOf);
        expect(pricedLevels).toContain('محادثة');

        const englishSlots = DAMASCUS_SCHEDULE_SLOTS.filter(s => s.course === 'انكليزي');
        expect(englishSlots.map(s => s.level)).not.toContain('محادثة');
        // The siblings must be genuinely borrowable — upcoming, not expired.
        const liveSiblings = englishSlots.filter(s => {
            const { startsAt } = resolveSlotDates(s.start, TODAY);
            return startsAt === null || startsAt >= TODAY;
        });
        expect(liveSiblings.length).toBeGreaterThan(0);
        // …and the boundary the model reads names the KEY, never the level.
        expect(DAMASCUS_SCHEDULES_KEY).toBe('الدورة');
    });

    // #503/#511 anchor: the closed online list is exactly the merchant's three,
    // so «دورة X أونلاين؟» for anything else hits the absence directive.
    it('keeps the online list closed: ICDL / الإكسل / محاسبة الأمين only', () => {
        const names = DAMASCUS_ONLINE_COURSES.rows.map(r => r.name).join('|');
        expect(DAMASCUS_ONLINE_COURSES.rows).toHaveLength(3);
        expect(names).toContain('ICDL');
        expect(names).toContain('الإكسل');
        expect(names).toContain('محاسبة الأمين');
        expect(names).not.toContain('الإنكليزية');
        expect(names).not.toContain('المكياج');
    });

    // fact_rows.currency is varchar(10) — the full «بالعملة القديمة» phrasing
    // does not fit and belongs to prose. A longer value would fail at INSERT
    // time in prod but silently pass the pure renderer.
    it('keeps every currency within the varchar(10) column', () => {
        for (const r of [...damascusPriceRowInputs(DAMASCUS_COURSE_PRICES), ...damascusPriceRowInputs(DAMASCUS_ONLINE_COURSES)]) {
            expect(r.currency.length).toBeLessThanOrEqual(10);
        }
    });

    // #720 discipline: the same fact in prose AND rows is the contradiction
    // factory. The KB keeps behaviour (Q&A, address, hours, certificates) and
    // loses every enumerable price/date the rows now own.
    it('leaves no course prices or cohort dates behind in the fixture KB text', () => {
        const damascus = DEMO_PAGES.find(p => p.facebookPageId === 'demo_page_damascus');
        expect(damascus).toBeDefined();
        const kb = damascus?.suggestedKnowledgeBase ?? '';
        expect(kb).not.toContain('/2026');            // every cohort date is gone
        expect(kb).not.toContain('المواعيد المتوفرة');
        expect(kb).not.toContain('35000');            // the price ladders are gone
        expect(kb).not.toMatch(/تبدأ \d/);
        expect(kb).not.toContain('10 دولار');         // online list moved to rows
        // …while what belongs in prose stays:
        expect(kb).toContain('لا يوجد لدينا دورة ادارة أعمال');   // #501 anchor
        expect(kb).toContain('هل يوجد دورة خياطة');               // #506 anchor
        expect(kb).toContain('برامكة سانا');                       // address
        expect(kb).toContain('شهادة دولية 250');                   // certificate fees stay prose
        expect(kb).toContain('كل 100 ليرة قديمة تساوي 1 ليرة جديدة'); // currency note
    });
});
