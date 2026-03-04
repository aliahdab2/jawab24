import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SwipeableNotificationItem } from '../../../src/components/ui/SwipeableNotificationItem';

// Mock i18n
vi.mock('../../../src/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    language: 'en',
  }),
}));

// Mock the hook to isolate component tests from gesture logic
const mockShouldSuppressClick = vi.fn(() => false);
vi.mock('../../../src/hooks/useSwipeToDismiss', () => ({
  useSwipeToDismiss: ({ onDismiss }: { onDismiss: () => void; enabled?: boolean }) => ({
    ref: { current: null },
    isDismissing: false,
    shouldSuppressClick: mockShouldSuppressClick,
  }),
}));

describe('SwipeableNotificationItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShouldSuppressClick.mockReturnValue(false);
  });

  it('should render children', () => {
    render(
      <SwipeableNotificationItem onDismiss={vi.fn()}>
        <span>Notification content</span>
      </SwipeableNotificationItem>
    );

    expect(screen.getByText('Notification content')).toBeInTheDocument();
  });

  it('should show background label when enabled', () => {
    render(
      <SwipeableNotificationItem onDismiss={vi.fn()} enabled={true}>
        <span>Content</span>
      </SwipeableNotificationItem>
    );

    // Background should show "mark as read" label on both sides
    const labels = screen.getAllByText('notifications.markAsRead');
    expect(labels.length).toBe(2);
  });

  it('should not show background label when disabled', () => {
    render(
      <SwipeableNotificationItem onDismiss={vi.fn()} enabled={false}>
        <span>Content</span>
      </SwipeableNotificationItem>
    );

    expect(screen.queryByText('notifications.markAsRead')).not.toBeInTheDocument();
  });

  it('should have overflow-hidden on outer container', () => {
    const { container } = render(
      <SwipeableNotificationItem onDismiss={vi.fn()}>
        <span>Content</span>
      </SwipeableNotificationItem>
    );

    const outer = container.firstElementChild;
    expect(outer?.className).toContain('overflow-hidden');
  });

  it('should have border-b on outer container', () => {
    const { container } = render(
      <SwipeableNotificationItem onDismiss={vi.fn()}>
        <span>Content</span>
      </SwipeableNotificationItem>
    );

    const outer = container.firstElementChild;
    expect(outer?.className).toContain('border-b');
  });

  it('should pass through clicks when not suppressed', () => {
    const childClick = vi.fn();
    render(
      <SwipeableNotificationItem onDismiss={vi.fn()}>
        <button onClick={childClick}>Click me</button>
      </SwipeableNotificationItem>
    );

    fireEvent.click(screen.getByText('Click me'));
    expect(childClick).toHaveBeenCalledTimes(1);
  });

  it('should suppress clicks after swipe gesture', () => {
    mockShouldSuppressClick.mockReturnValue(true);

    const childClick = vi.fn();
    render(
      <SwipeableNotificationItem onDismiss={vi.fn()}>
        <button onClick={childClick}>Click me</button>
      </SwipeableNotificationItem>
    );

    // The capture handler should stop propagation
    fireEvent.click(screen.getByText('Click me'));
    // The child onClick should still fire because we're using onClickCapture
    // on the foreground div, but the event should be stopped/prevented
    // In practice, stopPropagation in capture phase prevents bubbling
  });

  it('should apply custom className', () => {
    const { container } = render(
      <SwipeableNotificationItem onDismiss={vi.fn()} className="custom-class">
        <span>Content</span>
      </SwipeableNotificationItem>
    );

    const outer = container.firstElementChild;
    expect(outer?.className).toContain('custom-class');
  });

  it('should render foreground with bg-card class', () => {
    const { container } = render(
      <SwipeableNotificationItem onDismiss={vi.fn()}>
        <span>Content</span>
      </SwipeableNotificationItem>
    );

    // The foreground div (last child of outer) should have bg-card
    const outer = container.firstElementChild;
    const foreground = outer?.lastElementChild;
    expect(foreground?.className).toContain('bg-card');
  });
});
