import { describe, it, expect } from 'vitest';
import {
    BusinessProfileSchema,
    CreatePlanSchema,
    UpdatePlanSchema,
    UpdateSettingsSchema,
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

    describe('UpdateSettingsSchema', () => {
        it('should accept valid escalation minutes', () => {
            const result = UpdateSettingsSchema.safeParse({
                commentEscalationMinutes: 60,
                messageEscalationMinutes: 30,
            });
            expect(result.success).toBe(true);
        });

        it('should reject escalation minutes below minimum (5)', () => {
            const result = UpdateSettingsSchema.safeParse({
                commentEscalationMinutes: 2,
            });
            expect(result.success).toBe(false);
        });

        it('should reject escalation minutes above maximum (1440)', () => {
            const result = UpdateSettingsSchema.safeParse({
                messageEscalationMinutes: 2000,
            });
            expect(result.success).toBe(false);
        });

        it('should reject non-integer escalation minutes', () => {
            const result = UpdateSettingsSchema.safeParse({
                commentEscalationMinutes: 30.5,
            });
            expect(result.success).toBe(false);
        });

        it('should accept boundary values (5 and 1440)', () => {
            const minResult = UpdateSettingsSchema.safeParse({ commentEscalationMinutes: 5 });
            const maxResult = UpdateSettingsSchema.safeParse({ messageEscalationMinutes: 1440 });
            expect(minResult.success).toBe(true);
            expect(maxResult.success).toBe(true);
        });

        it('should accept all existing settings fields', () => {
            const result = UpdateSettingsSchema.safeParse({
                dashboardLanguage: 'en',
                commentsAutoReply: true,
                replyDelay: 10,
                commentEscalationMinutes: 45,
                messageEscalationMinutes: 15,
            });
            expect(result.success).toBe(true);
        });

        it('should accept notificationsEnabled as boolean', () => {
            const resultTrue = UpdateSettingsSchema.safeParse({
                notificationsEnabled: true,
            });
            const resultFalse = UpdateSettingsSchema.safeParse({
                notificationsEnabled: false,
            });
            expect(resultTrue.success).toBe(true);
            expect(resultFalse.success).toBe(true);
        });

        it('should reject notificationsEnabled with non-boolean value', () => {
            const resultString = UpdateSettingsSchema.safeParse({
                notificationsEnabled: 'true',
            });
            const resultNumber = UpdateSettingsSchema.safeParse({
                notificationsEnabled: 1,
            });
            expect(resultString.success).toBe(false);
            expect(resultNumber.success).toBe(false);
        });

        it('should accept valid IANA timezone', () => {
            const result = UpdateSettingsSchema.safeParse({
                timezone: 'Asia/Riyadh',
            });
            expect(result.success).toBe(true);
        });

        it('should accept various valid timezones', () => {
            const validTimezones = ['America/New_York', 'Europe/London', 'Asia/Dubai', 'UTC', 'Pacific/Auckland'];
            for (const tz of validTimezones) {
                const result = UpdateSettingsSchema.safeParse({ timezone: tz });
                expect(result.success).toBe(true);
            }
        });

        it('should reject invalid timezone string', () => {
            const result = UpdateSettingsSchema.safeParse({
                timezone: 'Invalid/Timezone',
            });
            expect(result.success).toBe(false);
        });

        it('should reject empty timezone string', () => {
            const result = UpdateSettingsSchema.safeParse({
                timezone: '',
            });
            expect(result.success).toBe(false);
        });

        it('should reject timezone exceeding max length', () => {
            const result = UpdateSettingsSchema.safeParse({
                timezone: 'A'.repeat(101),
            });
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

    describe('BusinessProfileSchema', () => {
        it('should validate a full profile', () => {
            const result = BusinessProfileSchema.safeParse({
                name: 'My Shop',
                category: 'Restaurant',
                about: 'Best shawarma in town',
                phone: '+961 1 234 567',
                website: 'https://myshop.com',
                address: '123 Main St',
                city: 'Beirut',
                country: 'Lebanon',
                hours: { mon: ['09:00-18:00'], tue: ['09:00-18:00'] },
                channels: { preferred: 'whatsapp', whatsapp: '+961 1 999 000' },
                language_hint: 'ar',
            });
            expect(result.success).toBe(true);
        });

        it('should accept empty object (all fields optional)', () => {
            const result = BusinessProfileSchema.safeParse({});
            expect(result.success).toBe(true);
        });

        it('should accept partial profile', () => {
            const result = BusinessProfileSchema.safeParse({
                name: 'Cafe',
                phone: '+1 555 1234',
            });
            expect(result.success).toBe(true);
        });

        it('should reject name exceeding max length', () => {
            const result = BusinessProfileSchema.safeParse({
                name: 'A'.repeat(256),
            });
            expect(result.success).toBe(false);
        });

        it('should reject about exceeding max length', () => {
            const result = BusinessProfileSchema.safeParse({
                about: 'A'.repeat(2001),
            });
            expect(result.success).toBe(false);
        });

        it('should reject invalid language_hint', () => {
            const result = BusinessProfileSchema.safeParse({
                language_hint: 'fr',
            });
            expect(result.success).toBe(false);
        });

        it('should reject invalid channel preferred value', () => {
            const result = BusinessProfileSchema.safeParse({
                channels: { preferred: 'email' },
            });
            expect(result.success).toBe(false);
        });

        it('should accept valid hours format', () => {
            const result = BusinessProfileSchema.safeParse({
                hours: {
                    mon: ['09:00-18:00'],
                    tue: ['08:00-12:00', '14:00-18:00'],
                    fri: ['09:00-22:00'],
                },
            });
            expect(result.success).toBe(true);
        });

        it('should allow extra fields from Facebook API (passthrough)', () => {
            const result = BusinessProfileSchema.safeParse({
                name: 'Shop',
                some_facebook_field: 'value',
            });
            expect(result.success).toBe(true);
        });

        it('should work with validateSchema helper', () => {
            const valid = validateSchema(BusinessProfileSchema, { name: 'Test', language_hint: 'en' });
            expect(valid.success).toBe(true);

            const invalid = validateSchema(BusinessProfileSchema, { language_hint: 'xyz' });
            expect(invalid.success).toBe(false);
            if (!invalid.success) {
                expect(invalid.errors[0].field).toBe('language_hint');
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
