import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RulesService, PaginatedResult } from '../../src/services/rules';

// Mock the database
vi.mock('../../src/db', () => ({
    db: {
        insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
                returning: vi.fn(),
            }),
        }),
        select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
                leftJoin: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockReturnValue({
                                offset: vi.fn(),
                            }),
                        }),
                    }),
                }),
                where: vi.fn(),
            }),
        }),
        update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    returning: vi.fn(),
                }),
            }),
        }),
        delete: vi.fn().mockReturnValue({
            where: vi.fn(),
        }),
    },
}));

vi.mock('../../src/db/schema', () => ({
    rules: {
        id: 'id',
        userId: 'user_id',
        name: 'name',
        keywords: 'keywords',
        priority: 'priority',
        active: 'active',
        templateId: 'template_id',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
    },
    templates: {
        id: 'id',
        name: 'name',
    },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn(),
    and: vi.fn(),
    desc: vi.fn(),
    sql: vi.fn(),
}));

describe('RulesService', () => {
    let service: RulesService;

    beforeEach(() => {
        service = new RulesService();
        vi.clearAllMocks();
    });

    describe('createRule', () => {
        it('should create a rule with all fields', async () => {
            const { db } = await import('../../src/db');
            const mockRule = {
                id: 'rule-123',
                userId: 'user-123',
                name: 'Price Inquiry',
                keywords: ['price', 'cost'],
                templateId: 'template-123',
                priority: 10,
                active: true,
            };

            (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([mockRule]),
                }),
            });

            const result = await service.createRule('user-123', {
                name: 'Price Inquiry',
                keywords: ['price', 'cost'],
                templateId: 'template-123',
                priority: 10,
            });

            expect(result).toEqual(mockRule);
            expect(db.insert).toHaveBeenCalled();
        });

        it('should use default values when not provided', async () => {
            const { db } = await import('../../src/db');
            const mockRule = {
                id: 'rule-123',
                userId: 'user-123',
                name: 'Simple Rule',
                keywords: ['test'],
                templateId: null,
                priority: 0,
                active: true,
            };

            const insertValues = vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([mockRule]),
            });
            (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
                values: insertValues,
            });

            await service.createRule('user-123', {
                name: 'Simple Rule',
                keywords: ['test'],
            });

            expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
                priority: 0,
                active: true,
            }));
        });
    });

    describe('getRules with pagination', () => {
        it('should return paginated results', async () => {
            const { db } = await import('../../src/db');
            const mockRules = [
                { id: 'rule-1', name: 'Rule 1', templateName: 'Template 1' },
                { id: 'rule-2', name: 'Rule 2', templateName: null },
            ];

            // Mock count query
            const countMock = vi.fn().mockResolvedValue([{ count: 25 }]);
            const dataMock = vi.fn().mockResolvedValue(mockRules);

            (db.select as ReturnType<typeof vi.fn>)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: countMock,
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        leftJoin: vi.fn().mockReturnValue({
                            where: vi.fn().mockReturnValue({
                                orderBy: vi.fn().mockReturnValue({
                                    limit: vi.fn().mockReturnValue({
                                        offset: dataMock,
                                    }),
                                }),
                            }),
                        }),
                    }),
                });

            const result = await service.getRules('user-123', { page: 2, limit: 10 });

            expect(result.data).toEqual(mockRules);
            expect(result.pagination).toEqual({
                page: 2,
                limit: 10,
                total: 25,
                totalPages: 3,
            });
        });

        it('should use default pagination values', async () => {
            const { db } = await import('../../src/db');

            (db.select as ReturnType<typeof vi.fn>)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([{ count: 5 }]),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        leftJoin: vi.fn().mockReturnValue({
                            where: vi.fn().mockReturnValue({
                                orderBy: vi.fn().mockReturnValue({
                                    limit: vi.fn().mockReturnValue({
                                        offset: vi.fn().mockResolvedValue([]),
                                    }),
                                }),
                            }),
                        }),
                    }),
                });

            const result = await service.getRules('user-123');

            expect(result.pagination.page).toBe(1);
            expect(result.pagination.limit).toBe(20);
        });

        it('should calculate total pages correctly', async () => {
            const { db } = await import('../../src/db');

            // 23 total items with limit 10 = 3 pages
            (db.select as ReturnType<typeof vi.fn>)
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([{ count: 23 }]),
                    }),
                })
                .mockReturnValueOnce({
                    from: vi.fn().mockReturnValue({
                        leftJoin: vi.fn().mockReturnValue({
                            where: vi.fn().mockReturnValue({
                                orderBy: vi.fn().mockReturnValue({
                                    limit: vi.fn().mockReturnValue({
                                        offset: vi.fn().mockResolvedValue([]),
                                    }),
                                }),
                            }),
                        }),
                    }),
                });

            const result = await service.getRules('user-123', { page: 1, limit: 10 });

            expect(result.pagination.totalPages).toBe(3);
        });
    });

    describe('findMatchingRule', () => {
        it('should return null when no rules match', async () => {
            const { db } = await import('../../src/db');

            (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockResolvedValue([
                            { id: 'rule-1', keywords: ['price', 'cost'], priority: 10 },
                        ]),
                    }),
                }),
            });

            const result = await service.findMatchingRule('user-123', 'Hello there');
            expect(result).toBeNull();
        });

        it('should match keyword case-insensitively', async () => {
            const { db } = await import('../../src/db');
            const matchingRule = { id: 'rule-1', keywords: ['price', 'cost'], priority: 10 };

            (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockResolvedValue([matchingRule]),
                    }),
                }),
            });

            const result = await service.findMatchingRule('user-123', 'What is the PRICE?');
            expect(result).toEqual(matchingRule);
        });

        it('should return highest priority match', async () => {
            const { db } = await import('../../src/db');
            const highPriorityRule = { id: 'rule-1', keywords: ['price'], priority: 100 };
            const lowPriorityRule = { id: 'rule-2', keywords: ['price'], priority: 10 };

            // Rules should be returned ordered by priority DESC
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockResolvedValue([highPriorityRule, lowPriorityRule]),
                    }),
                }),
            });

            const result = await service.findMatchingRule('user-123', 'price check');
            expect(result).toEqual(highPriorityRule);
        });

        it('should handle rules with null keywords', async () => {
            const { db } = await import('../../src/db');

            (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockResolvedValue([
                            { id: 'rule-1', keywords: null, priority: 10 },
                            { id: 'rule-2', keywords: [], priority: 5 },
                        ]),
                    }),
                }),
            });

            const result = await service.findMatchingRule('user-123', 'any text');
            expect(result).toBeNull();
        });
    });
});
