import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zs, IdParam, CursorQuery, PaginationQuery, ErrorResponse, MessageResponse, auth } from '../../src/utils/swagger';

describe('swagger utilities', () => {
    describe('zs() - Zod to JSON Schema', () => {
        it('should convert a simple Zod object to JSON schema', () => {
            const schema = z.object({ name: z.string(), age: z.number() });
            const result = zs(schema);

            expect(result.type).toBe('object');
            expect(result.properties).toBeDefined();
            expect(result.$schema).toBeUndefined(); // should strip $schema
        });

        it('should strip $schema from output', () => {
            const schema = z.object({ id: z.string() });
            const result = zs(schema);

            expect(result).not.toHaveProperty('$schema');
        });

        it('should handle enum schemas', () => {
            const schema = z.enum(['active', 'inactive', 'pending']);
            const result = zs(schema);

            expect(result.enum).toEqual(['active', 'inactive', 'pending']);
        });
    });

    describe('shared schemas', () => {
        it('IdParam should require id as uuid', () => {
            expect(IdParam.type).toBe('object');
            expect(IdParam.properties.id.format).toBe('uuid');
            expect(IdParam.required).toContain('id');
        });

        it('CursorQuery should have cursor and limit', () => {
            expect(CursorQuery.properties).toHaveProperty('cursor');
            expect(CursorQuery.properties).toHaveProperty('limit');
            expect(CursorQuery.properties.limit.maximum).toBe(100);
        });

        it('PaginationQuery should have page and limit with defaults', () => {
            expect(PaginationQuery.properties.page.default).toBe(1);
            expect(PaginationQuery.properties.limit.default).toBe(20);
        });

        it('ErrorResponse should have error, message, and code fields', () => {
            expect(ErrorResponse.properties).toHaveProperty('error');
            expect(ErrorResponse.properties).toHaveProperty('message');
            expect(ErrorResponse.properties).toHaveProperty('code');
            expect(ErrorResponse.properties).toHaveProperty('details');
        });

        it('MessageResponse should have message field', () => {
            expect(MessageResponse.properties).toHaveProperty('message');
        });

        it('auth should be bearerAuth security scheme', () => {
            expect(auth).toEqual([{ bearerAuth: [] }]);
        });
    });
});
