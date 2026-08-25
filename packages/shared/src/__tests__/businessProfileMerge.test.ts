import { describe, it, expect } from 'vitest';
import { applyFbSyncToMerchant, applyMerchantEdit, applyKbExtractToMerchant, applyStoreSyncToMerchant, classifyForMigration, hasTrackedField, formatBusinessInfoPrompt } from '../index';
import type { BusinessProfile, BusinessProfileContainer, MerchantProvenanceMap, StoredBusinessProfile } from '../index';

// The "Damascus institute" fixture — the real prod failure case that
// motivated Option B (page 39aeab89, الفريق الدمشقي للتدريب والتأهيل).
const damascusFbSuggestions: BusinessProfile = {
    name: 'الفريق الدمشقي للتدريب والتأهيل',
    category: 'Local service',
    about: 'فريقنا يهدف الى تطوير وتدريب وتأهيل الشباب السوري',
    phones: ['+963937549674'],
    website: 'https://www.the.damascene.team.com/',
    address: 'البرامكة سانا فوق مكتبة الحافظ الطابق الاول, Damascus, Syria',
    hours: {
        mon: ['08:00-20:00'], tue: ['08:00-20:00'], wed: ['08:00-20:00'],
        thu: ['08:00-20:00'], fri: ['00:00-23:45'], sat: ['08:00-20:00'],
        sun: ['08:00-20:00'],
    },
    language_hint: 'ar',
};

describe('applyFbSyncToMerchant', () => {
    describe('case 1: fresh page (no existing merchant or provenance)', () => {
        it('populates merchant from FB and marks every field as fb_sync, confirmedAt: null', () => {
            const { merchant, merchantProvenance } = applyFbSyncToMerchant(
                undefined,
                undefined,
                damascusFbSuggestions,
            );

            expect(merchant.address).toBe(damascusFbSuggestions.address);
            expect(merchant.phones).toEqual(['+963937549674']);
            expect(merchant.hours?.mon).toEqual(['08:00-20:00']);

            expect(merchantProvenance.address).toEqual({ source: 'fb_sync', confirmedAt: null });
            expect(merchantProvenance.phones).toEqual({ source: 'fb_sync', confirmedAt: null });
            expect(merchantProvenance.hours).toEqual({ source: 'fb_sync', confirmedAt: null });
        });
    });

    describe('case 2: merchant edited address (other fields still fb_sync-owned)', () => {
        it('preserves the edited field, refreshes the others from FB', () => {
            const existingMerchant: BusinessProfile = { address: 'manually-typed-address' };
            const existingProvenance: MerchantProvenanceMap = {
                address: { source: 'editor', confirmedAt: '2026-05-01T10:00:00.000Z' },
            };

            const { merchant, merchantProvenance } = applyFbSyncToMerchant(
                existingMerchant,
                existingProvenance,
                damascusFbSuggestions,
            );

            // Edited field preserved
            expect(merchant.address).toBe('manually-typed-address');
            expect(merchantProvenance.address).toEqual({
                source: 'editor',
                confirmedAt: '2026-05-01T10:00:00.000Z',
            });

            // Other fields refreshed from FB
            expect(merchant.phones).toEqual(['+963937549674']);
            expect(merchantProvenance.phones).toEqual({ source: 'fb_sync', confirmedAt: null });
        });
    });

    describe('case 3: merchant has unconfirmed fb_sync values (the post-migration steady state)', () => {
        it('refreshes them from the new FB sync, keeps source fb_sync and confirmedAt null', () => {
            const existingMerchant: BusinessProfile = {
                address: 'OLD-fb-addr',
                phones: ['+OLD-phone'],
            };
            const existingProvenance: MerchantProvenanceMap = {
                address: { source: 'fb_sync', confirmedAt: null },
                phones: { source: 'fb_sync', confirmedAt: null },
            };

            const { merchant, merchantProvenance } = applyFbSyncToMerchant(
                existingMerchant,
                existingProvenance,
                damascusFbSuggestions,
            );

            expect(merchant.address).toBe(damascusFbSuggestions.address);
            expect(merchant.phones).toEqual(['+963937549674']);
            expect(merchantProvenance.address).toEqual({ source: 'fb_sync', confirmedAt: null });
            expect(merchantProvenance.phones).toEqual({ source: 'fb_sync', confirmedAt: null });
        });
    });

    describe('case 4: merchant explicitly CLEARED phones (cleared ≠ never-seen)', () => {
        it('does NOT repopulate phones from FB, even though FB still has them', () => {
            // Cleared state: merchant.phones is absent AND provenance says editor.
            const existingMerchant: BusinessProfile = {
                address: 'editor-set-address',
                // phones intentionally absent — merchant cleared it
            };
            const existingProvenance: MerchantProvenanceMap = {
                address: { source: 'editor', confirmedAt: '2026-05-01T10:00:00.000Z' },
                phones: { source: 'editor', confirmedAt: '2026-05-01T10:00:00.000Z' },
            };

            const { merchant, merchantProvenance } = applyFbSyncToMerchant(
                existingMerchant,
                existingProvenance,
                damascusFbSuggestions,
            );

            // phones stays cleared — FB suggestion is IGNORED
            expect(merchant.phones).toBeUndefined();
            // provenance is unchanged for the cleared field
            expect(merchantProvenance.phones).toEqual({
                source: 'editor',
                confirmedAt: '2026-05-01T10:00:00.000Z',
            });
            // address (editor-set) also preserved
            expect(merchant.address).toBe('editor-set-address');
        });
    });

    describe('case 5: FB sync result is empty (transient FB outage / private page)', () => {
        it('leaves merchant and provenance untouched', () => {
            const existingMerchant: BusinessProfile = { address: 'X' };
            const existingProvenance: MerchantProvenanceMap = {
                address: { source: 'editor', confirmedAt: '2026-05-01T10:00:00.000Z' },
            };

            const { merchant, merchantProvenance } = applyFbSyncToMerchant(
                existingMerchant,
                existingProvenance,
                {}, // FB returned nothing
            );

            expect(merchant).toEqual(existingMerchant);
            expect(merchantProvenance).toEqual(existingProvenance);
        });
    });

    describe('case 5b: a kb_extract value is not clobbered by a later FB sync (D-008: kb_extract > fb_sync)', () => {
        it('keeps the KB-extracted hours even though FB still reports its own', () => {
            const existingMerchant: BusinessProfile = { hours: { fri: ['closed'] } };
            const existingProvenance: MerchantProvenanceMap = {
                hours: { source: 'kb_extract', confirmedAt: null },
            };
            const { merchant, merchantProvenance } = applyFbSyncToMerchant(
                existingMerchant,
                existingProvenance,
                { hours: { fri: ['00:00-23:45'] } }, // FB's "open all day" — must NOT win
            );
            expect(merchant.hours).toEqual({ fri: ['closed'] });
            expect(merchantProvenance.hours).toEqual({ source: 'kb_extract', confirmedAt: null });
        });
    });

    describe('case 6: end-to-end with formatBusinessInfoPrompt (the bug closes)', () => {
        it('produces a non-null BUSINESS_INFO block for an empty-merchant prod page after FB-sync promotion', () => {
            // Simulates page 39aeab89 BEFORE Option B: merchant={}, suggestions has the data.
            const { merchant } = applyFbSyncToMerchant(undefined, undefined, damascusFbSuggestions);

            const block = formatBusinessInfoPrompt(merchant);

            expect(block).not.toBeNull();
            expect(block).toContain('البرامكة سانا');           // the address
            expect(block).toContain('+963937549674');           // the phone
            expect(block).toContain('Monday: 08:00-20:00');     // formatted hours
        });
    });

    describe('case 7: defensive normalization for pre-Option-B rows', () => {
        // Rollout window: a row written via the editor BEFORE the migration runs
        // has merchant populated but no provenance map. The merge MUST treat
        // those values as editor-owned (preserve them), not free for FB clobber.
        it('treats existing merchant values without provenance as editor-owned', () => {
            const existingMerchant: BusinessProfile = { address: 'pre-migration-editor-value' };
            // No existingProvenance — pre-Option-B state.

            const { merchant, merchantProvenance } = applyFbSyncToMerchant(
                existingMerchant,
                undefined,
                damascusFbSuggestions,
            );

            // Existing editor value preserved
            expect(merchant.address).toBe('pre-migration-editor-value');
            expect(merchantProvenance.address).toEqual({ source: 'editor', confirmedAt: null });

            // Fields not in existing merchant are still populated from FB
            expect(merchant.phones).toEqual(['+963937549674']);
            expect(merchantProvenance.phones).toEqual({ source: 'fb_sync', confirmedAt: null });
        });
    });

    describe('case 8: mixed-provenance overlap (the realistic post-migration state)', () => {
        it('handles editor-owned, fb_sync-owned, and never-seen fields in the same call', () => {
            const existingMerchant: BusinessProfile = {
                address: 'editor-typed',           // editor-owned
                phones: ['+OLD'],                  // fb_sync (will refresh)
                // hours absent — never seen
                // website absent — merchant cleared
            };
            const existingProvenance: MerchantProvenanceMap = {
                address: { source: 'editor', confirmedAt: '2026-05-01T10:00:00.000Z' },
                phones: { source: 'fb_sync', confirmedAt: null },
                website: { source: 'editor', confirmedAt: '2026-05-15T10:00:00.000Z' }, // cleared
            };

            const { merchant, merchantProvenance } = applyFbSyncToMerchant(
                existingMerchant,
                existingProvenance,
                damascusFbSuggestions,
            );

            // address: editor-owned, preserved
            expect(merchant.address).toBe('editor-typed');
            expect(merchantProvenance.address?.source).toBe('editor');

            // phones: fb_sync, refreshed
            expect(merchant.phones).toEqual(['+963937549674']);
            expect(merchantProvenance.phones).toEqual({ source: 'fb_sync', confirmedAt: null });

            // hours: never seen, populated from FB
            expect(merchant.hours?.mon).toEqual(['08:00-20:00']);
            expect(merchantProvenance.hours).toEqual({ source: 'fb_sync', confirmedAt: null });

            // website: cleared, stays cleared
            expect(merchant.website).toBeUndefined();
            expect(merchantProvenance.website?.source).toBe('editor');
        });
    });

    describe('purity (does not mutate inputs)', () => {
        it('returns new objects; does not mutate existingMerchant or existingProvenance', () => {
            const existingMerchant: BusinessProfile = { address: 'X' };
            const existingProvenance: MerchantProvenanceMap = {
                address: { source: 'editor', confirmedAt: '2026-05-01T10:00:00.000Z' },
            };
            const existingMerchantSnapshot = JSON.parse(JSON.stringify(existingMerchant));
            const existingProvenanceSnapshot = JSON.parse(JSON.stringify(existingProvenance));

            applyFbSyncToMerchant(existingMerchant, existingProvenance, damascusFbSuggestions);

            expect(existingMerchant).toEqual(existingMerchantSnapshot);
            expect(existingProvenance).toEqual(existingProvenanceSnapshot);
        });
    });
});

describe('applyMerchantEdit', () => {
    const NOW = new Date('2026-05-29T15:00:00.000Z');
    const NOW_ISO = NOW.toISOString();

    describe('case M1: fresh save (no prior provenance)', () => {
        it('marks every present field as editor + now', () => {
            const patch: BusinessProfile = {
                address: 'merchant-typed-address',
                phones: ['+999'],
            };
            const { merchant, merchantProvenance } = applyMerchantEdit(patch, undefined, NOW);

            expect(merchant).toEqual(patch);
            expect(merchantProvenance.address).toEqual({ source: 'editor', confirmedAt: NOW_ISO });
            expect(merchantProvenance.phones).toEqual({ source: 'editor', confirmedAt: NOW_ISO });
            // Fields not in patch and never seen → no provenance entry
            expect(merchantProvenance.hours).toBeUndefined();
        });
    });

    describe('case M2: save that clears a previously-set field', () => {
        it('marks the cleared field as editor + now (the cleared tombstone)', () => {
            const existingProvenance: MerchantProvenanceMap = {
                address: { source: 'editor', confirmedAt: '2026-05-01T10:00:00.000Z' },
                phones: { source: 'fb_sync', confirmedAt: null },
            };
            // PATCH omits phones — merchant cleared it.
            const patch: BusinessProfile = { address: 'still-here' };

            const { merchant, merchantProvenance } = applyMerchantEdit(patch, existingProvenance, NOW);

            expect(merchant.address).toBe('still-here');
            expect(merchant.phones).toBeUndefined();

            // address present in patch → editor + now (bumped)
            expect(merchantProvenance.address).toEqual({ source: 'editor', confirmedAt: NOW_ISO });
            // phones absent from patch but had prior provenance → cleared tombstone
            expect(merchantProvenance.phones).toEqual({ source: 'editor', confirmedAt: NOW_ISO });
        });
    });

    describe('case M3: LEGACY caller (no existingMerchant) still stamps every present field', () => {
        // Without the stored merchant half the function cannot tell changed
        // from ride-along, so it degrades to the pre-fix behavior. Every
        // production caller passes existingMerchant (see M6+).
        it('refreshes confirmedAt on fields kept in the patch', () => {
            const existingProvenance: MerchantProvenanceMap = {
                address: { source: 'editor', confirmedAt: '2026-05-01T10:00:00.000Z' },
                phones: { source: 'fb_sync', confirmedAt: null },
            };
            // PATCH keeps both fields with the same values.
            const patch: BusinessProfile = { address: 'unchanged', phones: ['+555'] };

            const { merchantProvenance } = applyMerchantEdit(patch, existingProvenance, NOW);

            // Both fields now editor + fresh confirmation timestamp
            expect(merchantProvenance.address?.confirmedAt).toBe(NOW_ISO);
            expect(merchantProvenance.phones).toEqual({ source: 'editor', confirmedAt: NOW_ISO });
        });
    });

    describe('case M4: never-seen + still-not-set stays absent', () => {
        it('does not create provenance entries for fields no one has ever touched', () => {
            const patch: BusinessProfile = { address: 'X' };

            const { merchantProvenance } = applyMerchantEdit(patch, undefined, NOW);

            expect(merchantProvenance.hours).toBeUndefined();
            expect(merchantProvenance.policies).toBeUndefined();
            expect(merchantProvenance.website).toBeUndefined();
        });
    });

    describe('case M5: cleared field stays cleared if PATCH still omits it', () => {
        it('refreshes the tombstone timestamp but keeps source=editor and value absent', () => {
            const existingProvenance: MerchantProvenanceMap = {
                phones: { source: 'editor', confirmedAt: '2026-05-01T10:00:00.000Z' },
            };
            const patch: BusinessProfile = {}; // PATCH still omits phones

            const { merchant, merchantProvenance } = applyMerchantEdit(patch, existingProvenance, NOW);

            expect(merchant.phones).toBeUndefined();
            expect(merchantProvenance.phones).toEqual({ source: 'editor', confirmedAt: NOW_ISO });
        });
    });

    describe('case M6: THE MES laundering regression (2026-08-08, «+971556087128»)', () => {
        // Prod page c75b6f33: FB sync promoted a stale UAE phone into merchant
        // as fb_sync/unconfirmed. The /business editor echoes the WHOLE
        // merchant half on every single-fact save; the old rule stamped the
        // echoed phone editor+confirmed, promoting it past the BUSINESS_INFO
        // authority gate and into customer replies. With existingMerchant
        // supplied, an unchanged ride-along field must keep its provenance.
        const existingMerchant: BusinessProfile = {
            address: 'Damascus Mazzah, Mazzah, Syria',
            phones: ['+971556087128'],
        };
        const existingProvenance: MerchantProvenanceMap = {
            address: { source: 'fb_sync', confirmedAt: null },
            phones: { source: 'fb_sync', confirmedAt: null },
        };

        it('does NOT confirm an unchanged fb_sync field that merely rode along in the echo', () => {
            // Merchant edits ONLY the address; phones echoed verbatim.
            const patch: BusinessProfile = {
                address: 'دمشق — أبو رمانة، مقابل موقف نورا',
                phones: ['+971556087128'],
            };
            const { merchantProvenance } = applyMerchantEdit(
                patch, existingProvenance, NOW, existingMerchant, ['address'],
            );

            expect(merchantProvenance.address).toEqual({ source: 'editor', confirmedAt: NOW_ISO });
            // The load-bearing assertion: the phone is STILL unconfirmed fb_sync.
            expect(merchantProvenance.phones).toEqual({ source: 'fb_sync', confirmedAt: null });
        });

        it('keeps the un-laundered phone OUT of the authoritative BUSINESS_INFO block', () => {
            const patch: BusinessProfile = {
                address: 'دمشق — أبو رمانة، مقابل موقف نورا',
                phones: ['+971556087128'],
            };
            const { merchant, merchantProvenance } = applyMerchantEdit(
                patch, existingProvenance, NOW, existingMerchant, ['address'],
            );
            const block = formatBusinessInfoPrompt(merchant, merchantProvenance);
            expect(block).not.toContain('+971556087128');
        });

        it('confirms the phone when the merchant explicitly reviews it (confirmFields)', () => {
            // Same echo, but the merchant opened the PHONE sheet and saved.
            const patch: BusinessProfile = { ...existingMerchant };
            const { merchantProvenance } = applyMerchantEdit(
                patch, existingProvenance, NOW, existingMerchant, ['phones'],
            );
            expect(merchantProvenance.phones).toEqual({ source: 'editor', confirmedAt: NOW_ISO });
            // Address still rode along unconfirmed.
            expect(merchantProvenance.address).toEqual({ source: 'fb_sync', confirmedAt: null });
        });

        it('confirms a field whose value actually CHANGED, without confirmFields', () => {
            const patch: BusinessProfile = {
                ...existingMerchant,
                phones: ['0955545600'],
            };
            const { merchantProvenance } = applyMerchantEdit(
                patch, existingProvenance, NOW, existingMerchant, [],
            );
            expect(merchantProvenance.phones).toEqual({ source: 'editor', confirmedAt: NOW_ISO });
        });
    });

    describe('case M7: value equality is structural, not referential or key-ordered', () => {
        it('treats a re-built hours object with identical content as unchanged', () => {
            const existingMerchant: BusinessProfile = {
                hours: { mon: ['09:00-21:00'], fri: ['10:00-21:00'] },
            };
            const existingProvenance: MerchantProvenanceMap = {
                hours: { source: 'fb_sync', confirmedAt: null },
            };
            // Same week, different key order and fresh objects.
            const patch: BusinessProfile = {
                hours: { fri: ['10:00-21:00'], mon: ['09:00-21:00'] },
            };
            const { merchantProvenance } = applyMerchantEdit(
                patch, existingProvenance, NOW, existingMerchant, [],
            );
            expect(merchantProvenance.hours).toEqual({ source: 'fb_sync', confirmedAt: null });
        });
    });

    describe('case M8: clears with existingMerchant supplied', () => {
        it('tombstones a field the merchant dropped from the patch', () => {
            const existingMerchant: BusinessProfile = { phones: ['+999'], address: 'X' };
            const existingProvenance: MerchantProvenanceMap = {
                phones: { source: 'fb_sync', confirmedAt: null },
                address: { source: 'editor', confirmedAt: '2026-05-01T10:00:00.000Z' },
            };
            const patch: BusinessProfile = { address: 'X' };
            const { merchantProvenance } = applyMerchantEdit(
                patch, existingProvenance, NOW, existingMerchant, [],
            );
            // Dropping a value IS a change → tombstone.
            expect(merchantProvenance.phones).toEqual({ source: 'editor', confirmedAt: NOW_ISO });
            // Unchanged ride-along keeps its old confirmation timestamp.
            expect(merchantProvenance.address).toEqual({ source: 'editor', confirmedAt: '2026-05-01T10:00:00.000Z' });
        });

        it('does NOT re-bump an existing tombstone the patch still omits', () => {
            const existingMerchant: BusinessProfile = {};
            const existingProvenance: MerchantProvenanceMap = {
                phones: { source: 'editor', confirmedAt: '2026-05-01T10:00:00.000Z' },
            };
            const patch: BusinessProfile = {};
            const { merchantProvenance } = applyMerchantEdit(
                patch, existingProvenance, NOW, existingMerchant, [],
            );
            expect(merchantProvenance.phones).toEqual({ source: 'editor', confirmedAt: '2026-05-01T10:00:00.000Z' });
        });
    });

    describe('round-trip: editor save then FB sync respects the merchant edit', () => {
        it('keeps editor-owned fields untouched on subsequent FB sync', () => {
            // Merchant saves a custom address
            const editorPatch: BusinessProfile = { address: 'merchant-custom-address' };
            const afterEdit = applyMerchantEdit(editorPatch, undefined, NOW);

            // FB sync runs later with different data
            const fbSuggestions: BusinessProfile = {
                address: 'FB-different-address',
                phones: ['+963937549674'],
            };
            const { merchant, merchantProvenance } = applyFbSyncToMerchant(
                afterEdit.merchant,
                afterEdit.merchantProvenance,
                fbSuggestions,
            );

            // Address stays editor-owned
            expect(merchant.address).toBe('merchant-custom-address');
            expect(merchantProvenance.address?.source).toBe('editor');
            // Phones gets populated as fb_sync (never seen before)
            expect(merchant.phones).toEqual(['+963937549674']);
            expect(merchantProvenance.phones).toEqual({ source: 'fb_sync', confirmedAt: null });
        });
    });
});

describe('hasTrackedField', () => {
    it('returns false for undefined / empty profile', () => {
        expect(hasTrackedField(undefined)).toBe(false);
        expect(hasTrackedField({})).toBe(false);
    });

    it('returns true when at least one tracked field is set', () => {
        expect(hasTrackedField({ address: 'X' })).toBe(true);
        expect(hasTrackedField({ phones: ['+1'] })).toBe(true);
    });

    it('returns false when only the deprecated `phone` (singular) is set — phone is intentionally untracked', () => {
        expect(hasTrackedField({ phone: '+1' } as BusinessProfile)).toBe(false);
    });
});

describe('classifyForMigration', () => {
    describe('idempotency', () => {
        it('skips rows that already have merchantProvenance set', () => {
            const stored: BusinessProfileContainer = {
                merchant: { address: 'X' },
                suggestions: { phones: ['+1'] },
                merchantProvenance: { address: { source: 'editor', confirmedAt: '2026-05-29T00:00:00.000Z' } },
            };
            const plan = classifyForMigration(stored);
            expect(plan.kind).toBe('skip');
            if (plan.kind === 'skip') expect(plan.reason).toBe('already_migrated');
        });
    });

    describe('promote_fb_sync (container with merchant={} + suggestions populated)', () => {
        it('promotes suggestions into merchant with fb_sync provenance', () => {
            const stored: BusinessProfileContainer = {
                merchant: {},
                suggestions: { address: 'البرامكة سانا', phones: ['+963'], name: 'Damascus' },
            };
            const plan = classifyForMigration(stored);
            expect(plan.kind).toBe('promote_fb_sync');
            if (plan.kind !== 'promote_fb_sync') return;
            expect(plan.newContainer.merchant?.address).toBe('البرامكة سانا');
            expect(plan.newContainer.merchant?.phones).toEqual(['+963']);
            expect(plan.newContainer.suggestions).toEqual(stored.suggestions);
            expect(plan.newContainer.merchantProvenance?.address).toEqual({ source: 'fb_sync', confirmedAt: null });
            expect(plan.promotedFields).toEqual(expect.arrayContaining(['address', 'phones', 'name']));
        });
    });

    describe('wrap_legacy (legacy flat shape with at least one tracked field)', () => {
        it('wraps the flat blob into a container and promotes into merchant', () => {
            const stored = { address: 'Riyadh', phones: ['+966'], name: 'Test' } as unknown as StoredBusinessProfile;
            const plan = classifyForMigration(stored);
            expect(plan.kind).toBe('wrap_legacy');
            if (plan.kind !== 'wrap_legacy') return;
            expect(plan.newContainer.merchant?.address).toBe('Riyadh');
            expect(plan.newContainer.suggestions?.address).toBe('Riyadh');
            expect(plan.newContainer.merchantProvenance?.address?.source).toBe('fb_sync');
        });
    });

    describe('backfill_editor (container with merchant already populated)', () => {
        it('preserves merchant values and marks them editor-owned', () => {
            const stored: BusinessProfileContainer = {
                merchant: { name: 'Editor-typed', address: 'Manual Address' },
                suggestions: { name: 'FB Biz', phones: ['+1'] },
            };
            const plan = classifyForMigration(stored);
            expect(plan.kind).toBe('backfill_editor');
            if (plan.kind !== 'backfill_editor') return;
            // Merchant values UNCHANGED
            expect(plan.newContainer.merchant?.name).toBe('Editor-typed');
            expect(plan.newContainer.merchant?.address).toBe('Manual Address');
            // Merchant did NOT acquire suggestion-only fields (phones)
            expect(plan.newContainer.merchant?.phones).toBeUndefined();
            // Provenance recorded for the two existing merchant fields
            expect(plan.newContainer.merchantProvenance?.name?.source).toBe('editor');
            expect(plan.newContainer.merchantProvenance?.address?.source).toBe('editor');
            expect(plan.newContainer.merchantProvenance?.phones).toBeUndefined();
            expect(plan.backfilledFields).toEqual(expect.arrayContaining(['name', 'address']));
        });
    });

    describe('skip — no signal data', () => {
        it('skips an empty container', () => {
            const plan = classifyForMigration({ merchant: {}, suggestions: {} });
            expect(plan.kind).toBe('skip');
            if (plan.kind === 'skip') expect(plan.reason).toBe('no_data');
        });

        it('skips null', () => {
            const plan = classifyForMigration(null);
            expect(plan.kind).toBe('skip');
        });
    });

    describe('double-encoded jsonb-string (prod state)', () => {
        it('handles the migrated-from-prod string form for the promote case', () => {
            const stored = JSON.stringify({
                merchant: {},
                suggestions: { address: 'البرامكة سانا', phones: ['+963'] },
            }) as unknown as StoredBusinessProfile;
            const plan = classifyForMigration(stored);
            expect(plan.kind).toBe('promote_fb_sync');
            if (plan.kind !== 'promote_fb_sync') return;
            expect(plan.newContainer.merchant?.address).toBe('البرامكة سانا');
        });

        it('handles the migrated-from-prod string form for legacy flat', () => {
            const stored = JSON.stringify({ address: 'Riyadh', phones: ['+966'] }) as unknown as StoredBusinessProfile;
            const plan = classifyForMigration(stored);
            expect(plan.kind).toBe('wrap_legacy');
        });
    });
});

describe('applyKbExtractToMerchant', () => {
    const extracted: BusinessProfile = {
        hours: { sat: ['09:00-20:00'], sun: ['09:00-20:00'], mon: ['09:00-20:00'], fri: ['closed'] },
        address: 'برامكة سانا فوق مكتبة الحافظ الطابق الاول مدينة دمشق',
    };

    it('fills empty (never-seen) fields and marks them kb_extract, confirmedAt: null', () => {
        const { merchant, merchantProvenance } = applyKbExtractToMerchant(undefined, undefined, extracted);

        expect(merchant.hours?.fri).toEqual(['closed']);
        expect(merchant.address).toBe(extracted.address);
        expect(merchantProvenance.hours).toEqual({ source: 'kb_extract', confirmedAt: null });
        expect(merchantProvenance.address).toEqual({ source: 'kb_extract', confirmedAt: null });
    });

    it('never overwrites an editor-owned field', () => {
        const existingMerchant: BusinessProfile = { address: 'merchant typed this' };
        const existingProvenance: MerchantProvenanceMap = {
            address: { source: 'editor', confirmedAt: '2026-06-01T00:00:00.000Z' },
        };
        const { merchant, merchantProvenance } = applyKbExtractToMerchant(existingMerchant, existingProvenance, extracted);

        expect(merchant.address).toBe('merchant typed this'); // unchanged
        expect(merchantProvenance.address).toEqual({ source: 'editor', confirmedAt: '2026-06-01T00:00:00.000Z' });
        // but a never-seen field (hours) still gets filled
        expect(merchant.hours?.fri).toEqual(['closed']);
        expect(merchantProvenance.hours).toEqual({ source: 'kb_extract', confirmedAt: null });
    });

    it('OVERWRITES an unconfirmed fb_sync value (KB is the source of truth — D-008: editor > kb_extract > fb_sync)', () => {
        const existingMerchant: BusinessProfile = { hours: { mon: ['10:00-18:00'] } };
        const existingProvenance: MerchantProvenanceMap = {
            hours: { source: 'fb_sync', confirmedAt: null },
        };
        const { merchant, merchantProvenance } = applyKbExtractToMerchant(existingMerchant, existingProvenance, extracted);

        // KB-extracted hours replace the unconfirmed FB hours (the reported prod bug).
        expect(merchant.hours?.fri).toEqual(['closed']);
        expect(merchant.hours?.mon).toEqual(['09:00-20:00']);
        expect(merchantProvenance.hours).toEqual({ source: 'kb_extract', confirmedAt: null });
    });

    it('OVERWRITES an unconfirmed editor value (confirmedAt:null = legacy auto-stamp / mislabeled FB), but keeps a CONFIRMED editor edit', () => {
        // Mirror of the prod page 39aeab89 state: FB hours mislabeled editor/confirmedAt:null.
        const unconfirmed = applyKbExtractToMerchant(
            { hours: { fri: ['00:00-23:45'], mon: ['08:00-20:00'] } },
            { hours: { source: 'editor', confirmedAt: null } },
            extracted,
        );
        expect(unconfirmed.merchant.hours?.fri).toEqual(['closed']); // KB wins
        expect(unconfirmed.merchantProvenance.hours).toEqual({ source: 'kb_extract', confirmedAt: null });

        // A genuine confirmed edit (confirmedAt set) is still protected.
        const confirmed = applyKbExtractToMerchant(
            { hours: { fri: ['10:00-22:00'] } },
            { hours: { source: 'editor', confirmedAt: '2026-06-01T00:00:00.000Z' } },
            extracted,
        );
        expect(confirmed.merchant.hours).toEqual({ fri: ['10:00-22:00'] }); // editor preserved
        expect(confirmed.merchantProvenance.hours).toEqual({ source: 'editor', confirmedAt: '2026-06-01T00:00:00.000Z' });
    });

    it('refreshes a previously kb_extract value (re-extraction after KB edit)', () => {
        const existingMerchant: BusinessProfile = { hours: { sat: ['08:00-19:00'] } };
        const existingProvenance: MerchantProvenanceMap = {
            hours: { source: 'kb_extract', confirmedAt: null },
        };
        const { merchant } = applyKbExtractToMerchant(existingMerchant, existingProvenance, extracted);

        expect(merchant.hours?.fri).toEqual(['closed']); // refreshed to the new extraction
    });

    it('overwrites legacy merchant data without provenance when the KB states the fact (KB is source of truth)', () => {
        // No provenance → normalizeLegacyProvenance stamps editor/confirmedAt:null
        // (unconfirmed). Since the KB explicitly carries the address, the KB value
        // wins. A field the KB does NOT mention is still preserved (rule 1).
        const existingMerchant: BusinessProfile = { address: 'legacy editor value', website: 'https://kept.example' };
        const { merchant, merchantProvenance } = applyKbExtractToMerchant(existingMerchant, undefined, extracted);
        expect(merchant.address).toBe(extracted.address);                       // KB wins over unconfirmed legacy
        expect(merchantProvenance.address).toEqual({ source: 'kb_extract', confirmedAt: null });
        expect(merchant.website).toBe('https://kept.example');                  // not in KB extract → preserved
    });
});

describe('applyStoreSyncToMerchant (D-102)', () => {
    // The synced facts a Salla store typically produces.
    const storeFacts: BusinessProfile = {
        phones: ['+966512223344'],
        channels: { whatsapp: '+966512223344' },
        hours: { sat: ['10:00-22:00'], fri: ['16:00-22:00'] },
        website: 'https://gulf-fashion.salla.sa',
    };

    it('populates a fresh page and stamps store_sync/confirmedAt:null on every field', () => {
        const { merchant, merchantProvenance } = applyStoreSyncToMerchant(undefined, undefined, storeFacts);
        expect(merchant.phones).toEqual(['+966512223344']);
        expect(merchant.channels).toEqual({ whatsapp: '+966512223344' });
        expect(merchant.hours?.fri).toEqual(['16:00-22:00']);
        expect(merchant.website).toBe('https://gulf-fashion.salla.sa');
        expect(merchantProvenance.phones).toEqual({ source: 'store_sync', confirmedAt: null });
        expect(merchantProvenance.channels).toEqual({ source: 'store_sync', confirmedAt: null });
    });

    it('never overwrites a CONFIRMED editor value (set)', () => {
        const existingMerchant: BusinessProfile = { phones: ['0501112222'] };
        const existingProvenance: MerchantProvenanceMap = {
            phones: { source: 'editor', confirmedAt: '2026-08-01T10:00:00.000Z' },
        };
        const { merchant, merchantProvenance } = applyStoreSyncToMerchant(existingMerchant, existingProvenance, storeFacts);
        expect(merchant.phones).toEqual(['0501112222']);
        expect(merchantProvenance.phones?.source).toBe('editor');
        // Non-editor fields still land.
        expect(merchant.website).toBe('https://gulf-fashion.salla.sa');
    });

    it('never resurrects a field the merchant explicitly CLEARED (editor tombstone)', () => {
        const existingProvenance: MerchantProvenanceMap = {
            phones: { source: 'editor', confirmedAt: '2026-08-01T10:00:00.000Z' },
        };
        const { merchant, merchantProvenance } = applyStoreSyncToMerchant({}, existingProvenance, storeFacts);
        expect(merchant.phones).toBeUndefined();
        expect(merchantProvenance.phones?.source).toBe('editor');
    });

    it('never overwrites a kb_extract value (KB prose outranks store fields, D-102)', () => {
        const existingMerchant: BusinessProfile = { hours: { sat: ['09:00-21:00'] } };
        const existingProvenance: MerchantProvenanceMap = {
            hours: { source: 'kb_extract', confirmedAt: null },
        };
        const { merchant, merchantProvenance } = applyStoreSyncToMerchant(existingMerchant, existingProvenance, storeFacts);
        expect(merchant.hours).toEqual({ sat: ['09:00-21:00'] });
        expect(merchantProvenance.hours?.source).toBe('kb_extract');
    });

    it('overwrites an fb_sync value (store_sync > fb_sync)', () => {
        const existingMerchant: BusinessProfile = { phones: ['+971556087128'] };
        const existingProvenance: MerchantProvenanceMap = {
            phones: { source: 'fb_sync', confirmedAt: null },
        };
        const { merchant, merchantProvenance } = applyStoreSyncToMerchant(existingMerchant, existingProvenance, storeFacts);
        expect(merchant.phones).toEqual(['+966512223344']);
        expect(merchantProvenance.phones).toEqual({ source: 'store_sync', confirmedAt: null });
    });

    it('refreshes its own previous value on re-sync', () => {
        const existingMerchant: BusinessProfile = { website: 'https://old.salla.sa' };
        const existingProvenance: MerchantProvenanceMap = {
            website: { source: 'store_sync', confirmedAt: null },
        };
        const { merchant } = applyStoreSyncToMerchant(existingMerchant, existingProvenance, storeFacts);
        expect(merchant.website).toBe('https://gulf-fashion.salla.sa');
    });

    it('leaves fields alone when the store stops reporting them (absence is not removal)', () => {
        const existingMerchant: BusinessProfile = { hours: { sat: ['10:00-22:00'] } };
        const existingProvenance: MerchantProvenanceMap = {
            hours: { source: 'store_sync', confirmedAt: null },
        };
        const { merchant } = applyStoreSyncToMerchant(existingMerchant, existingProvenance, { phones: ['+966512223344'] });
        expect(merchant.hours).toEqual({ sat: ['10:00-22:00'] });
    });

    it('overwrites an UNCONFIRMED legacy editor entry (normalizeLegacyProvenance mislabel)', () => {
        // No provenance → normalizeLegacyProvenance stamps editor/confirmedAt:null.
        // Same doctrine as applyKbExtractToMerchant: that state is never a real
        // save, so fresh store facts must not be shadowed by it.
        const existingMerchant: BusinessProfile = { phones: ['0500000000'], about: 'kept prose' };
        const { merchant, merchantProvenance } = applyStoreSyncToMerchant(existingMerchant, undefined, storeFacts);
        expect(merchant.phones).toEqual(['+966512223344']);
        expect(merchantProvenance.phones).toEqual({ source: 'store_sync', confirmedAt: null });
        expect(merchant.about).toBe('kept prose'); // not in store facts → preserved
    });

    it('does not mutate its inputs (purity)', () => {
        const existingMerchant: BusinessProfile = { phones: ['0501112222'] };
        const existingProvenance: MerchantProvenanceMap = {
            phones: { source: 'fb_sync', confirmedAt: null },
        };
        const merchantSnapshot = JSON.parse(JSON.stringify(existingMerchant));
        const provenanceSnapshot = JSON.parse(JSON.stringify(existingProvenance));
        applyStoreSyncToMerchant(existingMerchant, existingProvenance, storeFacts);
        expect(existingMerchant).toEqual(merchantSnapshot);
        expect(existingProvenance).toEqual(provenanceSnapshot);
    });
});

describe('fb_sync vs store_sync precedence (D-102)', () => {
    it('a later FB sync never clobbers a store_sync value', () => {
        const existingMerchant: BusinessProfile = { phones: ['+966512223344'] };
        const existingProvenance: MerchantProvenanceMap = {
            phones: { source: 'store_sync', confirmedAt: null },
        };
        const { merchant, merchantProvenance } = applyFbSyncToMerchant(
            existingMerchant, existingProvenance, damascusFbSuggestions,
        );
        expect(merchant.phones).toEqual(['+966512223344']);
        expect(merchantProvenance.phones?.source).toBe('store_sync');
        // A field store_sync does not own still refreshes from FB.
        expect(merchant.address).toBe(damascusFbSuggestions.address);
    });

    it('a later KB extraction DOES override a store_sync value (kb_extract > store_sync)', () => {
        const existingMerchant: BusinessProfile = { hours: { sat: ['10:00-22:00'] } };
        const existingProvenance: MerchantProvenanceMap = {
            hours: { source: 'store_sync', confirmedAt: null },
        };
        const { merchant, merchantProvenance } = applyKbExtractToMerchant(
            existingMerchant, existingProvenance, { hours: { sat: ['09:00-21:00'] } },
        );
        expect(merchant.hours).toEqual({ sat: ['09:00-21:00'] });
        expect(merchantProvenance.hours?.source).toBe('kb_extract');
    });
});
