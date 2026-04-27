import { screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import AcceptInvitePage from '../../../src/pages/invites/accept';

// -- Mocks --

const mockAcceptInvite = vi.fn();
const mockPush = vi.fn();
const mockReplace = vi.fn();

let mockRouterState = {
  push: mockPush,
  replace: mockReplace,
  pathname: '/invites/accept',
  query: { token: 'valid-token-123' } as Record<string, string>,
  asPath: '/invites/accept',
  isReady: true,
};

vi.mock('@/lib/api', () => ({
  workspaceApi: {
    acceptInvite: (...args: unknown[]) => mockAcceptInvite(...args),
  },
}));

vi.mock('@/lib/sentryHelpers', () => ({
  captureError: vi.fn(),
}));

let mockIsAuthenticated = true;
const mockSetWorkspaces = vi.fn();
const mockSetActiveWorkspace = vi.fn();

vi.mock('@/lib/store', () => ({
  useAuthStore: vi.fn((selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      isAuthenticated: mockIsAuthenticated,
      setWorkspaces: mockSetWorkspaces,
      setActiveWorkspace: mockSetActiveWorkspace,
    };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('next/router', () => ({
  useRouter: () => mockRouterState,
}));

vi.mock('../../../src/components/layout/DashboardLayout', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// -- Helpers --

function renderAcceptPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AcceptInvitePage />
    </QueryClientProvider>
  );
}

describe('AcceptInvitePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAuthenticated = true;
    mockRouterState = {
      push: mockPush,
      replace: mockReplace,
      pathname: '/invites/accept',
      query: { token: 'valid-token-123' },
      asPath: '/invites/accept',
      isReady: true,
    };
  });

  it('calls acceptInvite with the token', async () => {
    mockAcceptInvite.mockResolvedValue({ data: {} });
    renderAcceptPage();

    await waitFor(() => {
      expect(mockAcceptInvite).toHaveBeenCalledWith('valid-token-123');
    });
  });

  it('shows success state after accepting', async () => {
    mockAcceptInvite.mockResolvedValue({ data: {} });
    renderAcceptPage();

    expect(await screen.findByText("You've joined the workspace!")).toBeInTheDocument();
  });

  it('shows expired message', async () => {
    mockAcceptInvite.mockRejectedValue({
      response: { data: { code: 'invite_expired' }, status: 400 },
    });
    renderAcceptPage();

    expect(await screen.findByText('This invite has expired. Ask the workspace owner to send a new one.')).toBeInTheDocument();
  });

  it('shows invalid for missing token', async () => {
    mockRouterState = { ...mockRouterState, query: {} };
    renderAcceptPage();

    expect(await screen.findByText('This invite link is invalid.')).toBeInTheDocument();
  });

  it('shows already member message', async () => {
    mockAcceptInvite.mockRejectedValue({
      response: { data: { code: 'already_member' }, status: 409 },
    });
    renderAcceptPage();

    expect(await screen.findByText("You're already a member of this workspace.")).toBeInTheDocument();
  });

  it('shows full workspace message', async () => {
    mockAcceptInvite.mockRejectedValue({
      response: { data: { code: 'member_limit_reached' }, status: 400 },
    });
    renderAcceptPage();

    expect(await screen.findByText('This workspace has reached its member limit.')).toBeInTheDocument();
  });

  it('calls setWorkspaces and setActiveWorkspace with response data on success', async () => {
    const workspaces = [{ id: 'ws-owner', name: 'Owner WS', role: 'admin' }];
    mockAcceptInvite.mockResolvedValue({ data: { workspaceId: 'ws-owner', workspaces } });
    renderAcceptPage();

    await waitFor(() => {
      // setWorkspaces now takes a defaultWorkspaceId hint so the joined
      // workspace becomes the active one even on devices with stale persisted state.
      expect(mockSetWorkspaces).toHaveBeenCalledWith(workspaces, { defaultWorkspaceId: 'ws-owner' });
      expect(mockSetActiveWorkspace).toHaveBeenCalledWith('ws-owner');
    });
  });

  it('does not crash when response has no workspaces or workspaceId', async () => {
    mockAcceptInvite.mockResolvedValue({ data: {} });
    renderAcceptPage();

    expect(await screen.findByText("You've joined the workspace!")).toBeInTheDocument();
    expect(mockSetWorkspaces).not.toHaveBeenCalled();
    expect(mockSetActiveWorkspace).not.toHaveBeenCalled();
  });

  it('redirects to login when not authenticated', async () => {
    mockIsAuthenticated = false;
    renderAcceptPage();

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining('/login?redirect=')
      );
    });
  });
});
