import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { withOwnerOnly } from './withOwnerOnly';

const mockReplace = vi.fn();
vi.mock('next/router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock('@/lib/store', () => ({
  useAuthStore: vi.fn(),
}));

vi.mock('@/hooks', () => ({
  useOwnerGate: vi.fn(),
}));

import { useAuthStore } from '@/lib/store';
import { useOwnerGate } from '@/hooks';

const mockedUseAuthStore = vi.mocked(useAuthStore);
const mockedUseOwnerGate = vi.mocked(useOwnerGate);

function PageContent() {
  return <div data-testid="page-content">Protected Page</div>;
}
const ProtectedPage = withOwnerOnly(PageContent);

describe('withOwnerOnly', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: store hydrated, not blocked
    mockedUseAuthStore.mockImplementation((selector: (s: { _hasHydrated: boolean }) => boolean) =>
      selector({ _hasHydrated: true })
    );
    mockedUseOwnerGate.mockReturnValue(false);
  });

  it('renders the wrapped component for an owner', () => {
    render(<ProtectedPage />);
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
  });

  it('renders a spinner while store is not yet hydrated', () => {
    mockedUseAuthStore.mockImplementation((selector: (s: { _hasHydrated: boolean }) => boolean) =>
      selector({ _hasHydrated: false })
    );
    render(<ProtectedPage />);
    expect(screen.queryByTestId('page-content')).not.toBeInTheDocument();
    expect(document.querySelector('[role="status"]')).toBeTruthy();
  });

  it('renders a spinner and redirects when user is a member', () => {
    mockedUseOwnerGate.mockReturnValue(true);
    render(<ProtectedPage />);
    expect(screen.queryByTestId('page-content')).not.toBeInTheDocument();
    expect(document.querySelector('[role="status"]')).toBeTruthy();
    expect(mockReplace).toHaveBeenCalledWith('/dashboard');
  });

  it('sets a displayName on the wrapped component', () => {
    expect(ProtectedPage.displayName).toBe('withOwnerOnly(PageContent)');
  });
});
