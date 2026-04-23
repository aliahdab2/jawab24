import { renderHook, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

let mockIsReady = true;
let mockQuery: Record<string, string | string[] | undefined> = {};
const mockReplace = vi.fn().mockResolvedValue(true);
const mockHistoryReplace = vi.fn();

vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: mockIsReady,
    query: mockQuery,
    pathname: '/messages',
    replace: mockReplace,
  }),
}));

Object.defineProperty(window, 'location', {
  value: { search: '', pathname: '/messages', hash: '' },
  writable: true,
});

Object.defineProperty(window.history, 'replaceState', {
  value: (...args: unknown[]) => mockHistoryReplace(...args),
  writable: true,
});

async function mount() {
  const { useDeepLinkParam } = await import('@/hooks/useDeepLinkParam');
  return renderHook(({ name }: { name: string }) => useDeepLinkParam(name), {
    initialProps: { name: 'messageId' },
  });
}

describe('useDeepLinkParam', () => {
  beforeEach(() => {
    mockIsReady = true;
    mockQuery = {};
    mockReplace.mockClear();
    mockHistoryReplace.mockClear();
    (window.location as { search: string; pathname: string; hash: string }).search = '';
    (window.location as { search: string; pathname: string; hash: string }).pathname = '/messages';
    (window.location as { search: string; pathname: string; hash: string }).hash = '';
  });

  it('returns null when the param is absent', async () => {
    const { result } = await mount();
    expect(result.current).toBeNull();
    expect(mockHistoryReplace).not.toHaveBeenCalled();
  });

  it('returns null while router is not ready', async () => {
    mockIsReady = false;
    mockQuery = { messageId: 'abc' };
    const { result } = await mount();
    expect(result.current).toBeNull();
    expect(mockHistoryReplace).not.toHaveBeenCalled();
  });

  it('captures the param value and strips it from the URL', async () => {
    mockQuery = { messageId: 'msg-123' };
    (window.location as { search: string }).search = '?messageId=msg-123&filter=all';

    const { result } = await mount();

    await waitFor(() => expect(result.current).toBe('msg-123'));
    expect(mockHistoryReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
    const newUrl = mockHistoryReplace.mock.calls[0][2] as string;
    expect(newUrl).toBe('/messages?filter=all');
  });

  it('does not re-capture after the param is consumed', async () => {
    mockQuery = { messageId: 'msg-1' };
    (window.location as { search: string }).search = '?messageId=msg-1';
    const { result, rerender } = await mount();

    await waitFor(() => expect(result.current).toBe('msg-1'));
    expect(mockHistoryReplace).toHaveBeenCalledTimes(1);

    // Simulate the URL change taking effect — param is now gone.
    mockQuery = {};
    (window.location as { search: string }).search = '';
    rerender({ name: 'messageId' });

    expect(result.current).toBe('msg-1');
    expect(mockHistoryReplace).toHaveBeenCalledTimes(1);
  });

  it('ignores array-valued params (Next.js can produce these for duplicate keys)', async () => {
    mockQuery = { messageId: ['a', 'b'] };
    const { result } = await mount();
    expect(result.current).toBeNull();
    expect(mockHistoryReplace).not.toHaveBeenCalled();
  });

  it('re-fires when the param changes to a new value (second notification tap)', async () => {
    mockQuery = { messageId: 'msg-1' };
    (window.location as { search: string }).search = '?messageId=msg-1';
    const { result, rerender } = await mount();

    await waitFor(() => expect(result.current).toBe('msg-1'));
    expect(mockHistoryReplace).toHaveBeenCalledTimes(1);

    // URL strip takes effect.
    mockQuery = {};
    (window.location as { search: string }).search = '';
    rerender({ name: 'messageId' });
    expect(result.current).toBe('msg-1');

    // User taps a different notification — new messageId arrives.
    mockQuery = { messageId: 'msg-2' };
    (window.location as { search: string }).search = '?messageId=msg-2';
    rerender({ name: 'messageId' });

    await waitFor(() => expect(result.current).toBe('msg-2'));
    expect(mockHistoryReplace).toHaveBeenCalledTimes(2);
  });
});
