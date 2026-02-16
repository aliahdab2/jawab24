import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RulesService, PaginatedResult, matchesKeyword } from '../../src/services/rules';

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
                where: vi.fn().mockReturnValue({
                    orderBy: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([]),
                    }),
                }),
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
    asc: vi.fn(),
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
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([
                                { id: 'rule-1', keywords: ['price', 'cost'], priority: 10 },
                            ]),
                        }),
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
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([matchingRule]),
                        }),
                    }),
                }),
            });

            const result = await service.findMatchingRule('user-123', 'What is the PRICE?');
            expect(result).toEqual(matchingRule);
        });

        it('should return first match by ascending priority (top of UI wins)', async () => {
            const { db } = await import('../../src/db');
            const topRule = { id: 'rule-1', keywords: ['price'], priority: 1 };
            const bottomRule = { id: 'rule-2', keywords: ['price'], priority: 10 };

            // Rules returned ordered by priority ASC (low number = top of UI = checked first)
            (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([topRule, bottomRule]),
                        }),
                    }),
                }),
            });

            const result = await service.findMatchingRule('user-123', 'price check');
            expect(result).toEqual(topRule);
        });

        it('should handle rules with null keywords', async () => {
            const { db } = await import('../../src/db');

            (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([
                                { id: 'rule-1', keywords: null, priority: 10 },
                                { id: 'rule-2', keywords: [], priority: 5 },
                            ]),
                        }),
                    }),
                }),
            });

            const result = await service.findMatchingRule('user-123', 'any text');
            expect(result).toBeNull();
        });

        it('should NOT match English keyword as substring (word boundaries)', async () => {
            const { db } = await import('../../src/db');
            const rule = { id: 'rule-1', keywords: ['price'], priority: 10 };

            (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([rule]),
                        }),
                    }),
                }),
            });

            // "price" should NOT match "surprise" or "priceless"
            expect(await service.findMatchingRule('user-123', 'what a surprise')).toBeNull();
            expect(await service.findMatchingRule('user-123', 'priceless art')).toBeNull();
        });

        it('should match English keyword at word boundaries with punctuation', async () => {
            const { db } = await import('../../src/db');
            const rule = { id: 'rule-1', keywords: ['price'], priority: 10 };

            (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([rule]),
                        }),
                    }),
                }),
            });

            expect(await service.findMatchingRule('user-123', 'what is the price?')).toEqual(rule);
            expect(await service.findMatchingRule('user-123', 'price!')).toEqual(rule);
            expect(await service.findMatchingRule('user-123', 'the price, please')).toEqual(rule);
        });

        it('should match multi-word keyword with boundaries', async () => {
            const { db } = await import('../../src/db');
            const rule = { id: 'rule-1', keywords: ['price list'], priority: 10 };

            (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([rule]),
                        }),
                    }),
                }),
            });

            expect(await service.findMatchingRule('user-123', 'send me the price list please')).toEqual(rule);
            expect(await service.findMatchingRule('user-123', 'send pricelist')).toBeNull();
        });

        it('should match Arabic keyword as substring (no word boundaries)', async () => {
            const { db } = await import('../../src/db');
            const rule = { id: 'rule-1', keywords: ['سعر'], priority: 10 };

            (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([rule]),
                        }),
                    }),
                }),
            });

            // Arabic uses substring matching — "سعر" should match inside "الأسعار" or "كم السعر"
            expect(await service.findMatchingRule('user-123', 'كم السعر')).toEqual(rule);
        });

        it('should match Arabic keyword with diacritics normalized', async () => {
            const { db } = await import('../../src/db');
            const rule = { id: 'rule-1', keywords: ['مرحبا'], priority: 10 };

            (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([rule]),
                        }),
                    }),
                }),
            });

            // مَرْحَباً (with diacritics) should match مرحبا (without)
            expect(await service.findMatchingRule('user-123', '\u0645\u064E\u0631\u0652\u062D\u064E\u0628\u064B\u0627')).toEqual(rule);
        });

        it('should match Arabic keyword with alef variants normalized', async () => {
            const { db } = await import('../../src/db');
            const rule = { id: 'rule-1', keywords: ['إسلام'], priority: 10 };

            (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([rule]),
                        }),
                    }),
                }),
            });

            // إسلام and اسلام should match (alef variant normalization)
            expect(await service.findMatchingRule('user-123', 'اسلام عليكم')).toEqual(rule);
        });

        it('should match mixed English/Arabic keyword', async () => {
            const { db } = await import('../../src/db');
            const rule = { id: 'rule-1', keywords: ['iPhone 15'], priority: 10 };

            (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([rule]),
                        }),
                    }),
                }),
            });

            expect(await service.findMatchingRule('user-123', 'do you have iPhone 15?')).toEqual(rule);
        });
    });
});

// --- Pure helper function tests (no DB mocking needed) ---

describe('matchesKeyword', () => {
    // English word boundaries
    it('matches English keyword at word boundary', () => {
        expect(matchesKeyword('what is the price', 'price')).toBe(true);
        expect(matchesKeyword('price!', 'price')).toBe(true);
        expect(matchesKeyword('the price, please', 'price')).toBe(true);
    });

    it('does NOT match English keyword inside another word', () => {
        expect(matchesKeyword('what a surprise', 'price')).toBe(false);
        expect(matchesKeyword('priceless art', 'price')).toBe(false);
    });

    it('matches multi-word English keyword', () => {
        expect(matchesKeyword('send me the price list please', 'price list')).toBe(true);
    });

    it('does NOT match multi-word keyword when concatenated', () => {
        expect(matchesKeyword('send pricelist', 'price list')).toBe(false);
    });

    // Arabic substring matching
    it('matches Arabic keyword as substring', () => {
        expect(matchesKeyword('كم السعر', 'سعر')).toBe(true);
        expect(matchesKeyword('التوصيل متاح', 'توصيل')).toBe(true);
    });

    it('returns false for empty keyword', () => {
        expect(matchesKeyword('any text', '')).toBe(false);
    });

    it('handles special regex characters in keyword safely (no crash)', () => {
        // Keywords with special regex chars should not throw — they get escaped
        // \b only works at word-char boundaries, so $10 won't match via \b
        // but the function must not crash
        expect(() => matchesKeyword('price is $10.00', '$10.00')).not.toThrow();
        expect(() => matchesKeyword('call (555) 123', '(555)')).not.toThrow();
    });
});
