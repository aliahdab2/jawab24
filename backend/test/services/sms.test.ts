import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/config', () => ({
    config: {
        vonage: {
            apiKey: 'test_key',
            apiSecret: 'test_secret',
            senderId: 'Jawab24',
        },
    },
}));

import { SmsService } from '../../src/services/sms';

describe('SmsService', () => {
    let smsService: SmsService;
    const originalEnv = process.env.NODE_ENV;

    beforeEach(() => {
        smsService = new SmsService();
        vi.resetAllMocks();
    });

    afterEach(() => {
        process.env.NODE_ENV = originalEnv;
    });

    describe('development mode', () => {
        it('should console.log and return without calling Vonage', async () => {
            process.env.NODE_ENV = 'development';
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            const fetchSpy = vi.spyOn(global, 'fetch');

            await smsService.send('+966500000000', 'Test message');

            expect(consoleSpy).toHaveBeenCalledWith('[SMS] +966500000000: Test message');
            expect(fetchSpy).not.toHaveBeenCalled();

            consoleSpy.mockRestore();
        });
    });

    describe('production mode', () => {
        beforeEach(() => {
            process.env.NODE_ENV = 'test';
        });

        it('should call Vonage API with correct payload', async () => {
            const mockResponse = {
                ok: true,
                json: vi.fn().mockResolvedValue({
                    messages: [{ status: '0' }],
                }),
            };
            vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

            await smsService.send('+966500000000', 'رمز التحقق: 123456');

            expect(global.fetch).toHaveBeenCalledWith(
                'https://rest.nexmo.com/sms/json',
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        api_key: 'test_key',
                        api_secret: 'test_secret',
                        from: 'Jawab24',
                        to: '966500000000',
                        text: 'رمز التحقق: 123456',
                        type: 'unicode',
                    }),
                })
            );
        });

        it('should send type=unicode so Arabic characters are not garbled', async () => {
            // Arabic SMS requires UCS-2 encoding via type='unicode'.
            // If this is removed, Arabic text arrives as ????? on the recipient's phone.
            const mockResponse = {
                ok: true,
                json: vi.fn().mockResolvedValue({ messages: [{ status: '0' }] }),
            };
            vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

            await smsService.send('+966500000000', 'جواب24: رمز التحقق 123456');

            const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
            expect(body.type).toBe('unicode');
        });

        it('should strip leading + from phone number', async () => {
            const mockResponse = {
                ok: true,
                json: vi.fn().mockResolvedValue({
                    messages: [{ status: '0' }],
                }),
            };
            vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

            await smsService.send('+46700000000', 'code');

            const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
            expect(body.to).toBe('46700000000');
        });

        it('should throw on non-2xx HTTP response', async () => {
            const mockResponse = { ok: false, status: 503 };
            vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

            await expect(smsService.send('+966500000000', 'msg')).rejects.toThrow('Vonage HTTP error: 503');
        });

        it('should throw on Vonage delivery error (non-zero status)', async () => {
            const mockResponse = {
                ok: true,
                json: vi.fn().mockResolvedValue({
                    messages: [{ status: '4', 'error-text': 'Invalid credentials' }],
                }),
            };
            vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

            await expect(smsService.send('+966500000000', 'msg')).rejects.toThrow(
                'Vonage delivery error: Invalid credentials'
            );
        });

        it('should throw with "unknown" when error-text is missing', async () => {
            const mockResponse = {
                ok: true,
                json: vi.fn().mockResolvedValue({
                    messages: [{ status: '5' }],
                }),
            };
            vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

            await expect(smsService.send('+966500000000', 'msg')).rejects.toThrow(
                'Vonage delivery error: unknown'
            );
        });

        it('should silently return when API credentials are not configured', async () => {
            vi.resetModules();
            vi.doMock('../../src/config', () => ({
                config: {
                    vonage: { apiKey: '', apiSecret: '', senderId: 'Jawab24' },
                },
            }));

            const { SmsService: UnconfiguredSmsService } = await import('../../src/services/sms');
            const unconfiguredService = new UnconfiguredSmsService();
            const fetchSpy = vi.spyOn(global, 'fetch');

            await expect(unconfiguredService.send('+966500000000', 'msg')).resolves.toBeUndefined();
            expect(fetchSpy).not.toHaveBeenCalled();
        });
    });
});
