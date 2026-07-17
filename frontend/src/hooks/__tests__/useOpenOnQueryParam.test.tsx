import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useOpenOnQueryParam } from '../useOpenOnQueryParam';

// Local router mock with mutable state — the global setup mock returns a fresh
// static object per call, which can't be asserted against or varied per test.
let mockQuery: Record<string, string> = {};
let mockIsReady = true;
const mockReplace = vi.fn();
vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: mockIsReady,
    query: mockQuery,
    pathname: '/comments',
    replace: mockReplace,
  }),
}));

function Probe({ ready, onTrigger }: { ready: boolean; onTrigger: () => void }) {
  useOpenOnQueryParam('openPostReply', ready, onTrigger);
  return null;
}

describe('useOpenOnQueryParam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery = {};
    mockIsReady = true;
  });

  it('does NOT fire or consume the param while ready=false (the param must survive)', () => {
    mockQuery = { openPostReply: 'true' };
    const onTrigger = vi.fn();
    const { rerender } = render(<Probe ready={false} onTrigger={onTrigger} />);

    expect(onTrigger).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();

    // Ready flips true (e.g. the query settles) → fires exactly once.
    rerender(<Probe ready={true} onTrigger={onTrigger} />);
    expect(onTrigger).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it('strips ONLY the consumed param, preserving other query params', () => {
    // /comments round-trips ?filter and the open ?comment through the URL — a
    // blanket replace(pathname) would silently clobber them (review finding).
    mockQuery = { openPostReply: 'true', filter: 'all', comment: 'c1' };
    render(<Probe ready={true} onTrigger={vi.fn()} />);

    expect(mockReplace).toHaveBeenCalledWith(
      { pathname: '/comments', query: { filter: 'all', comment: 'c1' } },
      undefined,
      { shallow: true },
    );
  });

  it('fires exactly once — re-renders after consumption do not re-trigger', () => {
    mockQuery = { openPostReply: 'true' };
    const onTrigger = vi.fn();
    const { rerender } = render(<Probe ready={true} onTrigger={onTrigger} />);
    rerender(<Probe ready={true} onTrigger={onTrigger} />);
    rerender(<Probe ready={true} onTrigger={onTrigger} />);

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it('ignores absent or non-"true" param values', () => {
    mockQuery = { openPostReply: '1' };
    const onTrigger = vi.fn();
    render(<Probe ready={true} onTrigger={onTrigger} />);

    expect(onTrigger).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('waits for router.isReady before consuming', () => {
    mockIsReady = false;
    mockQuery = { openPostReply: 'true' };
    const onTrigger = vi.fn();
    render(<Probe ready={true} onTrigger={onTrigger} />);

    expect(onTrigger).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
