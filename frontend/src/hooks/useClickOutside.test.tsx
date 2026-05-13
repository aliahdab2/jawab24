/**
 * @vitest-environment jsdom
 */
import React, { useRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useClickOutside } from './useClickOutside';

function Probe({ onOutside, enabled = true }: { onOutside: () => void; enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onOutside, enabled);
  return (
    <div>
      <div ref={ref} data-testid="inside">
        <button data-testid="inside-child">inside</button>
      </div>
      <button data-testid="outside">outside</button>
    </div>
  );
}

describe('useClickOutside', () => {
  it('fires when pointerdown lands outside the ref', () => {
    const onOutside = vi.fn();
    const { getByTestId } = render(<Probe onOutside={onOutside} />);
    fireEvent.pointerDown(getByTestId('outside'));
    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  it('does not fire when pointerdown lands inside the ref', () => {
    const onOutside = vi.fn();
    const { getByTestId } = render(<Probe onOutside={onOutside} />);
    fireEvent.pointerDown(getByTestId('inside-child'));
    expect(onOutside).not.toHaveBeenCalled();
  });

  it('does not fire when disabled', () => {
    const onOutside = vi.fn();
    const { getByTestId } = render(<Probe onOutside={onOutside} enabled={false} />);
    fireEvent.pointerDown(getByTestId('outside'));
    expect(onOutside).not.toHaveBeenCalled();
  });

  it('cleans up the listener on unmount', () => {
    const onOutside = vi.fn();
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(<Probe onOutside={onOutside} />);
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function));
    removeSpy.mockRestore();
  });
});
