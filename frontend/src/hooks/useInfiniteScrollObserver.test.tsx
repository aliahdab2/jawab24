/**
 * @vitest-environment jsdom
 */
import React, { useRef } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { useInfiniteScrollObserver } from './useInfiniteScrollObserver';

type IOCallback = (entries: IntersectionObserverEntry[]) => void;

// Controllable IntersectionObserver — jsdom doesn't provide one. Records every
// instance so a test can assert whether the hook even started observing, and
// lets us drive the intersection callback by hand.
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: IOCallback;
  disconnected = false;

  constructor(cb: IOCallback) {
    this.callback = cb;
    MockIntersectionObserver.instances.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
  trigger(isIntersecting: boolean): void {
    this.callback([{ isIntersecting } as IntersectionObserverEntry]);
  }
}

function Probe(props: {
  fetchNextPage: () => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  enabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useInfiniteScrollObserver({
    targetRef: ref,
    hasNextPage: props.hasNextPage ?? true,
    isFetchingNextPage: props.isFetchingNextPage ?? false,
    fetchNextPage: props.fetchNextPage,
    enabled: props.enabled,
  });
  return <div ref={ref} data-testid="sentinel" />;
}

describe('useInfiniteScrollObserver', () => {
  beforeEach(() => {
    MockIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver as unknown as typeof IntersectionObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the next page when the sentinel intersects', () => {
    const fetchNextPage = vi.fn();
    render(<Probe fetchNextPage={fetchNextPage} />);
    expect(MockIntersectionObserver.instances).toHaveLength(1);
    MockIntersectionObserver.instances[0].trigger(true);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  // Regression: with a client-side search active the list shrinks but the server
  // still has pages. Before the `enabled` gate the sentinel stayed in view and the
  // observer paged through the whole dataset, flooding the network/console.
  it('never observes while disabled (active-search case)', () => {
    const fetchNextPage = vi.fn();
    render(<Probe fetchNextPage={fetchNextPage} enabled={false} />);
    expect(MockIntersectionObserver.instances).toHaveLength(0);
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it('does not observe when there is no next page', () => {
    const fetchNextPage = vi.fn();
    render(<Probe fetchNextPage={fetchNextPage} hasNextPage={false} />);
    expect(MockIntersectionObserver.instances).toHaveLength(0);
  });

  it('does not observe while a page fetch is already in flight', () => {
    const fetchNextPage = vi.fn();
    render(<Probe fetchNextPage={fetchNextPage} isFetchingNextPage />);
    expect(MockIntersectionObserver.instances).toHaveLength(0);
  });

  it('does not fetch on a non-intersecting callback', () => {
    const fetchNextPage = vi.fn();
    render(<Probe fetchNextPage={fetchNextPage} />);
    MockIntersectionObserver.instances[0].trigger(false);
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it('disconnects the observer on unmount', () => {
    const fetchNextPage = vi.fn();
    const { unmount } = render(<Probe fetchNextPage={fetchNextPage} />);
    const io = MockIntersectionObserver.instances[0];
    unmount();
    expect(io.disconnected).toBe(true);
  });
});
