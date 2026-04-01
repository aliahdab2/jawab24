import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PauseToggle } from '../../../src/components/ui/PauseToggle';
import enMessages from '../../../src/i18n/en/messages.json';

describe('PauseToggle', () => {
  it('renders pause button when not paused', () => {
    render(<PauseToggle paused={false} loading={false} onToggle={() => {}} />);
    expect(screen.getByText(enMessages.pauseSmartReply)).toBeInTheDocument();
  });

  it('renders resume button when paused', () => {
    render(<PauseToggle paused={true} loading={false} onToggle={() => {}} />);
    expect(screen.getByText(enMessages.resumeSmartReply)).toBeInTheDocument();
  });

  it('shows scope hint', () => {
    render(<PauseToggle paused={false} loading={false} onToggle={() => {}} />);
    expect(screen.getByText(enMessages.pauseScope)).toBeInTheDocument();
  });

  it('shows remaining minutes when paused', () => {
    render(<PauseToggle paused={true} remainingMinutes={15} loading={false} onToggle={() => {}} />);
    expect(screen.getByText('15 min remaining')).toBeInTheDocument();
  });

  it('hides remaining minutes when not paused', () => {
    render(<PauseToggle paused={false} remainingMinutes={15} loading={false} onToggle={() => {}} />);
    expect(screen.queryByText('15 min remaining')).not.toBeInTheDocument();
  });

  it('calls onToggle when clicked', () => {
    const onToggle = vi.fn();
    render(<PauseToggle paused={false} loading={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByText(enMessages.pauseSmartReply));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('disables button when loading', () => {
    render(<PauseToggle paused={false} loading={true} onToggle={() => {}} />);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });

  it('sets correct aria-label when paused', () => {
    render(<PauseToggle paused={true} loading={false} onToggle={() => {}} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', enMessages.resumeSmartReply);
  });

  it('sets correct aria-label when not paused', () => {
    render(<PauseToggle paused={false} loading={false} onToggle={() => {}} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', enMessages.pauseSmartReply);
  });
});
