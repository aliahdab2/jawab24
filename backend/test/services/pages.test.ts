import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pagesService } from '../../src/services/pages';
import { db } from '../../src/db';
import { facebookService } from '../../src/services/facebook';
import { instagramService } from '../../src/services/instagram';

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

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn().mockResolvedValue('OK');
vi.mock('../../src/lib/redis', () => ({
    redis: {
        get: (...args: unknown[]) => mockRedisGet(...args),
        set: (...args: unknown[]) => mockRedisSet(...args),
    },
}));

describe('PagesService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
            vi.mocked(db.update).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([{ id: 'p1' }])
                    })
                })
            } as any);

            const result = await pagesService.syncFromFacebook(workspaceId, userId, accessToken);

            // Should report 1 revoked page
            expect(result.revokedCount).toBe(1);

            // db.update should be called: once for updating existing page-1, once for revoking page-2
            expect(db.update).toHaveBeenCalledTimes(2);
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
    // getPages — Redis stats cache
    // ───────────────────────────────────────────
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
    });
});
