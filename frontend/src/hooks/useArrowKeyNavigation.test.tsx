/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useArrowKeyNavigation } from './useArrowKeyNavigation';

function Probe(props: Parameters<typeof useArrowKeyNavigation>[0]) {
  useArrowKeyNavigation(props);
  return (
    <div>
      <textarea data-testid="ta" />
      <input data-testid="inp" />
    </div>
  );
}

describe('useArrowKeyNavigation', () => {
  it('LTR: ArrowRight → next, ArrowLeft → prev', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<Probe onPrev={onPrev} onNext={onNext} />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it('RTL: ArrowLeft → next, ArrowRight → prev', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<Probe onPrev={onPrev} onNext={onNext} rtl />);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it('ignores arrows while typing in a textarea/input', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const { getByTestId } = render(<Probe onPrev={onPrev} onNext={onNext} />);
    (getByTestId('ta') as HTMLTextAreaElement).focus();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    (getByTestId('inp') as HTMLInputElement).focus();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onNext).not.toHaveBeenCalled();
    expect(onPrev).not.toHaveBeenCalled();
  });

  it('ignores non-arrow keys', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<Probe onPrev={onPrev} onNext={onNext} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'a' });
    expect(onNext).not.toHaveBeenCalled();
    expect(onPrev).not.toHaveBeenCalled();
  });

  it('does nothing when disabled', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<Probe enabled={false} onPrev={onPrev} onNext={onNext} />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onNext).not.toHaveBeenCalled();
  });

  it('removes the listener on unmount', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const { unmount } = render(<Probe onPrev={onPrev} onNext={onNext} />);
    unmount();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onNext).not.toHaveBeenCalled();
  });
});
