import { renderHook, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

let mockIsReady = true;
let mockQuery: Record<string, string | string[] | undefined> = {};
const mockReplace = vi.fn().mockResolvedValue(true);

vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: mockIsReady,
    query: mockQuery,
    pathname: '/messages',
    replace: mockReplace,
  }),
}));

Object.defineProperty(window, 'location', {
  value: { search: '' },
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
    (window.location as { search: string }).search = '';
  });

  it('returns null when the param is absent', async () => {
    const { result } = await mount();
    expect(result.current).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('returns null while router is not ready', async () => {
    mockIsReady = false;
    mockQuery = { messageId: 'abc' };
    const { result } = await mount();
    expect(result.current).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('captures the param value and strips it from the URL', async () => {
    mockQuery = { messageId: 'msg-123' };
    (window.location as { search: string }).search = '?messageId=msg-123&filter=all';

    const { result } = await mount();

    await waitFor(() => expect(result.current).toBe('msg-123'));
    expect(mockReplace).toHaveBeenCalledTimes(1);
    const replaceArg = mockReplace.mock.calls[0][0] as { pathname: string; query: Record<string, string> };
    expect(replaceArg.pathname).toBe('/messages');
    expect(replaceArg.query.messageId).toBeUndefined();
    expect(replaceArg.query.filter).toBe('all');
  });

  it('does not re-capture after the param is consumed', async () => {
    mockQuery = { messageId: 'msg-1' };
    (window.location as { search: string }).search = '?messageId=msg-1';
    const { result, rerender } = await mount();

    await waitFor(() => expect(result.current).toBe('msg-1'));
    expect(mockReplace).toHaveBeenCalledTimes(1);

    // Simulate the URL change taking effect — param is now gone.
    mockQuery = {};
    (window.location as { search: string }).search = '';
    rerender({ name: 'messageId' });

    expect(result.current).toBe('msg-1');
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it('ignores array-valued params (Next.js can produce these for duplicate keys)', async () => {
    mockQuery = { messageId: ['a', 'b'] };
    const { result } = await mount();
    expect(result.current).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('re-fires when the param changes to a new value (second notification tap)', async () => {
    mockQuery = { messageId: 'msg-1' };
    (window.location as { search: string }).search = '?messageId=msg-1';
    const { result, rerender } = await mount();

    await waitFor(() => expect(result.current).toBe('msg-1'));
    expect(mockReplace).toHaveBeenCalledTimes(1);

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
    expect(mockReplace).toHaveBeenCalledTimes(2);
  });
});
