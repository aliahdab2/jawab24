import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * isConfigured() is the feature gate: the picker is hidden and uploads are rejected
 * unless every required S3 var is set. We verify both states by re-importing the
 * module under different env (config reads env at import time).
 */
describe('imageStorage.isConfigured', () => {
    beforeEach(() => { vi.resetModules(); });

    it('is false when required S3 vars are missing', async () => {
        vi.stubEnv('S3_BUCKET', '');
        vi.stubEnv('S3_ACCESS_KEY_ID', '');
        vi.stubEnv('S3_SECRET_ACCESS_KEY', '');
        vi.stubEnv('S3_PUBLIC_BASE_URL', '');
        const { imageStorage } = await import('../../src/services/imageStorage');
        expect(imageStorage.isConfigured()).toBe(false);
        vi.unstubAllEnvs();
    });

    it('is true when every required S3 var is set', async () => {
        vi.stubEnv('S3_BUCKET', 'jawab-media');
        vi.stubEnv('S3_ACCESS_KEY_ID', 'key');
        vi.stubEnv('S3_SECRET_ACCESS_KEY', 'secret');
        vi.stubEnv('S3_PUBLIC_BASE_URL', 'https://jawab24.com/media');
        const { imageStorage } = await import('../../src/services/imageStorage');
        expect(imageStorage.isConfigured()).toBe(true);
        vi.unstubAllEnvs();
    });
});
