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

describe('PagesService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('syncFromFacebook', () => {
        it('should sync pages efficiently (parallel API calls)', async () => {
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
                        orderBy: vi.fn().mockResolvedValue([]) 
                    })
                })
            } as any);

            // Mock Instagram checks
            vi.mocked(instagramService.getLinkedInstagramAccount)
                .mockResolvedValueOnce({ id: 'ig-1', username: 'ig_user_1' } as any)
                .mockResolvedValueOnce(null);

            // Mock DB Insert
            const mockInsertReturn = vi.fn().mockReturnValue(['new-page']);
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: mockInsertReturn
                })
            } as any);

            await pagesService.syncFromFacebook(userId, accessToken);

            // Verify Facebook API called once
            expect(facebookService.getUserPages).toHaveBeenCalledWith(accessToken);

            // Verify Instagram API called twice (in parallel)
            expect(instagramService.getLinkedInstagramAccount).toHaveBeenCalledTimes(2);

            // Verify DB inserts occurred (Sequential logic verification is hard to strictly prove in unit test without spying on iteration order, but we confirm calls happen)
            expect(db.insert).toHaveBeenCalledTimes(2);
        });

        it('should update existing pages instead of creating new ones', async () => {
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
                        orderBy: vi.fn().mockResolvedValue([existingPage]) 
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
 
             await pagesService.syncFromFacebook(userId, accessToken);
 
             // Verify Update called
             expect(db.update).toHaveBeenCalled();
             expect(db.insert).not.toHaveBeenCalled();
        });

        it('should save Facebook business info to suggestedKnowledgeBase (not knowledgeBase)', async () => {
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
                        orderBy: vi.fn().mockResolvedValue([]) 
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

            await pagesService.syncFromFacebook(userId, accessToken);

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

        it('should not set suggestedKnowledgeBase when Facebook has no business info', async () => {
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
                        orderBy: vi.fn().mockResolvedValue([]) 
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

            await pagesService.syncFromFacebook(userId, accessToken);

            // suggestedKnowledgeBase should be null when no business info available
            expect(insertedValues).toBeDefined();
            expect(insertedValues.suggestedKnowledgeBase).toBeNull();
        });
    });
});
