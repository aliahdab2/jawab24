import { describe, it, expect } from 'vitest';
import {
    CreatePlanSchema,
    UpdatePlanSchema,
    CreateRuleSchema,
    UpdateRuleSchema,
    CreateTemplateSchema,
    UpdateTemplateSchema,
    PaginationSchema,
    UUIDSchema,
    validateSchema,
    formatValidationErrors,
} from '../../src/utils/validation';
import { z } from 'zod';

describe('Validation Schemas', () => {
    describe('CreatePlanSchema', () => {
        it('should validate a valid plan', () => {
            const validPlan = {
                name: 'Business Plan',
                slug: 'business',
                price: 2999,
                description: 'For growing businesses',
            };
            
            const result = CreatePlanSchema.safeParse(validPlan);
            expect(result.success).toBe(true);
        });

        it('should reject invalid slug format', () => {
            const invalidPlan = {
                name: 'Business Plan',
                slug: 'Business Plan', // Invalid: has spaces and uppercase
                price: 2999,
            };
            
            const result = CreatePlanSchema.safeParse(invalidPlan);
            expect(result.success).toBe(false);
        });

        it('should reject negative price', () => {
            const invalidPlan = {
                name: 'Business Plan',
                slug: 'business',
                price: -100,
            };
            
            const result = CreatePlanSchema.safeParse(invalidPlan);
            expect(result.success).toBe(false);
        });

        it('should validate optional fields', () => {
            const fullPlan = {
                name: 'Pro Plan',
                slug: 'pro',
                price: 9999,
                currency: 'EUR',
                interval: 'year' as const,
                maxPages: 10,
                maxAiRepliesPerMonth: 1000,
                facebookEnabled: true,
                instagramEnabled: true,
                prioritySupport: true,
                trialDays: 14,
            };
            
            const result = CreatePlanSchema.safeParse(fullPlan);
            expect(result.success).toBe(true);
        });

        it('should apply defaults', () => {
            const minimalPlan = {
                name: 'Test',
                slug: 'test',
                price: 0,
            };
            
            const result = CreatePlanSchema.safeParse(minimalPlan);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.currency).toBe('USD');
                expect(result.data.interval).toBe('month');
                expect(result.data.isActive).toBe(true);
            }
        });
    });

    describe('UpdatePlanSchema', () => {
        it('should allow partial updates', () => {
            const partialUpdate = {
                price: 3999,
            };
            
            const result = UpdatePlanSchema.safeParse(partialUpdate);
            expect(result.success).toBe(true);
        });

        it('should allow empty object', () => {
            const result = UpdatePlanSchema.safeParse({});
            expect(result.success).toBe(true);
        });
    });

    describe('CreateRuleSchema', () => {
        it('should validate a valid rule', () => {
            const validRule = {
                name: 'Price Inquiry',
                keywords: ['price', 'cost', 'how much'],
                templateId: '123e4567-e89b-12d3-a456-426614174000',
            };
            
            const result = CreateRuleSchema.safeParse(validRule);
            expect(result.success).toBe(true);
        });

        it('should require at least one keyword', () => {
            const invalidRule = {
                name: 'Empty Rule',
                keywords: [],
                templateId: '123e4567-e89b-12d3-a456-426614174000',
            };
            
            const result = CreateRuleSchema.safeParse(invalidRule);
            expect(result.success).toBe(false);
        });

        it('should validate UUID format for templateId', () => {
            const invalidRule = {
                name: 'Bad Template ID',
                keywords: ['test'],
                templateId: 'not-a-uuid',
            };
            
            const result = CreateRuleSchema.safeParse(invalidRule);
            expect(result.success).toBe(false);
        });

        it('should apply default values', () => {
            const minimalRule = {
                name: 'Test Rule',
                keywords: ['test'],
                templateId: '123e4567-e89b-12d3-a456-426614174000',
            };
            
            const result = CreateRuleSchema.safeParse(minimalRule);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.priority).toBe(0);
                expect(result.data.active).toBe(true);
            }
        });
    });

    describe('CreateTemplateSchema', () => {
        it('should validate a valid template', () => {
            const validTemplate = {
                name: 'Thank You',
                translations: {
                    en: 'Thank you for your comment!',
                    ar: 'شكرا لتعليقك!',
                },
            };
            
            const result = CreateTemplateSchema.safeParse(validTemplate);
            expect(result.success).toBe(true);
        });

        it('should require at least one translation', () => {
            const invalidTemplate = {
                name: 'Empty Template',
                translations: {},
            };
            
            const result = CreateTemplateSchema.safeParse(invalidTemplate);
            expect(result.success).toBe(false);
        });
    });

    describe('PaginationSchema', () => {
        it('should parse valid pagination params', () => {
            const result = PaginationSchema.safeParse({ page: 2, limit: 50 });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.page).toBe(2);
                expect(result.data.limit).toBe(50);
            }
        });

        it('should coerce string values to numbers', () => {
            const result = PaginationSchema.safeParse({ page: '3', limit: '25' });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.page).toBe(3);
                expect(result.data.limit).toBe(25);
            }
        });

        it('should apply defaults', () => {
            const result = PaginationSchema.safeParse({});
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.page).toBe(1);
                expect(result.data.limit).toBe(20);
            }
        });

        it('should reject page less than 1', () => {
            const result = PaginationSchema.safeParse({ page: 0 });
            expect(result.success).toBe(false);
        });

        it('should reject limit greater than 100', () => {
            const result = PaginationSchema.safeParse({ limit: 200 });
            expect(result.success).toBe(false);
        });
    });

    describe('UUIDSchema', () => {
        it('should validate a valid UUID', () => {
            const result = UUIDSchema.safeParse('123e4567-e89b-12d3-a456-426614174000');
            expect(result.success).toBe(true);
        });

        it('should reject invalid UUID', () => {
            const result = UUIDSchema.safeParse('not-a-uuid');
            expect(result.success).toBe(false);
        });

        it('should reject empty string', () => {
            const result = UUIDSchema.safeParse('');
            expect(result.success).toBe(false);
        });
    });

    describe('validateSchema helper', () => {
        it('should return success with data on valid input', () => {
            const schema = z.object({ name: z.string() });
            const result = validateSchema(schema, { name: 'test' });
            
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.name).toBe('test');
            }
        });

        it('should return errors on invalid input', () => {
            const schema = z.object({ name: z.string().min(1) });
            const result = validateSchema(schema, { name: '' });
            
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.errors.length).toBeGreaterThan(0);
                expect(result.errors[0].field).toBe('name');
            }
        });
    });

    describe('formatValidationErrors', () => {
        it('should format Zod errors correctly', () => {
            const schema = z.object({
                name: z.string().min(1, 'Name is required'),
                email: z.string().email('Invalid email'),
            });
            
            const result = schema.safeParse({ name: '', email: 'invalid' });
            expect(result.success).toBe(false);
            
            if (!result.success) {
                const formatted = formatValidationErrors(result.error);
                expect(formatted.length).toBe(2);
                expect(formatted.some(e => e.field === 'name')).toBe(true);
                expect(formatted.some(e => e.field === 'email')).toBe(true);
            }
        });

        it('should handle nested field paths', () => {
            const schema = z.object({
                user: z.object({
                    profile: z.object({
                        age: z.number().min(0),
                    }),
                }),
            });
            
            const result = schema.safeParse({ user: { profile: { age: -1 } } });
            expect(result.success).toBe(false);
            
            if (!result.success) {
                const formatted = formatValidationErrors(result.error);
                expect(formatted[0].field).toBe('user.profile.age');
            }
        });
    });
});
