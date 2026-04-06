import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AnnouncementBanner } from './AnnouncementBanner';

const mockPost = vi.fn();
vi.mock('@/lib/api', () => ({
  publicApi: { post: (...args: unknown[]) => mockPost(...args) },
}));

vi.mock('@/lib/sentryHelpers', () => ({
  captureError: vi.fn(),
}));

const defaultProps = {
  title: 'Launching Soon',
  description: 'Join the waitlist!',
  feature: 'launch',
  placeholder: 'Enter your email or phone number',
  buttonLabel: 'Notify Me',
  successMessage: "You're on the list!",
  errorMessage: 'Something went wrong.',
};

describe('AnnouncementBanner', () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it('renders title, description, and form', () => {
    render(<AnnouncementBanner {...defaultProps} />);
    expect(screen.getByText('Launching Soon')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your email or phone number')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notify Me' })).toBeInTheDocument();
  });

  it('submits email to publicApi and shows success message', async () => {
    mockPost.mockResolvedValueOnce({ data: { success: true } });
    render(<AnnouncementBanner {...defaultProps} />);

    fireEvent.change(screen.getByPlaceholderText('Enter your email or phone number'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Notify Me' }));

    await waitFor(() => {
      expect(screen.getByText("You're on the list!")).toBeInTheDocument();
    });

    expect(mockPost).toHaveBeenCalledWith('/waitlist', {
      contact: 'test@example.com',
      feature: 'launch',
    });
  });

  it('shows error message when API call fails', async () => {
    mockPost.mockRejectedValueOnce(new Error('Network error'));
    render(<AnnouncementBanner {...defaultProps} />);

    fireEvent.change(screen.getByPlaceholderText('Enter your email or phone number'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Notify Me' }));

    await waitFor(() => {
      expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
    });

    // Form should still be visible (not replaced by success)
    expect(screen.getByPlaceholderText('Enter your email or phone number')).toBeInTheDocument();
  });

  it('clears error on retry', async () => {
    mockPost.mockRejectedValueOnce(new Error('fail'));
    render(<AnnouncementBanner {...defaultProps} />);

    const input = screen.getByPlaceholderText('Enter your email or phone number');
    fireEvent.change(input, { target: { value: 'test@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Notify Me' }));

    await waitFor(() => {
      expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
    });

    // Retry with success
    mockPost.mockResolvedValueOnce({ data: { success: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Notify Me' }));

    await waitFor(() => {
      expect(screen.queryByText('Something went wrong.')).not.toBeInTheDocument();
    });
  });

  it('disables button while submitting', async () => {
    let resolvePost: (value: unknown) => void;
    mockPost.mockImplementationOnce(() => new Promise((res) => { resolvePost = res; }));
    render(<AnnouncementBanner {...defaultProps} />);

    fireEvent.change(screen.getByPlaceholderText('Enter your email or phone number'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Notify Me' }));

    expect(screen.getByRole('button', { name: 'Notify Me' })).toBeDisabled();

    resolvePost!({ data: { success: true } });

    await waitFor(() => {
      expect(screen.getByText("You're on the list!")).toBeInTheDocument();
    });
  });

  it('prevents double submission after success', async () => {
    mockPost.mockResolvedValueOnce({ data: { success: true } });
    render(<AnnouncementBanner {...defaultProps} />);

    fireEvent.change(screen.getByPlaceholderText('Enter your email or phone number'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Notify Me' }));

    await waitFor(() => {
      expect(screen.getByText("You're on the list!")).toBeInTheDocument();
    });

    // Form should be replaced — no button to click
    expect(screen.queryByRole('button', { name: 'Notify Me' })).not.toBeInTheDocument();
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('uses text input with dir="ltr" in English locale', () => {
    render(<AnnouncementBanner {...defaultProps} />);
    const input = screen.getByPlaceholderText('Enter your email or phone number');
    expect(input).toHaveAttribute('dir', 'ltr');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toBeRequired();
  });
});
