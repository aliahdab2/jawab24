import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pagesService } from '../../src/services/pages';
import { db } from '../../src/db';
import { facebookService } from '../../src/services/facebook';
import { instagramService } from '../../src/services/instagram';
import { channelTrialService } from '../../src/services/channelTrial';
import { auditLog } from '../../src/services/auditLog';
import {
    comments as commentsTable,
    instagramComments as instagramCommentsTable,
    messages as messagesTable,
    posts as postsTable,
    instagramMedia as instagramMediaTable,
    ecommerceStores as ecommerceStoresTable,
} from '../../src/db/schema';

vi.mock('../../src/db', () => {
    const db: Record<string, unknown> = {
        insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn() })) })),
        update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn() })) })) })),
        select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn() })) })) })),
        execute: vi.fn().mockResolvedValue([]),
    };
    // The transaction handle IS the mocked db, so a test's select/update mocks
    // apply identically inside and outside a transaction.
    db.transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(db));
    return { db };
});

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

// The audit emit is a fire-and-forget side effect (verified in auditLog.test.ts
// and pages.controller.test.ts). Stub it here so it doesn't add extra db.insert
// calls that would skew this suite's insert-count / captured-values assertions.
vi.mock('../../src/services/auditLog', () => ({
    logAutoReplyToggle: vi.fn(),
    auditLog: vi.fn(),
}));

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn().mockResolvedValue('OK');
// `del`: the token-restore paths release the reconnect-alert dedup claims
// (pageTokenRecovery.clearReconnectAlertClaims) fire-and-forget.
const mockRedisDel = vi.fn().mockResolvedValue(1);
vi.mock('../../src/lib/redis', () => ({
    redis: {
        get: (...args: unknown[]) => mockRedisGet(...args),
        set: (...args: unknown[]) => mockRedisSet(...args),
        del: (...args: unknown[]) => mockRedisDel(...args),
    },
}));

describe('PagesService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // clearAllMocks() wipes call history but NOT queued mockReturnValueOnce
        // values or a persisted mockImplementation. Several tests queue an exact
        // sequence of db.select() chains; if one of them consumes fewer than it
        // queued (which is what a regression looks like), the leftovers would
        // leak into the next test and fail it for the wrong reason. Restore the
        // module-factory defaults so every test starts from a clean chain.
        vi.mocked(db.select).mockReset().mockImplementation((() => ({
            from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn() })) })),
        })) as any);
        vi.mocked(db.update).mockReset().mockImplementation((() => ({
            set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn() })) })),
        })) as any);
        vi.mocked(db.insert).mockReset().mockImplementation((() => ({
            values: vi.fn(() => ({ returning: vi.fn() })),
        })) as any);
    });

    describe('syncFromFacebook', () => {
        it('should sync pages efficiently (parallel API calls)', async () => {
            const workspaceId = 'workspace-123';
            const userId = 'user-123';
            const accessToken = 'token-123';

            // Mock Facebook API response with 2 pages
            vi.mocked(facebookService.getUserPages).mockResolvedValue({
                data: [
                    { id: 'fb-page-1', name: 'Page 1', access_token: 'pt-1' },
                    { id: 'fb-page-2', name: 'Page 2', access_token: 'pt-2' }
                ]
            });

            // Mock existing pages (Empty initially)
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) })
                    })
                })
            } as any);

            // Mock Instagram checks
            vi.mocked(instagramService.getLinkedInstagramAccount)
                .mockResolvedValueOnce({ id: 'ig-1', username: 'ig_user_1', profile_picture_url: 'https://example.com/ig-pic.jpg' } as any)
                .mockResolvedValueOnce(null);

            // Mock DB Insert
            const mockInsertReturn = vi.fn().mockReturnValue(['new-page']);
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: mockInsertReturn
                })
            } as any);

            await pagesService.syncFromFacebook(workspaceId, userId, accessToken);

            // Verify Facebook API called once
            expect(facebookService.getUserPages).toHaveBeenCalledWith(accessToken);

            // Verify Instagram API called twice (in parallel)
            expect(instagramService.getLinkedInstagramAccount).toHaveBeenCalledTimes(2);

            // Verify DB inserts occurred (Sequential logic verification is hard to strictly prove in unit test without spying on iteration order, but we confirm calls happen)
            expect(db.insert).toHaveBeenCalledTimes(2);
        });

        it('should update existing pages instead of creating new ones', async () => {
             const workspaceId = 'workspace-123';
             const userId = 'user-123';
             const accessToken = 'token-123';
 
             // Mock Facebook API response
             vi.mocked(facebookService.getUserPages).mockResolvedValue({
                 data: [
                     { id: 'fb-page-1', name: 'Page 1 Renamed', access_token: 'pt-1-new' }
                 ]
             });
 
             // Mock existing page
             const existingPage = { id: 'p1', facebookPageId: 'fb-page-1', name: 'Page 1', accessToken: 'pt-1' };
             vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([existingPage]) })
                    })
                })
            } as any);
 
             // Mock DB Update
             const mockUpdateReturn = vi.fn().mockReturnValue(['updated-page']);
             vi.mocked(db.update).mockReturnValue({
                 set: vi.fn().mockReturnValue({
                     where: vi.fn().mockReturnValue({
                         returning: mockUpdateReturn
                     })
                 })
             } as any);
 
             await pagesService.syncFromFacebook(workspaceId, userId, accessToken);

             // Verify Update called
             expect(db.update).toHaveBeenCalled();
             expect(db.insert).not.toHaveBeenCalled();
        });

        it('should save Facebook business info to suggestedKnowledgeBase (not knowledgeBase)', async () => {
            const workspaceId = 'workspace-123';
            const userId = 'user-123';
            const accessToken = 'token-123';

            // Mock Facebook API response with business info
            vi.mocked(facebookService.getUserPages).mockResolvedValue({
                data: [
                    { 
                        id: 'fb-page-1', 
                        name: 'Test Business', 
                        access_token: 'pt-1',
                        about: 'We are a test business',
                        phone: '0501234567',
                        single_line_address: 'Riyadh, Saudi Arabia',
                        website: 'https://test.com',
                        hours: { mon_1_open: '09:00', mon_1_close: '18:00' }
                    }
                ]
            });

            // Mock no existing pages
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) })
                    })
                })
            } as any);

            // Mock Instagram (no linked account)
            vi.mocked(instagramService.getLinkedInstagramAccount).mockResolvedValue(null);

            // Capture what's inserted
            let insertedValues: any = null;
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockImplementation((values) => {
                    insertedValues = values;
                    return {
                        returning: vi.fn().mockResolvedValue([{ id: 'new-page-id', ...values }])
                    };
                })
            } as any);

            await pagesService.syncFromFacebook(workspaceId, userId, accessToken);

            // Verify suggestedKnowledgeBase is set (not knowledgeBase)
            expect(insertedValues).toBeDefined();
            expect(insertedValues.suggestedKnowledgeBase).toBeDefined();
            // Should contain the about text
            expect(insertedValues.suggestedKnowledgeBase).toContain('We are a test business');
            // Should contain phone number
            expect(insertedValues.suggestedKnowledgeBase).toContain('0501234567');
            // Should contain address
            expect(insertedValues.suggestedKnowledgeBase).toContain('Riyadh');

            // knowledgeBase should be auto-applied from Facebook data
            expect(insertedValues.knowledgeBase).toBe(insertedValues.suggestedKnowledgeBase);
        });

        // Anti free-trial-abuse: when the channel-trial gate reports a page's
        // channel already consumed its free trial under another account, the page
        // is still connected but auto-reply must stay OFF, it must NOT be claimed
        // again, and the result must surface trialBlockedCount/trialBlockedPages so
        // the client can prompt the user to subscribe.
        it('connects a trial-blocked page with auto-reply OFF and reports it', async () => {
            const workspaceId = 'workspace-123';
            const userId = 'user-123';
            const accessToken = 'token-123';

            vi.mocked(facebookService.getUserPages).mockResolvedValue({
                data: [{ id: 'fb-page-1', name: 'Reused Business', access_token: 'pt-1' }],
            });

            // No existing pages in this workspace; globalResults resolves to a
            // non-array object → globalExisting undefined → brand-new insert path.
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
                    }),
                }),
            } as any);

            vi.mocked(instagramService.getLinkedInstagramAccount).mockResolvedValue(null);

            // The channel already used its free trial under another, non-paying account.
            vi.mocked(channelTrialService.evaluate).mockResolvedValueOnce({ blocked: true });

            let insertedValues: any = null;
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockImplementation((values) => {
                    insertedValues = values;
                    return { returning: vi.fn().mockResolvedValue([{ id: 'new-page-id', ...values }]) };
                }),
            } as any);

            const result = await pagesService.syncFromFacebook(workspaceId, userId, accessToken);

            // Page connected but auto-reply OFF
            expect(insertedValues).toBeDefined();
            expect(insertedValues.autoReplyEnabled).toBe(false);
            // System disable carries its reason so the comment pipeline ingests
            // (but never answers) this page's comments and admin can diagnose it
            expect(insertedValues.autoReplyDisabledReason).toBe('trial_block');
            // Reported so the UI can prompt a subscribe
            expect(result.trialBlockedCount).toBe(1);
            expect(result.trialBlockedPages).toEqual([{ pageName: 'Reused Business' }]);
            // Must NOT claim the channel (it belongs to the original account)
            expect(channelTrialService.record).not.toHaveBeenCalled();
        });

        it('refuses to connect pages beyond the plan limit instead of persisting them disabled', async () => {
            const workspaceId = 'workspace-123';
            const userId = 'user-123';
            const accessToken = 'token-123';

            vi.mocked(facebookService.getUserPages).mockResolvedValue({
                data: [
                    { id: 'fb-page-1', name: 'First Page', access_token: 'pt-1' },
                    { id: 'fb-page-2', name: 'Second Page', access_token: 'pt-2' },
                ],
            });

            // No existing pages → both take the brand-new path
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
                    }),
                }),
            } as any);

            vi.mocked(instagramService.getLinkedInstagramAccount).mockResolvedValue(null);

            // Starter-style plan: exactly one slot left
            const { subscriptionsService } = await import('../../src/services/subscriptions');
            vi.mocked(subscriptionsService.canEnablePage).mockResolvedValueOnce({ allowed: true, remaining: 1 } as any);

            const insertedValuesList: any[] = [];
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockImplementation((values) => {
                    insertedValuesList.push(values);
                    return { returning: vi.fn().mockResolvedValue([{ id: `new-${insertedValuesList.length}`, ...values }]) };
                }),
            } as any);

            const result = await pagesService.syncFromFacebook(workspaceId, userId, accessToken);

            // Only the first page is persisted — enabled, no disable reason
            expect(insertedValuesList).toHaveLength(1);
            expect(insertedValuesList[0].facebookPageId).toBe('fb-page-1');
            expect(insertedValuesList[0].autoReplyEnabled).toBe(true);
            expect(insertedValuesList[0].autoReplyDisabledReason).toBeNull();
            // The over-limit page is refused outright (no disabled shadow page
            // that would silently swallow webhook traffic) and named to the client
            expect(result.skippedCount).toBe(1);
            expect(result.skippedPages).toEqual([{ pageName: 'Second Page' }]);
            // Refused page must not subscribe to webhooks either
            expect(facebookService.subscribePageToWebhooks).toHaveBeenCalledTimes(1);
            expect(facebookService.subscribePageToWebhooks).toHaveBeenCalledWith('fb-page-1', 'pt-1');
        });

        it('should disable pages revoked in Facebook', async () => {
            const workspaceId = 'workspace-123';
            const userId = 'user-123';
            const accessToken = 'token-123';

            // Facebook returns only page-1 (page-2 was deselected by user)
            vi.mocked(facebookService.getUserPages).mockResolvedValue({
                data: [
                    { id: 'fb-page-1', name: 'Page 1', access_token: 'pt-1' }
                ]
            });

            // DB has two pages (page-2 should be revoked)
            const existingPages = [
                { id: 'p1', facebookPageId: 'fb-page-1', name: 'Page 1', accessToken: 'pt-1' },
                { id: 'p2', facebookPageId: 'fb-page-2', name: 'Page 2', accessToken: 'pt-2' },
            ];
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(existingPages) })
                    })
                })
            } as any);

            // Mock Instagram (no linked accounts)
            vi.mocked(instagramService.getLinkedInstagramAccount).mockResolvedValue(null);

            // Mock DB Update (for both existing page update and revoke)
            const setCalls: any[] = [];
            vi.mocked(db.update).mockReturnValue({
                set: vi.fn().mockImplementation((values) => {
                    setCalls.push(values);
                    return {
                        where: vi.fn().mockReturnValue({
                            returning: vi.fn().mockResolvedValue([{ id: 'p1' }])
                        })
                    };
                })
            } as any);

            const result = await pagesService.syncFromFacebook(workspaceId, userId, accessToken);

            // Should report 1 revoked page
            expect(result.revokedCount).toBe(1);

            // db.update should be called: once for updating existing page-1, once for revoking page-2
            expect(db.update).toHaveBeenCalledTimes(2);

            // The revoke write must clear the disable reason — the blanked token is
            // the authoritative signal; a stale 'trial_block'/'auto_pause' would
            // misdescribe the page in admin and the comment-ingestion gate
            const revokeWrite = setCalls.find(v => v.accessToken === '');
            expect(revokeWrite).toBeDefined();
            expect(revokeWrite.autoReplyEnabled).toBe(false);
            expect(revokeWrite.autoReplyDisabledReason).toBeNull();
        });

        it('un-archives a page that reappears in the Facebook grant', async () => {
            const workspaceId = 'workspace-123';
            const userId = 'user-123';

            vi.mocked(facebookService.getUserPages).mockResolvedValue({
                data: [{ id: 'fb-page-1', name: 'Page 1', access_token: 'pt-1' }],
            });

            // The merchant had hidden this disconnected page; granting it again in
            // Facebook is the un-hide signal.
            const existingPages = [{
                id: 'p1', facebookPageId: 'fb-page-1', name: 'Page 1', accessToken: '',
                userId, archivedAt: new Date('2026-08-01T00:00:00Z'),
            }];
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(existingPages) }),
                    }),
                }),
            } as any);
            vi.mocked(instagramService.getLinkedInstagramAccount).mockResolvedValue(null);

            const setCalls: any[] = [];
            vi.mocked(db.update).mockReturnValue({
                set: vi.fn().mockImplementation((values) => {
                    setCalls.push(values);
                    return { where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'p1' }]) }) };
                }),
            } as any);

            await pagesService.syncFromFacebook(workspaceId, userId, 'token-123');

            const updateWrite = setCalls.find(v => 'archivedAt' in v);
            expect(updateWrite).toBeDefined();
            expect(updateWrite.archivedAt).toBeNull();
            expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
                action: 'page.unarchived',
                pageId: 'p1',
                metadata: expect.objectContaining({ reason: 'fb_sync' }),
            }));
        });

        it('un-archives even when the syncing user is not the original connector', async () => {
            const workspaceId = 'workspace-123';
            const userId = 'team-member';

            vi.mocked(facebookService.getUserPages).mockResolvedValue({
                data: [{ id: 'fb-page-1', name: 'Page 1', access_token: 'pt-1' }],
            });

            // Original connector is someone else → the token is NOT refreshed, but the
            // page's presence in the grant still proves the workspace wants it visible.
            const existingPages = [{
                id: 'p1', facebookPageId: 'fb-page-1', name: 'Page 1', accessToken: '',
                userId: 'someone-else', archivedAt: new Date('2026-08-01T00:00:00Z'),
            }];
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(existingPages) }),
                    }),
                }),
            } as any);
            vi.mocked(instagramService.getLinkedInstagramAccount).mockResolvedValue(null);

            const setCalls: any[] = [];
            vi.mocked(db.update).mockReturnValue({
                set: vi.fn().mockImplementation((values) => {
                    setCalls.push(values);
                    return { where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'p1' }]) }) };
                }),
            } as any);

            await pagesService.syncFromFacebook(workspaceId, userId, 'token-123');

            const updateWrite = setCalls.find(v => 'archivedAt' in v);
            expect(updateWrite.archivedAt).toBeNull();
            // Token untouched for a non-original connector
            expect(updateWrite).not.toHaveProperty('accessToken');
        });

        it('leaves an archived page hidden when it stays out of the grant', async () => {
            const workspaceId = 'workspace-123';
            const userId = 'user-123';

            vi.mocked(facebookService.getUserPages).mockResolvedValue({
                data: [{ id: 'fb-page-1', name: 'Page 1', access_token: 'pt-1' }],
            });

            const existingPages = [
                { id: 'p1', facebookPageId: 'fb-page-1', name: 'Page 1', accessToken: 'pt-1', userId },
                // Archived AND absent from the grant → revoke path must not resurrect it
                { id: 'p2', facebookPageId: 'fb-page-2', name: 'Page 2', accessToken: '', userId, archivedAt: new Date('2026-08-01T00:00:00Z') },
            ];
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(existingPages) }),
                    }),
                }),
            } as any);
            vi.mocked(instagramService.getLinkedInstagramAccount).mockResolvedValue(null);

            const setCalls: any[] = [];
            vi.mocked(db.update).mockReturnValue({
                set: vi.fn().mockImplementation((values) => {
                    setCalls.push(values);
                    return { where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'x' }]) }) };
                }),
            } as any);

            await pagesService.syncFromFacebook(workspaceId, userId, 'token-123');

            const revokeWrite = setCalls.find(v => v.accessToken === '');
            expect(revokeWrite).toBeDefined();
            expect(revokeWrite).not.toHaveProperty('archivedAt');
        });

        // Regression guard for the InMedia agency case (2026-08-09): a workspace
        // at its full plan limit edits the Meta grant ONCE — dropping 4 unwanted
        // pages, keeping 1, adding 1 new. The revocation step must run BEFORE the
        // plan-slot check, so the slots freed by the deselected pages are usable
        // by pages granted in the SAME sync. With the old order (slot check
        // first), the new page was refused on the first attempt and only
        // connected on an identical retry.
        it('frees slots of pages deselected in the same grant edit before the slot check (one-shot swap)', async () => {
            const workspaceId = 'workspace-inmedia';
            const userId = 'user-inmedia';
            const accessToken = 'token-inmedia';
            const PLAN_LIMIT = 5;

            // Meta grant after the edit: the kept page + the new page only
            vi.mocked(facebookService.getUserPages).mockResolvedValue({
                data: [
                    { id: 'fb-shahin-world', name: 'Shahin World', access_token: 'pt-world' },
                    { id: 'fb-shahin-tower', name: 'Shahin Tower Hotel', access_token: 'pt-tower' },
                ],
            });

            // DB before the sync: 5 pages, all enabled — every slot taken
            const existingPages = [
                { id: 'p-world', facebookPageId: 'fb-shahin-world', name: 'Shahin World', accessToken: 'pt-world', autoReplyEnabled: true, userId },
                { id: 'p-dima1', facebookPageId: 'fb-dima-1', name: 'Dima Handmade', accessToken: 'pt-d1', autoReplyEnabled: true, userId },
                { id: 'p-tartous', facebookPageId: 'fb-tartous', name: 'Tartous Cars Online', accessToken: 'pt-tc', autoReplyEnabled: true, userId },
                { id: 'p-dima2', facebookPageId: 'fb-dima-2', name: 'Dima handmade 2', accessToken: 'pt-d2', autoReplyEnabled: true, userId },
                { id: 'p-almas', facebookPageId: 'fb-almas', name: 'مجوهرات ألماس طرطوس', accessToken: 'pt-al', autoReplyEnabled: true, userId },
            ];
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(existingPages) }),
                    }),
                }),
            } as any);

            vi.mocked(instagramService.getLinkedInstagramAccount).mockResolvedValue(null);

            const setCalls: any[] = [];
            vi.mocked(db.update).mockReturnValue({
                set: vi.fn().mockImplementation((values) => {
                    setCalls.push(values);
                    return {
                        where: vi.fn().mockReturnValue({
                            returning: vi.fn().mockResolvedValue([{ id: 'updated' }]),
                        }),
                    };
                }),
            } as any);

            const insertedValuesList: any[] = [];
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockImplementation((values) => {
                    insertedValuesList.push(values);
                    return { returning: vi.fn().mockResolvedValue([{ id: 'p-tower', ...values }]) };
                }),
            } as any);

            // Stateful slot check that mirrors countEnabledPageSlots: `remaining`
            // reflects revoke writes ALREADY in the DB at call time. This is what
            // makes the test order-sensitive — with the slot check running first,
            // it sees 5/5 used and refuses the new page.
            const { subscriptionsService } = await import('../../src/services/subscriptions');
            vi.mocked(subscriptionsService.canEnablePage).mockImplementation(async () => {
                const revokedSoFar = setCalls.filter(v => v.accessToken === '').length;
                const used = PLAN_LIMIT - revokedSoFar;
                const remaining = PLAN_LIMIT - used;
                return remaining > 0
                    ? { allowed: true, limit: PLAN_LIMIT, used, remaining }
                    : { allowed: false, reason: 'Enabled page limit reached. Disable another page or upgrade your plan.', code: 'page_limit_reached', limit: PLAN_LIMIT, used, remaining: 0 } as any;
            });

            const result = await pagesService.syncFromFacebook(workspaceId, userId, accessToken);

            // The 4 deselected pages are revoked
            expect(result.revokedCount).toBe(4);
            expect(setCalls.filter(v => v.accessToken === '')).toHaveLength(4);

            // The new page connects and auto-enables IN THIS SAME SYNC — no
            // plan-limit refusal, no second attempt needed
            expect(result.skippedCount).toBe(0);
            expect(result.skippedPages).toEqual([]);
            expect(insertedValuesList).toHaveLength(1);
            expect(insertedValuesList[0].facebookPageId).toBe('fb-shahin-tower');
            expect(insertedValuesList[0].autoReplyEnabled).toBe(true);
            expect(facebookService.subscribePageToWebhooks).toHaveBeenCalledWith('fb-shahin-tower', 'pt-tower');
        });

        // Regression guard for the "Noor unstuck" UX:
        // When a sync attempts to attach a page that already lives in ANOTHER
        // workspace, AND the syncing user is already a member of that holding
        // workspace, the response must include `alreadyMemberOf` so the client
        // can render an actionable "Switch to ‹X›" affordance instead of the
        // misleading "ask the owner to invite you" warning.
        it('returns alreadyMemberOf when conflict workspace is one the user is already a member of', async () => {
            const workspaceId = 'ws-noor-solo';
            const userId = 'user-noor';
            const accessToken = 'noor-fb-token';
            const conflictWorkspaceId = 'ws-ali';

            vi.mocked(facebookService.getUserPages).mockResolvedValue({
                data: [{ id: 'fb-page-shared', name: 'Shared Page', access_token: 'pt-shared' }],
            });

            // The pages.ts flow does several DB selects in order.
            // 1. getPages(workspaceId) — existing pages in Noor's solo workspace (empty).
            // 2. globalResults — find the page globally (returns the row in Ali's workspace).
            // 3. membership lookup — is Noor a member of Ali's workspace? (yes, admin).
            const fromOrderByLimitChain = (rows: unknown[]) => ({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) }),
                    }),
                }),
            });

            const fromWhereChain = (rows: unknown[]) => ({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(rows),
                }),
            });

            const fromInnerJoinChain = (rows: unknown[]) => ({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue(rows),
                        }),
                    }),
                }),
            });

            vi.mocked(db.select)
                // 1. existing pages in Noor's workspace — empty
                .mockReturnValueOnce(fromOrderByLimitChain([]) as any)
                // 2. global lookup for fb-page-shared — found in Ali's workspace, still connected
                .mockReturnValueOnce(fromWhereChain([{
                    id: 'page-row-id',
                    workspaceId: conflictWorkspaceId,
                    facebookPageId: 'fb-page-shared',
                    accessToken: 'ali-page-token', // non-empty → "connected" (NOT disconnected)
                }]) as any)
                // 3. membership lookup — Noor is admin in Ali's workspace
                .mockReturnValueOnce(fromInnerJoinChain([{
                    role: 'admin',
                    workspaceName: 'Ali Ahdab',
                }]) as any);

            vi.mocked(instagramService.getLinkedInstagramAccount).mockResolvedValue(null);

            const result = await pagesService.syncFromFacebook(workspaceId, userId, accessToken);

            expect(result.takenCount).toBe(1);
            expect(result.alreadyMemberOf).toEqual([
                {
                    workspaceId: conflictWorkspaceId,
                    workspaceName: 'Ali Ahdab',
                    role: 'admin',
                    pageName: 'Shared Page',
                },
            ]);
        });

        // Product rule: when the conflict workspace belongs to a stranger (the
        // user is NOT a member — e.g. they were removed from the team or
        // deleted their old account and re-signed up), the page must be
        // silently skipped: no `takenCount`, no `alreadyMemberOf`. The user
        // can't act on it from their own account, so surfacing it is noise.
        it('silently skips when user is not a member of the conflict workspace', async () => {
            const workspaceId = 'ws-stranger';
            const userId = 'user-stranger';
            const accessToken = 'stranger-fb-token';

            vi.mocked(facebookService.getUserPages).mockResolvedValue({
                data: [{ id: 'fb-page-foreign', name: 'Foreign Page', access_token: 'pt-foreign' }],
            });

            const fromOrderByLimitChain = (rows: unknown[]) => ({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) }),
                    }),
                }),
            });

            const fromWhereChain = (rows: unknown[]) => ({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(rows),
                }),
            });

            const fromInnerJoinChain = (rows: unknown[]) => ({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue(rows),
                        }),
                    }),
                }),
            });

            vi.mocked(db.select)
                .mockReturnValueOnce(fromOrderByLimitChain([]) as any)
                .mockReturnValueOnce(fromWhereChain([{
                    id: 'page-row-id',
                    workspaceId: 'ws-someone-else',
                    facebookPageId: 'fb-page-foreign',
                    accessToken: 'someone-else-token',
                }]) as any)
                // Membership lookup: empty → user is NOT a member
                .mockReturnValueOnce(fromInnerJoinChain([]) as any);

            vi.mocked(instagramService.getLinkedInstagramAccount).mockResolvedValue(null);

            const result = await pagesService.syncFromFacebook(workspaceId, userId, accessToken);

            expect(result.takenCount).toBe(0);
            expect(result.alreadyMemberOf).toEqual([]);
            expect(result.syncedPages).toEqual([]);
        });

        // Regression guard for the drift that stranded 145 production messages:
        // claiming a DISCONNECTED page moves it into the claiming workspace, so
        // the denormalized workspace_id on its inbox rows must move with it.
        // Before this, the page changed hands and its comments/messages stayed
        // in the previous owner's scope forever.
        it('re-scopes the inbox when claiming a disconnected page from another workspace', async () => {
            const workspaceId = 'ws-claimer';
            const userId = 'user-claimer';

            vi.mocked(facebookService.getUserPages).mockResolvedValue({
                data: [{ id: 'fb-page-abandoned', name: 'Abandoned Page', access_token: 'pt-fresh' }],
            });

            const fromOrderByLimitChain = (rows: unknown[]) => ({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) }),
                    }),
                }),
            });
            const fromWhereChain = (rows: unknown[]) => ({
                from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(rows) }),
            });

            // First two selects are call-ordered (getPages, then the global
            // lookup); everything the re-scope reads afterwards is dispatched by
            // table, so statement order inside the helper doesn't matter here.
            let selectCall = 0;
            vi.mocked(db.select).mockImplementation((() => {
                const idx = selectCall++;
                if (idx === 0) return fromOrderByLimitChain([]) as any;
                if (idx === 1) return fromWhereChain([{
                    id: 'page-row-id',
                    workspaceId: 'ws-previous-owner',
                    facebookPageId: 'fb-page-abandoned',
                    accessToken: '',   // → DISCONNECTED, so claimable
                }]) as any;
                return {
                    from: vi.fn().mockImplementation((table: unknown) => ({
                        where: vi.fn().mockResolvedValue(
                            table === postsTable ? [{ id: 'post-1' }]
                                : table === instagramMediaTable ? []
                                    : table === commentsTable ? [{ n: 3 }]
                                        : table === messagesTable ? [{ n: 145 }]
                                            : []
                        ),
                    })),
                } as any;
            }) as any);

            vi.mocked(instagramService.getLinkedInstagramAccount).mockResolvedValue(null);

            const updatedTables: unknown[] = [];
            const updatedValues: any[] = [];
            vi.mocked(db.update).mockImplementation(((table: unknown) => ({
                set: vi.fn().mockImplementation((values: any) => {
                    updatedTables.push(table);
                    updatedValues.push(values);
                    const result: any = Promise.resolve(undefined);
                    // pages.update(...) needs .returning(); the re-scope updates
                    // resolve straight off .where().
                    result.returning = vi.fn().mockResolvedValue([{ id: 'page-row-id', ...values }]);
                    return { where: vi.fn().mockReturnValue(result) };
                }),
            })) as any);

            await pagesService.syncFromFacebook(workspaceId, userId, 'claimer-fb-token');

            // The page row moved to the claiming workspace...
            const pageWrite = updatedValues.find(v => v.workspaceId === workspaceId && 'accessToken' in v);
            expect(pageWrite).toBeDefined();
            expect(pageWrite.userId).toBe(userId);

            // ...and so did its comments (page has a post) and messages.
            expect(updatedTables).toContain(commentsTable);
            expect(updatedTables).toContain(messagesTable);
            // No IG media on this page → no instagram_comments write attempted
            expect(updatedTables).not.toContain(instagramCommentsTable);

            for (const table of [commentsTable, messagesTable]) {
                const write = updatedValues[updatedTables.indexOf(table)];
                expect(write.workspaceId).toBe(workspaceId);
            }

            // ATOMICITY: page row + re-scope must share one transaction. Without
            // it, a mid-way failure leaves the page moved and its inbox behind —
            // and the next sync takes the existingPage branch, so the drift is
            // never repaired.
            expect(db.transaction).toHaveBeenCalledTimes(1);
        });

        // Mixed-case regression guard for the silent-skip rule:
        // when one of the user's FB pages is fresh and another is held by a
        // stranger workspace, the fresh page MUST still sync — silent-skip
        // applies only to the conflict, not to siblings.
        it('syncs the fresh page and silently skips the stranger-held one in a mixed batch', async () => {
            const workspaceId = 'ws-noor-solo';
            const userId = 'user-noor';
            const accessToken = 'noor-fb-token';

            vi.mocked(facebookService.getUserPages).mockResolvedValue({
                data: [
                    { id: 'fb-page-fresh', name: 'Fresh Page', access_token: 'pt-fresh' },
                    { id: 'fb-page-foreign', name: 'Foreign Page', access_token: 'pt-foreign' },
                ],
            });

            const fromOrderByLimitChain = (rows: unknown[]) => ({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) }),
                    }),
                }),
            });

            const fromWhereChain = (rows: unknown[]) => ({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(rows),
                }),
            });

            const fromInnerJoinChain = (rows: unknown[]) => ({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue(rows),
                        }),
                    }),
                }),
            });

            vi.mocked(db.select)
                // 1. existing pages in Noor's workspace — empty
                .mockReturnValueOnce(fromOrderByLimitChain([]) as any)
                // 2. global lookup for fb-page-fresh — not found anywhere
                .mockReturnValueOnce(fromWhereChain([]) as any)
                // 3. global lookup for fb-page-foreign — found in stranger workspace, connected
                .mockReturnValueOnce(fromWhereChain([{
                    id: 'page-row-id',
                    workspaceId: 'ws-stranger',
                    facebookPageId: 'fb-page-foreign',
                    accessToken: 'stranger-token',
                }]) as any)
                // 4. membership lookup for stranger workspace — empty (not a member)
                .mockReturnValueOnce(fromInnerJoinChain([]) as any);

            vi.mocked(instagramService.getLinkedInstagramAccount).mockResolvedValue(null);

            const insertReturning = vi.fn().mockResolvedValue([{
                id: 'new-page-id',
                facebookPageId: 'fb-page-fresh',
                name: 'Fresh Page',
                workspaceId,
                userId,
                accessToken: 'pt-fresh',
            }]);
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockReturnValue({ returning: insertReturning }),
            } as any);

            const result = await pagesService.syncFromFacebook(workspaceId, userId, accessToken);

            expect(result.syncedPages).toHaveLength(1);
            expect(result.syncedPages[0].facebookPageId).toBe('fb-page-fresh');
            expect(result.takenCount).toBe(0);
            expect(result.alreadyMemberOf).toEqual([]);
        });

        it('should not set suggestedKnowledgeBase when Facebook has no business info', async () => {
            const workspaceId = 'workspace-123';
            const userId = 'user-123';
            const accessToken = 'token-123';

            // Mock Facebook API response with minimal info (no business details)
            vi.mocked(facebookService.getUserPages).mockResolvedValue({
                data: [
                    { 
                        id: 'fb-page-1', 
                        name: 'Minimal Page', 
                        access_token: 'pt-1'
                        // No about, phone, address, etc.
                    }
                ]
            });

            // Mock no existing pages
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) })
                    })
                })
            } as any);

            // Mock Instagram (no linked account)
            vi.mocked(instagramService.getLinkedInstagramAccount).mockResolvedValue(null);

            // Capture what's inserted
            let insertedValues: any = null;
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockImplementation((values) => {
                    insertedValues = values;
                    return {
                        returning: vi.fn().mockResolvedValue([{ id: 'new-page-id', ...values }])
                    };
                })
            } as any);

            await pagesService.syncFromFacebook(workspaceId, userId, accessToken);

            // suggestedKnowledgeBase should be null when no business info available
            expect(insertedValues).toBeDefined();
            expect(insertedValues.suggestedKnowledgeBase).toBeNull();
        });
    });

    // ───────────────────────────────────────────
    // rescopePageWorkspace — denormalized workspace_id repair
    //
    // Regression guard for the drift that stranded 145 production messages:
    // a page changed workspace while its inbox rows kept pointing at the old
    // one, leaving them visible to the previous owner and invisible to the new.
    // ───────────────────────────────────────────
    describe('rescopePageWorkspace', () => {
        /**
         * Dispatches by TABLE rather than call order, so a test can't accidentally
         * assert the right number against the wrong table, and so the mock stays
         * valid if the helper's statement order changes.
         *
         * The helper reads posts/instagram_media to resolve parents, then does a
         * count() per denormalized table and only writes when that count > 0.
         */
        function mockRescopeDb(opts: {
            postIds: string[];
            mediaIds: string[];
            drifted: { comments: number; instagramComments: number; messages: number };
        }) {
            const updates: { table: unknown; set: any }[] = [];

            const selectResultFor = new Map<unknown, unknown[]>([
                [postsTable, opts.postIds.map(id => ({ id }))],
                [instagramMediaTable, opts.mediaIds.map(id => ({ id }))],
                [commentsTable, [{ n: opts.drifted.comments }]],
                [instagramCommentsTable, [{ n: opts.drifted.instagramComments }]],
                [messagesTable, [{ n: opts.drifted.messages }]],
            ]);

            vi.mocked(db.select).mockImplementation((() => ({
                from: vi.fn().mockImplementation((table: unknown) => ({
                    where: vi.fn().mockResolvedValue(selectResultFor.get(table) ?? []),
                })),
            })) as any);

            vi.mocked(db.update).mockImplementation(((table: unknown) => ({
                set: vi.fn().mockImplementation((values: any) => ({
                    // No .returning() any more — the helper counts first and the
                    // update resolves directly off .where().
                    where: vi.fn().mockImplementation(() => {
                        updates.push({ table, set: values });
                        return Promise.resolve(undefined);
                    }),
                })),
            })) as any);

            return updates;
        }

        it('moves comments, Instagram comments and messages to the new workspace', async () => {
            const { rescopePageWorkspace } = await import('../../src/services/pages');
            const updates = mockRescopeDb({
                postIds: ['post-1', 'post-2'],
                mediaIds: ['media-1'],
                drifted: { comments: 4, instagramComments: 2, messages: 145 },
            });

            const moved = await rescopePageWorkspace('page-1', 'ws-new');

            expect(moved).toEqual({ comments: 4, instagramComments: 2, messages: 145 });
            // All three denormalized tables written, each with the NEW workspace
            expect(updates.map(u => u.table)).toEqual(
                expect.arrayContaining([commentsTable, instagramCommentsTable, messagesTable])
            );
            expect(updates).toHaveLength(3);
            for (const u of updates) {
                expect(u.set.workspaceId).toBe('ws-new');
            }
        });

        it('skips the comment writes when the page has no posts or media', async () => {
            const { rescopePageWorkspace } = await import('../../src/services/pages');
            const updates = mockRescopeDb({
                postIds: [],
                mediaIds: [],
                drifted: { comments: 12, instagramComments: 7, messages: 3 },
            });

            const moved = await rescopePageWorkspace('page-empty', 'ws-new');

            // An empty inArray() would match nothing at best and throw at worst —
            // the guard must skip both comment paths entirely. Only `messages` is
            // touched, and the two comment counts stay 0 even though the mock
            // would happily have reported 12 and 7 had they been queried.
            expect(updates).toHaveLength(1);
            expect(updates[0].table).toBe(messagesTable);
            expect(moved).toEqual({ comments: 0, instagramComments: 0, messages: 3 });
        });

        it('writes nothing when no row has drifted', async () => {
            const { rescopePageWorkspace } = await import('../../src/services/pages');
            const updates = mockRescopeDb({
                postIds: ['post-1'],
                mediaIds: ['media-1'],
                drifted: { comments: 0, instagramComments: 0, messages: 0 },
            });

            const moved = await rescopePageWorkspace('page-clean', 'ws-new');

            // Makes the helper safe to re-run: a page already in the target
            // workspace is counted and left alone, never rewritten.
            expect(updates).toHaveLength(0);
            expect(moved).toEqual({ comments: 0, instagramComments: 0, messages: 0 });
        });
    });

    // ───────────────────────────────────────────
    // getPages — Redis stats cache
    // ───────────────────────────────────────────
    describe('toggleAutoReply — disable reason bookkeeping', () => {
        function mockUpdateCapture() {
            const captured: { set?: any } = {};
            vi.mocked(db.update).mockReturnValue({
                set: vi.fn().mockImplementation((values) => {
                    captured.set = values;
                    return { where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'page-1', ...values }]) }) };
                }),
            } as any);
            return captured;
        }

        it("records 'user' as the disable reason on an explicit merchant toggle-off", async () => {
            const captured = mockUpdateCapture();

            await pagesService.toggleAutoReply('workspace-123', 'page-1', false);

            expect(captured.set.autoReplyEnabled).toBe(false);
            // Merchant intent — keeps the comment pipeline fully silent for
            // this page, unlike system disables (plan_limit / trial_block)
            expect(captured.set.autoReplyDisabledReason).toBe('user');
            // Disabling must not wipe the auto-pause audit trail
            expect(captured.set).not.toHaveProperty('autoPauseReason');
        });

        it('clears the disable reason (and auto-pause state) on re-enable', async () => {
            const captured = mockUpdateCapture();

            await pagesService.toggleAutoReply('workspace-123', 'page-1', true);

            expect(captured.set.autoReplyEnabled).toBe(true);
            expect(captured.set.autoReplyDisabledReason).toBeNull();
            expect(captured.set.consecutiveSendFailures).toBe(0);
            expect(captured.set.autoPauseReason).toBeNull();
        });
    });

    describe('archivePage — merchant soft-hide of a disconnected page', () => {
        const workspaceId = 'workspace-123';

        /** Queue the single row `archivePage` selects, and capture any update. */
        function mockPageRow(row: Record<string, unknown> | undefined) {
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(row ? [row] : []),
                }),
            } as any);
            const captured: { set?: any } = {};
            vi.mocked(db.update).mockReturnValue({
                set: vi.fn().mockImplementation((values) => {
                    captured.set = values;
                    return { where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'page-1', ...values }]) }) };
                }),
            } as any);
            return captured;
        }

        it('archives a disconnected Facebook page', async () => {
            const captured = mockPageRow({
                id: 'page-1', workspaceId, facebookPageId: 'fb-1', accessToken: '', archivedAt: null,
            });

            const result = await pagesService.archivePage(workspaceId, 'page-1');

            expect(result.status).toBe('archived');
            expect(result).toMatchObject({ already: false });
            expect(captured.set.archivedAt).toBeInstanceOf(Date);
        });

        it('refuses to archive a CONNECTED page (archiving is not a disconnect)', async () => {
            const captured = mockPageRow({
                id: 'page-1', workspaceId, facebookPageId: 'fb-1', accessToken: 'live-token', archivedAt: null,
            });

            const result = await pagesService.archivePage(workspaceId, 'page-1');

            expect(result.status).toBe('not_disconnected');
            expect(captured.set).toBeUndefined();
            expect(db.update).not.toHaveBeenCalled();
        });

        it('refuses when WhatsApp is still live behind a dead Facebook token', async () => {
            // This card shows the same reconnect banner, but hiding it would bury a
            // working WhatsApp channel.
            const captured = mockPageRow({
                id: 'page-1', workspaceId, facebookPageId: 'fb-1', accessToken: '',
                whatsappAccessToken: 'wa-token', archivedAt: null,
            });

            const result = await pagesService.archivePage(workspaceId, 'page-1');

            expect(result.status).toBe('not_disconnected');
            expect(captured.set).toBeUndefined();
        });

        it('refuses a WhatsApp-only card (no Facebook page to archive)', async () => {
            mockPageRow({
                id: 'page-1', workspaceId, facebookPageId: null, accessToken: '',
                whatsappAccessToken: '', archivedAt: null,
            });

            const result = await pagesService.archivePage(workspaceId, 'page-1');

            expect(result.status).toBe('not_disconnected');
        });

        it('returns not_found when the page is not in this workspace', async () => {
            mockPageRow(undefined);

            const result = await pagesService.archivePage(workspaceId, 'page-missing');

            expect(result.status).toBe('not_found');
            expect(db.update).not.toHaveBeenCalled();
        });

        it('is idempotent — an already-archived page is not rewritten', async () => {
            const previouslyArchived = new Date('2026-08-01T00:00:00Z');
            mockPageRow({
                id: 'page-1', workspaceId, facebookPageId: 'fb-1', accessToken: '',
                archivedAt: previouslyArchived,
            });

            const result = await pagesService.archivePage(workspaceId, 'page-1');

            expect(result).toMatchObject({ status: 'archived', already: true });
            // No rewritten timestamp, and the controller skips the audit event
            expect(db.update).not.toHaveBeenCalled();
        });
    });

    describe('getPages - stats caching', () => {
        const workspaceId = 'ws-123';
        const mockPages = [
            { id: 'page-1', workspaceId, accessToken: '', createdAt: new Date(), name: 'P1' },
        ];

        beforeEach(() => {
            // Mock the pages query (workspacePages)
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue(mockPages),
                        }),
                    }),
                }),
            } as any);
        });

        it('should return cached stats from Redis on cache hit', async () => {
            const cachedStats = { 'page-1': { commentsCount: 5, repliesCount: 3, lastActivity: 1700000000000 } };
            mockRedisGet.mockResolvedValue(JSON.stringify(cachedStats));

            const result = await pagesService.getPages(workspaceId);

            expect(mockRedisGet).toHaveBeenCalledWith(`stats:workspace:${workspaceId}:v2`);
            expect(result[0].commentsCount).toBe(5);
            expect(result[0].repliesCount).toBe(3);
            expect(result[0].replyRate).toBe(60);
        });

        it('should write stats to Redis on cache miss', async () => {
            mockRedisGet.mockResolvedValue(null);

            // Mock the three parallel stats queries (fb, ig, messages)
            const originalSelect = vi.mocked(db.select);
            let callCount = 0;
            originalSelect.mockImplementation((() => {
                callCount++;
                // First call is the pages query, subsequent are stats queries
                if (callCount === 1) {
                    return {
                        from: vi.fn().mockReturnValue({
                            where: vi.fn().mockReturnValue({
                                orderBy: vi.fn().mockReturnValue({
                                    limit: vi.fn().mockResolvedValue(mockPages),
                                }),
                            }),
                        }),
                    } as any;
                }
                // Stats queries return empty rows
                return {
                    from: vi.fn().mockReturnValue({
                        innerJoin: vi.fn().mockReturnValue({
                            innerJoin: vi.fn().mockReturnValue({
                                where: vi.fn().mockReturnValue({
                                    groupBy: vi.fn().mockResolvedValue([]),
                                }),
                            }),
                            where: vi.fn().mockReturnValue({
                                groupBy: vi.fn().mockResolvedValue([]),
                            }),
                        }),
                    }),
                } as any;
            }) as any);

            await pagesService.getPages(workspaceId);

            expect(mockRedisSet).toHaveBeenCalledWith(
                `stats:workspace:${workspaceId}:v2`,
                expect.any(String),
                'EX',
                300,
            );
        });

        it('aggregates auto-reply breakdown across fb/ig/messages and excludes manual', async () => {
            mockRedisGet.mockResolvedValue(null);

            // Three stats sources (fb comments / ig comments / messages) each
            // contribute to the same page. The merge logic should sum them and
            // produce a breakdown with EXACTLY {ai, template, postReply} — no
            // manual key — and a repliesCount that equals their sum.
            const fbRow = { pageId: 'page-1', commentsCount: 100, aiCount: 50, templateCount: 10, postReplyCount: 5, lastActivity: null };
            const igRow = { pageId: 'page-1', commentsCount: 30, aiCount: 15, templateCount: 3, postReplyCount: 2, lastActivity: null };
            const msgRow = { pageId: 'page-1', commentsCount: 20, aiCount: 8, templateCount: 4, postReplyCount: 1, lastActivity: null };
            const statsRowsByCall = [fbRow, igRow, msgRow];

            let callCount = 0;
            vi.mocked(db.select).mockImplementation((() => {
                callCount++;
                if (callCount === 1) {
                    return {
                        from: vi.fn().mockReturnValue({
                            where: vi.fn().mockReturnValue({
                                orderBy: vi.fn().mockReturnValue({
                                    limit: vi.fn().mockResolvedValue(mockPages),
                                }),
                            }),
                        }),
                    } as any;
                }
                const row = statsRowsByCall[callCount - 2];
                return {
                    from: vi.fn().mockReturnValue({
                        innerJoin: vi.fn().mockReturnValue({
                            innerJoin: vi.fn().mockReturnValue({
                                where: vi.fn().mockReturnValue({
                                    groupBy: vi.fn().mockResolvedValue(row ? [row] : []),
                                }),
                            }),
                            where: vi.fn().mockReturnValue({
                                groupBy: vi.fn().mockResolvedValue(row ? [row] : []),
                            }),
                        }),
                    }),
                } as any;
            }) as any);

            const result = await pagesService.getPages(workspaceId);

            const expectedAi = fbRow.aiCount + igRow.aiCount + msgRow.aiCount;          // 73
            const expectedTemplate = fbRow.templateCount + igRow.templateCount + msgRow.templateCount; // 17
            const expectedPostReply = fbRow.postReplyCount + igRow.postReplyCount + msgRow.postReplyCount; // 8
            const expectedRepliesCount = expectedAi + expectedTemplate + expectedPostReply; // 98

            expect(result[0].breakdown).toEqual({
                ai: expectedAi,
                template: expectedTemplate,
                postReply: expectedPostReply,
            });
            // Contract: rows of the UI tooltip sum to the headline number.
            expect(result[0].repliesCount).toBe(expectedRepliesCount);
            // Guard against re-adding manual to the contract by accident.
            expect(result[0].breakdown).not.toHaveProperty('manual');
        });
    });

    /**
     * `storeAnswersPolicies` tells /business whether it may say «يجيب عنها متجرك
     * المتصل» on delivery/payment instead of asking the merchant to fill them in.
     * It derives from the same `storeAnswersPolicies` predicate (ecommerce.ts)
     * that `getStoreContextForAI` feeds the prompt from, because a page keeps its
     * `ecommerce_store_id` in two states where the model receives NOTHING:
     * after a platform-side uninstall (`deactivateStore` blanks the tokens but
     * keeps the link so a reconnect restores it), and on a live store that synced
     * no policy text. Deriving the claim from the id alone tells the merchant not
     * to bother, and their customer then gets "I don't know".
     */
    describe('getPages — storeAnswersPolicies', () => {
        const workspaceId = 'ws-store';

        /** Pages query resolves `pageRows`; the ecommerce_stores query resolves `storeRows`. */
        function mockSelect(pageRows: unknown[], storeRows: unknown[]) {
            vi.mocked(db.select).mockImplementation(((..._args: unknown[]) => ({
                from: vi.fn((table: unknown) => {
                    if (table === ecommerceStoresTable) {
                        return { where: vi.fn().mockResolvedValue(storeRows) };
                    }
                    return {
                        where: vi.fn().mockReturnValue({
                            orderBy: vi.fn().mockReturnValue({
                                limit: vi.fn().mockResolvedValue(pageRows),
                            }),
                        }),
                    };
                }),
            })) as any);
        }

        beforeEach(() => {
            // Stats come from cache so the (unmocked) aggregate queries stay out of the way.
            mockRedisGet.mockResolvedValue(JSON.stringify({}));
        });

        const linkedPage = [{ id: 'page-1', workspaceId, accessToken: '', createdAt: new Date(), name: 'P1', ecommerceStoreId: 'store-1' }];

        it('is true when the linked store is active AND has synced policy text', async () => {
            mockSelect(linkedPage, [{ id: 'store-1', isActive: true, policiesSummary: 'التوصيل خلال 3 أيام' }]);

            const result = await pagesService.getPages(workspaceId);

            expect(result[0].storeAnswersPolicies).toBe(true);
        });

        it('is false after a platform-side uninstall (link kept, store inactive)', async () => {
            // deactivateStore keeps pages.ecommerce_store_id so a reconnect
            // restores the link — exactly the trap this flag exists to close.
            mockSelect(linkedPage, [{ id: 'store-1', isActive: false, policiesSummary: 'التوصيل خلال 3 أيام' }]);

            const result = await pagesService.getPages(workspaceId);

            expect(result[0].ecommerceStoreId).toBe('store-1');
            expect(result[0].storeAnswersPolicies).toBe(false);
        });

        it.each([null, ''])('is false for a live store that synced no policy text (%j)', async (policiesSummary) => {
            // Shopify builds policiesSummary as `policies.join('\n') || null`;
            // '' guards any writer that skips the || null coercion.
            mockSelect(linkedPage, [{ id: 'store-1', isActive: true, policiesSummary }]);

            const result = await pagesService.getPages(workspaceId);

            expect(result[0].storeAnswersPolicies).toBe(false);
        });

        it('is false for a page with no store, without querying stores at all', async () => {
            const selectSpy = vi.mocked(db.select);
            mockSelect([{ id: 'page-1', workspaceId, accessToken: '', createdAt: new Date(), name: 'P1', ecommerceStoreId: null }], []);

            const result = await pagesService.getPages(workspaceId);

            expect(result[0].storeAnswersPolicies).toBe(false);
            // No linked store ids → no reason to touch ecommerce_stores.
            const touchedStores = selectSpy.mock.results.some(r => {
                const from = (r.value as { from?: ReturnType<typeof vi.fn> })?.from;
                return !!from && from.mock.calls.some(c => c[0] === ecommerceStoresTable);
            });
            expect(touchedStores).toBe(false);
        });
    });
});
