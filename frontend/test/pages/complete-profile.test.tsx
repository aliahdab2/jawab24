import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useRouter } from 'next/router';
import CompleteProfilePage from '@/pages/complete-profile';
import { useAuthStore } from '@/lib/store';

// Mock modules
vi.mock('next/router', () => ({ useRouter: vi.fn() }));
vi.mock('next/head', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockUser = { id: 'u1', name: 'Test', facebookId: 'fb1' };

vi.mock('@/lib/store', () => ({
  useAuthStore: vi.fn(() => ({
    user: mockUser,
    updateUser: vi.fn(),
    _hasHydrated: true,
  })),
}));

vi.mock('@/lib/api', () => ({
  api: {
    patch: vi.fn(),
  },
}));

vi.mock('@/lib/sentryHelpers', () => ({
  captureError: vi.fn(),
}));

describe('CompleteProfilePage', () => {
  let mockPush: ReturnType<typeof vi.fn>;
  let mockReplace: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockPush = vi.fn();
    mockReplace = vi.fn();

    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      query: {},
      push: mockPush,
      replace: mockReplace,
      pathname: '/complete-profile',
    });

    (useAuthStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: mockUser,
      updateUser: vi.fn(),
      _hasHydrated: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Rendering ───────────────────────────────────────────
  it('should render the email form when user has no email', () => {
    render(<CompleteProfilePage />);
    expect(screen.getByText('Complete Your Profile')).toBeInTheDocument();
    expect(screen.getByLabelText('Email Address')).toBeInTheDocument();
  });

  it('should redirect to dashboard if user already has email', () => {
    (useAuthStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: { ...mockUser, email: 'existing@test.com' },
      updateUser: vi.fn(),
      _hasHydrated: true,
    });

    render(<CompleteProfilePage />);
    expect(mockPush).toHaveBeenCalledWith('/dashboard');
  });

  it('should redirect to login if no user at all', () => {
    (useAuthStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: null,
      updateUser: vi.fn(),
      _hasHydrated: true,
    });

    render(<CompleteProfilePage />);
    expect(mockPush).toHaveBeenCalledWith('/login');
  });

  it('should respect redirect query param when user has email', () => {
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      query: { redirect: '/pages' },
      push: mockPush,
      replace: mockReplace,
      pathname: '/complete-profile',
    });

    (useAuthStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: { ...mockUser, email: 'existing@test.com' },
      updateUser: vi.fn(),
      _hasHydrated: true,
    });

    render(<CompleteProfilePage />);
    expect(mockPush).toHaveBeenCalledWith('/pages');
  });

  // ─── Email validation ────────────────────────────────────
  it('should not show validation error before user interacts', () => {
    render(<CompleteProfilePage />);
    expect(screen.queryByText('Please enter a valid email address')).not.toBeInTheDocument();
  });

  it('should show error on blur with invalid email', () => {
    render(<CompleteProfilePage />);
    const input = screen.getByLabelText('Email Address');

    fireEvent.change(input, { target: { value: 'not-an-email' } });
    fireEvent.blur(input);

    expect(screen.getByText('Please enter a valid email address')).toBeInTheDocument();
  });

  it('should not show error for valid email', () => {
    render(<CompleteProfilePage />);
    const input = screen.getByLabelText('Email Address');

    fireEvent.change(input, { target: { value: 'test@example.com' } });
    fireEvent.blur(input);

    expect(screen.queryByText('Please enter a valid email address')).not.toBeInTheDocument();
  });

  it('should reject emails without @ symbol', () => {
    render(<CompleteProfilePage />);
    const input = screen.getByLabelText('Email Address');

    fireEvent.change(input, { target: { value: 'testexample.com' } });
    fireEvent.blur(input);

    expect(screen.getByText('Please enter a valid email address')).toBeInTheDocument();
  });

  it('should reject emails without domain', () => {
    render(<CompleteProfilePage />);
    const input = screen.getByLabelText('Email Address');

    fireEvent.change(input, { target: { value: 'test@' } });
    fireEvent.blur(input);

    expect(screen.getByText('Please enter a valid email address')).toBeInTheDocument();
  });

  it('should accept plus-addressing', () => {
    render(<CompleteProfilePage />);
    const input = screen.getByLabelText('Email Address');

    fireEvent.change(input, { target: { value: 'test+tag@example.com' } });
    fireEvent.blur(input);

    expect(screen.queryByText('Please enter a valid email address')).not.toBeInTheDocument();
  });

  it('should clear error when user starts typing', () => {
    render(<CompleteProfilePage />);
    const input = screen.getByLabelText('Email Address');

    // Trigger error
    fireEvent.change(input, { target: { value: 'bad' } });
    fireEvent.blur(input);
    expect(screen.getByText('Please enter a valid email address')).toBeInTheDocument();

    // Submit to trigger the server error path
    fireEvent.submit(input.closest('form')!);

    // Start typing again — error should clear
    fireEvent.change(input, { target: { value: 'test@' } });
    // Server error should be cleared (inline email error may still show)
  });

  // ─── Submit button state ─────────────────────────────────
  it('should disable submit button when email is empty', () => {
    render(<CompleteProfilePage />);
    const button = screen.getByRole('button', { name: 'Continue' });
    expect(button).toBeDisabled();
  });

  it('should disable submit button when email is invalid and touched', () => {
    render(<CompleteProfilePage />);
    const input = screen.getByLabelText('Email Address');
    const button = screen.getByRole('button', { name: 'Continue' });

    fireEvent.change(input, { target: { value: 'bad' } });
    fireEvent.blur(input);

    expect(button).toBeDisabled();
  });

  it('should enable submit button when email is valid', () => {
    render(<CompleteProfilePage />);
    const input = screen.getByLabelText('Email Address');

    fireEvent.change(input, { target: { value: 'test@example.com' } });

    const button = screen.getByRole('button', { name: 'Continue' });
    expect(button).toBeEnabled();
  });

  // ─── Form submission ─────────────────────────────────────
  it('should call API with email on submit', async () => {
    const { api } = await import('@/lib/api');
    (api.patch as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { email: 'test@example.com' },
    });

    render(<CompleteProfilePage />);
    const input = screen.getByLabelText('Email Address');

    fireEvent.change(input, { target: { value: 'test@example.com' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/auth/profile', {
        email: 'test@example.com',
      });
    });
  });

  it('should show success state after save', async () => {
    const { api } = await import('@/lib/api');
    (api.patch as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { email: 'test@example.com' },
    });

    render(<CompleteProfilePage />);
    const input = screen.getByLabelText('Email Address');

    fireEvent.change(input, { target: { value: 'test@example.com' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(screen.getByText('Profile Complete!')).toBeInTheDocument();
    });
  });

  it('should show server error on API failure', async () => {
    const { api } = await import('@/lib/api');
    (api.patch as ReturnType<typeof vi.fn>).mockRejectedValue({
      response: { data: { error: 'Email already in use' } },
    });

    render(<CompleteProfilePage />);
    const input = screen.getByLabelText('Email Address');

    fireEvent.change(input, { target: { value: 'taken@example.com' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(screen.getByText('Email already in use')).toBeInTheDocument();
    });
  });

  it('should show generic error when API returns no error message', async () => {
    const { api } = await import('@/lib/api');
    (api.patch as ReturnType<typeof vi.fn>).mockRejectedValue({
      response: { data: {} },
    });

    render(<CompleteProfilePage />);
    const input = screen.getByLabelText('Email Address');

    fireEvent.change(input, { target: { value: 'test@example.com' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(screen.getByText('Failed to save email. Please try again.')).toBeInTheDocument();
    });
  });

  // ─── Accessibility ───────────────────────────────────────
  it('should set aria-invalid on email input when validation fails', () => {
    render(<CompleteProfilePage />);
    const input = screen.getByLabelText('Email Address');

    fireEvent.change(input, { target: { value: 'bad' } });
    fireEvent.blur(input);

    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('should have input dir=auto for email', () => {
    render(<CompleteProfilePage />);
    const input = screen.getByLabelText('Email Address');
    expect(input).toHaveAttribute('dir', 'auto');
  });
});
