import { describe, it, expect } from 'vitest';
import {
    CATALOG_VERTICALS,
    EDUCATION_TEMPLATE,
    VERTICAL_TEMPLATES,
    normalizeDirectives,
    parseKeywords,
} from '../index';

/**
 * The template is DATA the extraction step offers a merchant — nothing enforces
 * it at reply time, so its internal consistency is only ever checked here.
 * Each invariant below is one a drifted template would silently break.
 */
describe('vertical templates — internal consistency', () => {
    const templates = Object.values(VERTICAL_TEMPLATES);

    it('registry keys are real verticals and match each template\'s own vertical', () => {
        for (const [key, tpl] of Object.entries(VERTICAL_TEMPLATES)) {
            expect(CATALOG_VERTICALS).toContain(key);
            expect(tpl!.vertical).toBe(key);
        }
    });

    it('collection labels are non-empty and unique within a template', () => {
        for (const tpl of templates) {
            const labels = tpl!.collections.map(c => c.label.trim());
            expect(labels.every(l => l.length > 0)).toBe(true);
            expect(new Set(labels).size).toBe(labels.length);
        }
    });

    it('a keyed collection lists its keyAttr among the suggested attribute labels', () => {
        // The coverage index is computed from the key attribute's values; a template
        // proposing a key it does not also propose as a row attribute would seed
        // rows the boundary statement cannot see (rowsMissingKey > 0 forever).
        for (const tpl of templates) {
            for (const c of tpl!.collections) {
                if (c.keyAttr !== null) {
                    expect(c.attributeLabels).toContain(c.keyAttr);
                }
            }
        }
    });

    it('directive suggestions carry parseable trigger keywords (Post Reply format)', () => {
        for (const tpl of templates) {
            for (const d of tpl!.directiveSuggestions) {
                expect(parseKeywords(d.keywords).length).toBeGreaterThan(0);
                expect(d.hint.trim().length).toBeGreaterThan(0);
            }
        }
    });

    it('directive suggestions become valid directives once a merchant adds a response', () => {
        // The suggestion's keywords must survive normalizeDirectives verbatim —
        // otherwise the onboarding flow would offer triggers the reply path drops.
        for (const tpl of templates) {
            const asDirectives = tpl!.directiveSuggestions.map(d => ({
                keywords: d.keywords,
                response: 'نص يكتبه التاجر',
            }));
            expect(normalizeDirectives(asDirectives)).toHaveLength(asDirectives.length);
        }
    });
});

describe('education (معهد) template — the shape measured on الفريق الدمشقي', () => {
    it('proposes the load-bearing collection split', () => {
        const labels = EDUCATION_TEMPLATE.collections.map(c => c.label);
        expect(labels).toEqual([
            'أسعار الدورات',
            'مواعيد الدورات المعلنة',
            'الدورات الأونلاين المتوفرة',
            'محاور الدورات',
        ]);
    });

    it('puts the curriculum in its OWN keyed collection, not a long attribute', () => {
        // A row attribute is capped at 100 chars on the merchant-facing write
        // path, so a curriculum blob would be unauthorable; as keyed rows it also
        // earns the enumerated coverage boundary for «شو محاور دورة X؟».
        const curriculum = EDUCATION_TEMPLATE.collections.find(c => c.label === 'محاور الدورات');
        expect(curriculum?.keyAttr).toBe(EDUCATION_TEMPLATE.entityNoun);
        for (const c of EDUCATION_TEMPLATE.collections) {
            expect(c.attributeLabels).not.toContain('المحاور');
        }
    });

    it('only the announced-slots collection self-expires', () => {
        // Prices must never expire (a course between cohorts is still a real
        // course); slots must (the stale-date class is killed by data).
        const expiring = EDUCATION_TEMPLATE.collections.filter(c => c.selfExpiring);
        expect(expiring.map(c => c.label)).toEqual(['مواعيد الدورات المعلنة']);
    });

    it('the price list is un-keyed, the slot and online lists are keyed by the entity noun', () => {
        const [prices, slots, online] = EDUCATION_TEMPLATE.collections;
        expect(prices.keyAttr).toBeNull();
        expect(slots.keyAttr).toBe(EDUCATION_TEMPLATE.entityNoun);
        expect(online.keyAttr).toBe(EDUCATION_TEMPLATE.entityNoun);
    });

    it('suggests narrow medical-routing triggers, never the over-broad «مخبر»', () => {
        // «مخبر» would swallow answerable questions about a real lab course
        // («قديش سعر دورة العمل المخبري») — the false positive the keyword
        // router's own bias forbids.
        for (const d of EDUCATION_TEMPLATE.directiveSuggestions) {
            expect(parseKeywords(d.keywords)).not.toContain('مخبر');
        }
    });
});
