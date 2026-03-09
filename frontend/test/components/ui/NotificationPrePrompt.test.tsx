import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { NotificationPrePrompt } from '../../../src/components/ui/NotificationPrePrompt';

// Mock i18n
vi.mock('../../../src/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    language: 'en',
  }),
}));

describe('NotificationPrePrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should render title and body text', () => {
    render(<NotificationPrePrompt onEnable={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByText('Stay in the loop')).toBeInTheDocument();
    expect(screen.getByText('Get notified when comments need your attention or when something important happens with your pages.')).toBeInTheDocument();
  });

  it('should render enable and later buttons', () => {
    render(<NotificationPrePrompt onEnable={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByText('Enable notifications')).toBeInTheDocument();
    expect(screen.getByText('Not now')).toBeInTheDocument();
  });

  it('should start invisible and animate in after 100ms', () => {
    const { container } = render(
      <NotificationPrePrompt onEnable={vi.fn()} onDismiss={vi.fn()} />
    );

    const wrapper = container.firstElementChild;
    // Initially invisible (opacity-0)
    expect(wrapper?.className).toContain('opacity-0');

    // After 100ms timer fires, it becomes visible
    act(() => { vi.advanceTimersByTime(100); });
    expect(wrapper?.className).toContain('opacity-100');
  });

  it('should call onEnable after animation delay when enable is clicked', () => {
    const onEnable = vi.fn();
    render(<NotificationPrePrompt onEnable={onEnable} onDismiss={vi.fn()} />);

    // Make visible
    act(() => { vi.advanceTimersByTime(100); });

    fireEvent.click(screen.getByText('Enable notifications'));

    // Should not call immediately (waits 300ms for fade-out animation)
    expect(onEnable).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(300); });
    expect(onEnable).toHaveBeenCalledTimes(1);
  });

  it('should call onDismiss after animation delay when later is clicked', () => {
    const onDismiss = vi.fn();
    render(<NotificationPrePrompt onEnable={vi.fn()} onDismiss={onDismiss} />);

    act(() => { vi.advanceTimersByTime(100); });

    fireEvent.click(screen.getByText('Not now'));

    expect(onDismiss).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(300); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('should call onDismiss when X button is clicked', () => {
    const onDismiss = vi.fn();
    render(<NotificationPrePrompt onEnable={vi.fn()} onDismiss={onDismiss} />);

    act(() => { vi.advanceTimersByTime(100); });

    // The X button is the first button (before enable/later)
    const buttons = screen.getAllByRole('button');
    const xButton = buttons.find(
      b => !b.textContent?.includes('Enable notifications') &&
           !b.textContent?.includes('Not now')
    );
    expect(xButton).toBeDefined();
    fireEvent.click(xButton!);

    act(() => { vi.advanceTimersByTime(300); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('should hide (animate out) when enable is clicked', () => {
    const { container } = render(
      <NotificationPrePrompt onEnable={vi.fn()} onDismiss={vi.fn()} />
    );

    act(() => { vi.advanceTimersByTime(100); });

    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('opacity-100');

    fireEvent.click(screen.getByText('Enable notifications'));

    // Should now be invisible (setVisible(false) was called)
    expect(wrapper?.className).toContain('opacity-0');
  });

  it('should have dir=ltr for English language', () => {
    const { container } = render(
      <NotificationPrePrompt onEnable={vi.fn()} onDismiss={vi.fn()} />
    );

    const wrapper = container.firstElementChild;
    expect(wrapper?.getAttribute('dir')).toBe('ltr');
  });

  it('should have decorative gradient bar', () => {
    const { container } = render(
      <NotificationPrePrompt onEnable={vi.fn()} onDismiss={vi.fn()} />
    );

    const gradientBar = container.querySelector('.bg-gradient-to-r');
    expect(gradientBar).toBeInTheDocument();
  });
});
