/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { refreshTokenService } from '../services/refreshToken';
import { authService } from '../services/auth';
import { db } from '../db';
import crypto from 'crypto';

// Mock dependencies
vi.mock('../db', () => ({
    db: {
        insert: vi.fn(() => ({ values: vi.fn() })),
        select: vi.fn(),
        update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
    }
}));

vi.mock('../services/auth', () => ({
    authService: {
        getUserById: vi.fn(),
    }
}));

describe('RefreshTokenService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('createRefreshToken', () => {
        it('should create a token, hash it, and store in DB', async () => {
            const mockRawToken = 'mock-raw-token';
            // Mock randomBytes to return predictable value
            vi.spyOn(crypto, 'randomBytes').mockImplementation(() => Buffer.from(mockRawToken));
            
            const result = await refreshTokenService.createRefreshToken('user-123');
            
            expect(result).toBeDefined();
            expect(db.insert).toHaveBeenCalled();
        });
    });

    describe('rotateRefreshToken', () => {
        it('should return null if token not found', async () => {
            vi.mocked(db.select).mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) } as any);

            const result = await refreshTokenService.rotateRefreshToken('invalid-token');
            expect(result).toBeNull();
        });

        it('should return null if token is revoked', async () => {
            const mockRecord = { id: 1, userId: 'u1', revokedAt: new Date(), expiresAt: new Date(Date.now() + 10000) };
            vi.mocked(db.select).mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([mockRecord] as any) }) } as any);

            const result = await refreshTokenService.rotateRefreshToken('valid-token');
            expect(result).toBeNull();
        });

        it('should return null if token is expired', async () => {
            const mockRecord = { id: 1, userId: 'u1', revokedAt: null, expiresAt: new Date(Date.now() - 1000) };
            vi.mocked(db.select).mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([mockRecord] as any) }) } as any);

            const result = await refreshTokenService.rotateRefreshToken('valid-token');
            expect(result).toBeNull();
        });

        it('should rotate token if valid', async () => {
            const mockRecord = { id: 1, userId: 'u1', revokedAt: null, expiresAt: new Date(Date.now() + 10000) };
            vi.mocked(db.select).mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([mockRecord] as any) }) } as any);
            vi.mocked(authService.getUserById).mockResolvedValue({ id: 'u1' } as any);
            
            // Spy on createRefreshToken to return a new token
            const createSpy = vi.spyOn(refreshTokenService, 'createRefreshToken').mockResolvedValue('new-token');

            const result = await refreshTokenService.rotateRefreshToken('valid-token');

            expect(result).toEqual({ 
                user: { id: 'u1' }, 
                newRefreshToken: 'new-token' 
            });
            expect(createSpy).toHaveBeenCalledWith('u1');
        });
    });
});
