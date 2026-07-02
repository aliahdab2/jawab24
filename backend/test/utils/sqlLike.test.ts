import { describe, it, expect } from 'vitest';
import { escapeLike } from '../../src/utils/sqlLike';

describe('escapeLike', () => {
    it('escapes % so a user-typed percent matches literally', () => {
        expect(escapeLike('50%')).toBe('50\\%');
    });

    it('escapes _ so a user-typed underscore matches literally', () => {
        expect(escapeLike('user_name')).toBe('user\\_name');
    });

    it('escapes the escape character itself', () => {
        expect(escapeLike('a\\b')).toBe('a\\\\b');
    });

    it('leaves normal text (incl. Arabic) untouched', () => {
        expect(escapeLike('Mona Albriki')).toBe('Mona Albriki');
        expect(escapeLike('احمد العيورى')).toBe('احمد العيورى');
        expect(escapeLike('+218910000019')).toBe('+218910000019');
    });
});
