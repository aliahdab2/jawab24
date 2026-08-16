import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pagesService, buildBusinessProfile, parseBusinessHours, detectLanguageHint } from '../../src/services/pages';
import { db } from '../../src/db';
import { facebookService } from '../../src/services/facebook';
import { instagramService } from '../../src/services/instagram';
import { config } from '../../src/config';
import { operationalFactsExtractor } from '../../src/services/kb/operationalFactsExtractor';
import type { FacebookPage } from '../../src/types';

vi.mock('../../src/db', () => ({
    db: {
        insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn() })) })),
        update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn() })) })) })),
        select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn() })) })) })),
        execute: vi.fn().mockResolvedValue([]),
    }
}));

vi.mock('../../src/services/facebook', () => ({
    facebookService: {
        getUserPages: vi.fn(),
        subscribePageToWebhooks: vi.fn().mockResolvedValue(true),
        setLogger: vi.fn(),
    }
}));

vi.mock('../../src/services/instagram', () => ({
    instagramService: {
        getLinkedInstagramAccount: vi.fn(),
    }
}));

vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        canEnablePage: vi.fn().mockResolvedValue({ allowed: true, remaining: null }),
    }
}));

vi.mock('../../src/services/channelTrial', () => ({
    channelTrialService: {
        channelsForPage: vi.fn(() => []),
        evaluate: vi.fn().mockResolvedValue({ blocked: false }),
        record: vi.fn().mockResolvedValue(undefined),
    }
}));

vi.mock('../../src/lib/redis', () => ({
    redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
    }
}));

vi.mock('../../src/services/kb/operationalFactsExtractor', () => ({
    operationalFactsExtractor: { extract: vi.fn().mockResolvedValue({}) },
}));

// Stub the fire-and-forget auto-reply audit emit so it doesn't add an extra
// db.insert(logs) call that would skew this suite's insert assertions.
vi.mock('../../src/services/auditLog', () => ({
    logAutoReplyToggle: vi.fn(),
    auditLog: vi.fn(),
}));

describe('PR2: KB Versioning + Business Profile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // =========================================
    // KB Version Bumping
    // =========================================
    describe('KB version bumping', () => {
        it('bumps kbVersion when knowledgeBase changes', async () => {
            let capturedSetData: any = null;
            vi.mocked(db.update).mockReturnValue({
                set: vi.fn().mockImplementation((data) => {
                    capturedSetData = data;
                    return {
                        where: vi.fn().mockReturnValue({
                            returning: vi.fn().mockResolvedValue([{ id: 'page-1', ...data }])
                        })
                    };
                })
            } as any);

            await pagesService.updatePage('user-1', 'page-1', { knowledgeBase: 'new KB text' });

            expect(capturedSetData).toBeDefined();
            // kbVersion should be a SQL expression (COALESCE + increment)
            expect(capturedSetData.kbVersion).toBeDefined();
            // kbUpdatedAt should be set
            expect(capturedSetData.kbUpdatedAt).toBeInstanceOf(Date);
            // updatedAt always set
            expect(capturedSetData.updatedAt).toBeInstanceOf(Date);
        });

        it('does NOT bump kbVersion for non-KB updates', async () => {
            let capturedSetData: any = null;
            vi.mocked(db.update).mockReturnValue({
                set: vi.fn().mockImplementation((data) => {
                    capturedSetData = data;
                    return {
                        where: vi.fn().mockReturnValue({
                            returning: vi.fn().mockResolvedValue([{ id: 'page-1', ...data }])
                        })
                    };
                })
            } as any);

            await pagesService.updatePage('user-1', 'page-1', { name: 'New Name' });

            expect(capturedSetData).toBeDefined();
            expect(capturedSetData.kbVersion).toBeUndefined();
            expect(capturedSetData.kbUpdatedAt).toBeUndefined();
            expect(capturedSetData.name).toBe('New Name');
        });

        it('does NOT change kbActiveVersion on KB update', async () => {
            let capturedSetData: any = null;
            vi.mocked(db.update).mockReturnValue({
                set: vi.fn().mockImplementation((data) => {
                    capturedSetData = data;
                    return {
                        where: vi.fn().mockReturnValue({
                            returning: vi.fn().mockResolvedValue([{ id: 'page-1', ...data }])
                        })
                    };
                })
            } as any);

            await pagesService.updatePage('user-1', 'page-1', { knowledgeBase: 'updated text' });

            expect(capturedSetData).toBeDefined();
            // kbActiveVersion must NOT be in the set data
            expect(capturedSetData.kbActiveVersion).toBeUndefined();
        });

        it('ignores smuggled non-DTO columns (mass-assignment pin)', async () => {
            // PUT /pages/:id registers no body schema, so updatePage's .set()
            // payload is the only guard between a crafted body and the row.
            // Before the explicit allowlist, ...spread let an admin-role caller
            // rewrite ANY column of a page they own. This pins the allowlist:
            // break it (restore the spread) and this test fails.
            let capturedSetData: any = null;
            vi.mocked(db.update).mockReturnValue({
                set: vi.fn().mockImplementation((data) => {
                    capturedSetData = data;
                    return {
                        where: vi.fn().mockReturnValue({
                            returning: vi.fn().mockResolvedValue([{ id: 'page-1', ...data }])
                        })
                    };
                })
            } as any);

            await pagesService.updatePage('user-1', 'page-1', {
                name: 'Legit Name',
                // Hostile extras a real request body can carry:
                workspaceId: 'attacker-workspace',
                userId: 'attacker-user',
                accessToken2: 'x', // typo-shaped noise
                kbActiveVersion: 999,
                whatsappAccessToken: 'stolen',
                facebookPageId: 'hijacked',
            } as never);

            expect(capturedSetData).toBeDefined();
            expect(capturedSetData.name).toBe('Legit Name');
            expect(capturedSetData.workspaceId).toBeUndefined();
            expect(capturedSetData.userId).toBeUndefined();
            expect(capturedSetData.accessToken2).toBeUndefined();
            expect(capturedSetData.kbActiveVersion).toBeUndefined();
            expect(capturedSetData.whatsappAccessToken).toBeUndefined();
            expect(capturedSetData.facebookPageId).toBeUndefined();
        });

        it('sets businessProfileUpdatedAt when businessProfile changes', async () => {
            // Stage 2.6: updatePage fetches existing row to preserve the
            // suggestions half of the container — mock the select call.
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([
                            { businessProfile: { merchant: {}, suggestions: { name: 'FB Name' } } }
                        ])
                    })
                })
            } as any);

            let capturedSetData: any = null;
            vi.mocked(db.update).mockReturnValue({
                set: vi.fn().mockImplementation((data) => {
                    capturedSetData = data;
                    return {
                        where: vi.fn().mockReturnValue({
                            returning: vi.fn().mockResolvedValue([{ id: 'page-1', ...data }])
                        })
                    };
                })
            } as any);

            await pagesService.updatePage('user-1', 'page-1', {
                businessProfile: { name: 'Test', category: 'Restaurant' }
            });

            expect(capturedSetData).toBeDefined();
            expect(capturedSetData.businessProfileUpdatedAt).toBeInstanceOf(Date);
            // Merchant content from PATCH body lands under .merchant; existing
            // suggestions survive.
            expect(capturedSetData.businessProfile.merchant).toEqual({ name: 'Test', category: 'Restaurant' });
            expect(capturedSetData.businessProfile.suggestions).toEqual({ name: 'FB Name' });
        });

        // Stage 2.6.1 (Option B) — editor-provenance integration test, updated
        // for PR #675 (the fb_sync-laundering fix). Locks in the wiring at
        // pages.ts:updatePage that the shared-package unit tests can't reach.
        // The arrange below — fb_sync-owned phones echoed back VERBATIM by the
        // full-replace save — is the exact laundering shape that promoted a
        // stale Facebook-synced UAE phone into MES's customer replies on
        // 2026-08-08. The old contract here ("every field in the PATCH gets
        // editor+confirmedAt") was that bug stated as an expectation; the new
        // contract: an unchanged echoed field KEEPS its provenance, a field
        // named in businessProfileConfirmFields is confirmed even when
        // unchanged, and a field absent from the PATCH is still tombstoned.
        it('carries fb_sync provenance through an unchanged echo, confirms confirmFields, tombstones cleared fields', async () => {
            // Existing container: phones is fb_sync-owned and present; address is
            // editor-owned from a prior save. Merchant currently has both fields.
            const priorEditorTime = '2026-05-01T10:00:00.000Z';
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([
                            {
                                businessProfile: {
                                    merchant: { phones: ['+1'], address: 'old-address' },
                                    suggestions: { phones: ['+1'] },
                                    merchantProvenance: {
                                        phones: { source: 'fb_sync', confirmedAt: null },
                                        address: { source: 'editor', confirmedAt: priorEditorTime },
                                    },
                                },
                            },
                        ]),
                    }),
                }),
            } as any);

            let capturedSetData: any = null;
            vi.mocked(db.update).mockReturnValue({
                set: vi.fn().mockImplementation((data) => {
                    capturedSetData = data;
                    return {
                        where: vi.fn().mockReturnValue({
                            returning: vi.fn().mockResolvedValue([{ id: 'page-1', ...data }]),
                        }),
                    };
                }),
            } as any);

            // Merchant edits ONE unrelated thing: phones ride along UNCHANGED
            // in the echo (no businessProfileConfirmFields), address is CLEARED
            // (omitted from PATCH).
            await pagesService.updatePage('user-1', 'page-1', {
                businessProfile: { phones: ['+1'] },
            });

            const prov = capturedSetData.businessProfile.merchantProvenance;
            expect(prov).toBeDefined();

            // phones: unchanged echo, not explicitly confirmed → provenance
            // carried forward UNTOUCHED. Stamping 'editor' here is the MES bug.
            expect(prov.phones.source).toBe('fb_sync');
            expect(prov.phones.confirmedAt).toBe(null);

            // address: absent from PATCH but present in prior provenance → cleared
            // tombstone (still editor, fresh timestamp, value gone from merchant)
            expect(prov.address.source).toBe('editor');
            expect(prov.address.confirmedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            expect(prov.address.confirmedAt).not.toBe(priorEditorTime); // bumped
            expect(capturedSetData.businessProfile.merchant.address).toBeUndefined();

            // Existing suggestions survive untouched (FB-sync half is editor-write-immune)
            expect(capturedSetData.businessProfile.suggestions).toEqual({ phones: ['+1'] });

            // Same unchanged echo, but the merchant OPENED the phone sheet and
            // saved: businessProfileConfirmFields names it → explicit
            // confirmation, editor + fresh timestamp.
            await pagesService.updatePage('user-1', 'page-1', {
                businessProfile: { phones: ['+1'] },
                businessProfileConfirmFields: ['phones'],
            });
            const prov2 = capturedSetData.businessProfile.merchantProvenance;
            expect(prov2.phones.source).toBe('editor');
            expect(prov2.phones.confirmedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        });
    });

    // =========================================
    // buildBusinessProfile
    // =========================================
    describe('buildBusinessProfile', () => {
        it('builds full profile from complete Facebook page', () => {
            const fbPage: FacebookPage = {
                id: 'fb-1',
                name: 'Pizza House',
                access_token: 'token',
                category: 'Restaurant',
                about: 'Best pizza in Dubai',
                phone: '0591234567',
                single_line_address: 'Dubai, UAE',
                website: 'https://pizza.com',
                hours: {
                    mon_1_open: '09:00', mon_1_close: '22:00',
                    tue_1_open: '09:00', tue_1_close: '22:00',
                },
            };

            const profile = buildBusinessProfile(fbPage);

            expect(profile.name).toBe('Pizza House');
            expect(profile.category).toBe('Restaurant');
            expect(profile.about).toBe('Best pizza in Dubai');
            // Stage 2.6: FB-sourced phone is coerced into the canonical phones[] array.
            expect(profile.phones).toEqual(['0591234567']);
            expect(profile.phone).toBeUndefined();
            expect(profile.address).toBe('Dubai, UAE');
            expect(profile.website).toBe('https://pizza.com');
            expect(profile.hours).toEqual({
                mon: ['09:00-22:00'],
                tue: ['09:00-22:00'],
            });
            expect(profile.language_hint).toBe('en');
        });

        it('handles partial Facebook data without crashing', () => {
            const fbPage: FacebookPage = {
                id: 'fb-2',
                name: 'Minimal Page',
                access_token: 'token',
            };

            const profile = buildBusinessProfile(fbPage);

            expect(profile).toBeDefined();
            expect(typeof profile).toBe('object');
            expect(profile.name).toBe('Minimal Page');
            expect(profile.phones).toBeUndefined();
            expect(profile.address).toBeUndefined();
            expect(profile.hours).toBeUndefined();
            expect(profile.about).toBeUndefined();
            expect(profile.website).toBeUndefined();
        });

        it('handles page with only name + category', () => {
            const fbPage: FacebookPage = {
                id: 'fb-3',
                name: 'محل ورد',
                access_token: 'token',
                category: 'Florist',
            };

            const profile = buildBusinessProfile(fbPage);

            expect(profile.name).toBe('محل ورد');
            expect(profile.category).toBe('Florist');
            expect(profile.language_hint).toBe('ar');
        });

        it('detects Arabic language hint from about field', () => {
            const fbPage: FacebookPage = {
                id: 'fb-4',
                name: 'My Store',
                access_token: 'token',
                about: 'متجر متخصص في بيع الملابس العربية الأصيلة',
            };

            const profile = buildBusinessProfile(fbPage);

            expect(profile.language_hint).toBe('ar');
        });
    });

    // =========================================
    // parseBusinessHours
    // =========================================
    describe('parseBusinessHours', () => {
        it('parses Facebook hours to structured format', () => {
            const hours = {
                mon_1_open: '09:00', mon_1_close: '18:00',
                tue_1_open: '10:00', tue_1_close: '20:00',
            };

            const result = parseBusinessHours(hours);

            expect(result).toEqual({
                mon: ['09:00-18:00'],
                tue: ['10:00-20:00'],
            });
        });

        it('handles multiple slots per day', () => {
            const hours = {
                fri_1_open: '09:00', fri_1_close: '12:00',
                fri_2_open: '16:00', fri_2_close: '22:00',
            };

            const result = parseBusinessHours(hours);

            expect(result).toEqual({
                fri: ['09:00-12:00', '16:00-22:00'],
            });
        });

        it('returns undefined for undefined input', () => {
            expect(parseBusinessHours(undefined)).toBeUndefined();
        });

        it('returns undefined for empty hours object', () => {
            expect(parseBusinessHours({})).toBeUndefined();
        });

        it('handles all 7 days', () => {
            const hours: Record<string, string> = {};
            const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
            for (const day of days) {
                hours[`${day}_1_open`] = '08:00';
                hours[`${day}_1_close`] = '20:00';
            }

            const result = parseBusinessHours(hours);

            expect(result).toBeDefined();
            expect(Object.keys(result!)).toHaveLength(7);
            for (const day of days) {
                expect(result![day]).toEqual(['08:00-20:00']);
            }
        });
    });

    // =========================================
    // detectLanguageHint
    // =========================================
    describe('detectLanguageHint', () => {
        it('returns "ar" for Arabic text', () => {
            expect(detectLanguageHint('مطعم البيتزا الشهي')).toBe('ar');
        });

        it('returns "en" for English text', () => {
            expect(detectLanguageHint('Pizza House Restaurant')).toBe('en');
        });

        it('returns "ar" for mixed text with >30% Arabic', () => {
            expect(detectLanguageHint('محل Flowers ورد')).toBe('ar');
        });

        it('returns "en" for mostly English with few Arabic chars', () => {
            expect(detectLanguageHint('Best Pizza House in Town مطعم')).toBe('en');
        });

        it('handles empty string', () => {
            // empty string → 0/1 = 0 which is < 0.3, so 'en'
            expect(detectLanguageHint('')).toBe('en');
        });
    });

    // =========================================
    // syncFromFacebook populates businessProfile
    // =========================================
    describe('syncFromFacebook populates businessProfile', () => {
        it('sets businessProfile on new page creation', async () => {
            vi.mocked(facebookService.getUserPages).mockResolvedValue({
                data: [{
                    id: 'fb-page-1',
                    name: 'Test Business',
                    access_token: 'pt-1',
                    category: 'Restaurant',
                    about: 'We are a test restaurant',
                    phone: '0501234567',
                    single_line_address: 'Riyadh, Saudi Arabia',
                }]
            });

            // No existing pages
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) })
                    })
                })
            } as any);

            vi.mocked(instagramService.getLinkedInstagramAccount).mockResolvedValue(null);

            let insertedValues: any = null;
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockImplementation((values) => {
                    insertedValues = values;
                    return {
                        returning: vi.fn().mockResolvedValue([{ id: 'new-id', ...values }])
                    };
                })
            } as any);

            await pagesService.syncFromFacebook('user-1', 'token');

            expect(insertedValues).toBeDefined();
            expect(insertedValues.businessProfile).toBeDefined();
            // Stage 2.6.1 (Option B): FB sync auto-promotes suggestions into
            // merchant with per-field provenance. Suggestions still holds the
            // raw FB snapshot for the editor "Review & Confirm" UI.
            expect(insertedValues.businessProfile.merchant.name).toBe('Test Business');
            expect(insertedValues.businessProfile.merchant.phones).toEqual(['0501234567']);
            expect(insertedValues.businessProfile.merchant.address).toBe('Riyadh, Saudi Arabia');
            expect(insertedValues.businessProfile.suggestions.name).toBe('Test Business');
            expect(insertedValues.businessProfile.suggestions.phones).toEqual(['0501234567']);
            // Provenance: every promoted field is fb_sync + confirmedAt null
            // (merchant hasn't reviewed yet).
            expect(insertedValues.businessProfile.merchantProvenance.name).toEqual({ source: 'fb_sync', confirmedAt: null });
            expect(insertedValues.businessProfile.merchantProvenance.phones).toEqual({ source: 'fb_sync', confirmedAt: null });
            expect(insertedValues.businessProfile.merchantProvenance.address).toEqual({ source: 'fb_sync', confirmedAt: null });
            expect(insertedValues.businessProfileUpdatedAt).toBeInstanceOf(Date);
        });

        it('updates businessProfile on existing page sync', async () => {
            vi.mocked(facebookService.getUserPages).mockResolvedValue({
                data: [{
                    id: 'fb-page-1',
                    name: 'Updated Business',
                    access_token: 'pt-new',
                    phone: '0509999999',
                }]
            });

            // Existing page
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([
                            { id: 'p1', facebookPageId: 'fb-page-1', name: 'Old Business' }
                        ]) })
                    })
                })
            } as any);

            vi.mocked(instagramService.getLinkedInstagramAccount).mockResolvedValue(null);

            let capturedSetData: any = null;
            vi.mocked(db.update).mockReturnValue({
                set: vi.fn().mockImplementation((data) => {
                    capturedSetData = data;
                    return {
                        where: vi.fn().mockReturnValue({
                            returning: vi.fn().mockResolvedValue([{ id: 'p1', ...data }])
                        })
                    };
                })
            } as any);

            await pagesService.syncFromFacebook('user-1', 'token');

            expect(capturedSetData).toBeDefined();
            expect(capturedSetData.businessProfile).toBeDefined();
            // Stage 2.6.1 (Option B): FB sync refreshes both halves.
            // Existing page had no merchantProvenance → fields are never-seen
            // and get auto-promoted into merchant on this sync.
            expect(capturedSetData.businessProfile.merchant.name).toBe('Updated Business');
            expect(capturedSetData.businessProfile.merchant.phones).toEqual(['0509999999']);
            expect(capturedSetData.businessProfile.suggestions.name).toBe('Updated Business');
            expect(capturedSetData.businessProfile.suggestions.phones).toEqual(['0509999999']);
            expect(capturedSetData.businessProfile.merchantProvenance.name).toEqual({ source: 'fb_sync', confirmedAt: null });
            expect(capturedSetData.businessProfile.merchantProvenance.phones).toEqual({ source: 'fb_sync', confirmedAt: null });
            expect(capturedSetData.businessProfileUpdatedAt).toBeInstanceOf(Date);
        });

        it('handles Facebook page with no business info — businessProfile still valid', async () => {
            vi.mocked(facebookService.getUserPages).mockResolvedValue({
                data: [{
                    id: 'fb-page-1',
                    name: 'Bare Page',
                    access_token: 'pt-1',
                }]
            });

            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) })
                    })
                })
            } as any);

            vi.mocked(instagramService.getLinkedInstagramAccount).mockResolvedValue(null);

            let insertedValues: any = null;
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockImplementation((values) => {
                    insertedValues = values;
                    return {
                        returning: vi.fn().mockResolvedValue([{ id: 'new-id', ...values }])
                    };
                })
            } as any);

            await pagesService.syncFromFacebook('user-1', 'token');

            expect(insertedValues).toBeDefined();
            expect(insertedValues.businessProfile).toBeDefined();
            expect(typeof insertedValues.businessProfile).toBe('object');
            // Stage 2.6.1: only `name` was returned by FB; it gets promoted
            // into merchant and recorded in provenance. Other fields stay
            // absent in both halves and have no provenance entry.
            expect(insertedValues.businessProfile.merchant.name).toBe('Bare Page');
            expect(insertedValues.businessProfile.merchant.phones).toBeUndefined();
            expect(insertedValues.businessProfile.merchant.address).toBeUndefined();
            expect(insertedValues.businessProfile.suggestions.name).toBe('Bare Page');
            expect(insertedValues.businessProfile.suggestions.phones).toBeUndefined();
            expect(insertedValues.businessProfile.merchantProvenance.name).toEqual({ source: 'fb_sync', confirmedAt: null });
            expect(insertedValues.businessProfile.merchantProvenance.phones).toBeUndefined();
            expect(insertedValues.businessProfile.merchantProvenance.address).toBeUndefined();
        });
    });

    // =========================================
    // On-save operational-facts extraction (KB_OPFACTS_EXTRACT flag)
    // =========================================
    describe('on-save operational-facts extraction', () => {
        afterEach(() => {
            config.opFactsExtract = 'off';
        });

        // Helper: capture every db.update().set(...) payload (the main KB-version
        // write AND any extraction write), with a userId-bearing returning() so
        // maybeExtractOperationalFacts doesn't early-return on a null userId.
        function captureUpdates(): any[] {
            const calls: any[] = [];
            vi.mocked(db.update).mockReturnValue({
                set: vi.fn().mockImplementation((data) => {
                    calls.push(data);
                    return {
                        where: vi.fn().mockReturnValue({
                            returning: vi.fn().mockResolvedValue([{ id: 'page-1', userId: 'user-1', kbVersion: 1, ...data }]),
                        }),
                    };
                }),
            } as any);
            return calls;
        }

        function mockExistingContainer(container: unknown) {
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([{ businessProfile: container }]),
                    }),
                }),
            } as any);
        }

        it('does NOT call the extractor when the flag is off (default)', async () => {
            config.opFactsExtract = 'off';
            captureUpdates();

            await pagesService.updatePage('user-1', 'page-1', { knowledgeBase: 'دوامنا من ٩ صباحاً' });
            await new Promise(r => setTimeout(r, 0)); // flush the fire-and-forget microtask

            expect(operationalFactsExtractor.extract).not.toHaveBeenCalled();
        });

        it('shadow mode extracts but writes NO business_profile', async () => {
            config.opFactsExtract = 'shadow';
            vi.mocked(operationalFactsExtractor.extract).mockResolvedValue({ hours: { fri: ['closed'] } });
            mockExistingContainer({ merchant: {}, suggestions: {}, merchantProvenance: {} });
            const updates = captureUpdates();

            await pagesService.updatePage('user-1', 'page-1', { knowledgeBase: 'مغلق الجمعة' });
            await vi.waitFor(() => expect(operationalFactsExtractor.extract).toHaveBeenCalledTimes(1));

            // Only the main KB-version write happened; no write carried businessProfile.
            expect(updates.some(u => u.businessProfile !== undefined)).toBe(false);
        });

        it('on mode persists extracted facts as kb_extract WITHOUT bumping kbActiveVersion', async () => {
            config.opFactsExtract = 'on';
            vi.mocked(operationalFactsExtractor.extract).mockResolvedValue({
                hours: { fri: ['closed'] },
                phones: ['0112345678'],
            });
            mockExistingContainer({ merchant: {}, suggestions: {}, merchantProvenance: {} });
            const updates = captureUpdates();

            await pagesService.updatePage('user-1', 'page-1', { knowledgeBase: 'مغلق الجمعة، الهاتف 0112345678' });
            await vi.waitFor(() => expect(updates.some(u => u.businessProfile !== undefined)).toBe(true));

            const write = updates.find(u => u.businessProfile !== undefined)!;
            expect(write.businessProfile.merchant.hours).toEqual({ fri: ['closed'] });
            expect(write.businessProfile.merchant.phones).toEqual(['0112345678']);
            // kb_extract provenance — authoritative in the block. Overwrites fb_sync and
            // unconfirmed editor (D-008/D-010); only a CONFIRMED editor edit is protected.
            expect(write.businessProfile.merchantProvenance.hours).toEqual({ source: 'kb_extract', confirmedAt: null });
            expect(write.businessProfile.merchantProvenance.phones).toEqual({ source: 'kb_extract', confirmedAt: null });
            expect(write.businessProfileUpdatedAt).toBeInstanceOf(Date);
            // MUST NOT bump kbActiveVersion: retrieval filters chunks by exact
            // kb_version=kbActiveVersion, and the co-firing KB ingestion activates
            // it last. A bump here could orphan the freshly-ingested chunks.
            expect(write.kbActiveVersion).toBeUndefined();
        });

        it('on mode is fill-only-empty — never clobbers an editor-owned field', async () => {
            config.opFactsExtract = 'on';
            // Merchant already confirmed an address via the editor; extractor finds a
            // different one in the KB. The editor value must win.
            vi.mocked(operationalFactsExtractor.extract).mockResolvedValue({
                address: 'extracted-from-kb',
                hours: { fri: ['closed'] },
            });
            mockExistingContainer({
                merchant: { address: 'editor-confirmed-address' },
                suggestions: {},
                merchantProvenance: { address: { source: 'editor', confirmedAt: '2026-05-01T00:00:00.000Z' } },
            });
            const updates = captureUpdates();

            await pagesService.updatePage('user-1', 'page-1', { knowledgeBase: 'مغلق الجمعة، العنوان الجديد' });
            await vi.waitFor(() => expect(updates.some(u => u.businessProfile !== undefined)).toBe(true));

            const write = updates.find(u => u.businessProfile !== undefined)!;
            // Editor address preserved; only the empty `hours` field filled from KB.
            expect(write.businessProfile.merchant.address).toBe('editor-confirmed-address');
            expect(write.businessProfile.merchantProvenance.address.source).toBe('editor');
            expect(write.businessProfile.merchant.hours).toEqual({ fri: ['closed'] });
            expect(write.businessProfile.merchantProvenance.hours.source).toBe('kb_extract');
        });
    });
});
