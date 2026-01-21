import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios, { AxiosInstance } from 'axios';
import { setupAuthRefreshInterceptor } from '../lib/authInterceptor';

describe('AuthInterceptor', () => {
    let api: AxiosInstance;
    let refreshFn: any;

    beforeEach(() => {
        api = axios.create();
        refreshFn = vi.fn();
        setupAuthRefreshInterceptor(api, refreshFn);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should pass through successful requests', async () => {
        // Mock adapter to return success
        // @ts-expect-error - Mocking internal adapter
        api.defaults.adapter = async (config) => {
            return {
                data: 'ok',
                status: 200,
                statusText: 'OK',
                headers: {},
                config,
            };
        };

        const response = await api.get('/test');
        expect(response.data).toEqual('ok');
        expect(refreshFn).not.toHaveBeenCalled();
    });

    it('should ignore 401 on login/refresh endpoints', async () => {
        const error = {
            config: { url: '/auth/login' },
            response: { status: 401 }
        };

        // Simulate interceptor chain
        try {
            // @ts-expect-error - Accessing internal handlers
            await api.interceptors.response.handlers[0].rejected(error);
        } catch (e) {
            expect(e).toBe(error);
        }
        expect(refreshFn).not.toHaveBeenCalled();
    });
});
