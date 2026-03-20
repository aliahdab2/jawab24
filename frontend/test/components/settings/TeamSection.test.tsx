import { screen, waitFor, fireEvent } from '@testing-library/react';
import { render } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { TeamSection } from '../../../src/components/settings/TeamSection';

// -- Mocks --

const mockMembers = vi.fn();
const mockInvites = vi.fn();
const mockCreateInvite = vi.fn();
const mockRevokeInvite = vi.fn();
const mockRemoveMember = vi.fn();
const mockUpdateMemberRole = vi.fn();

vi.mock('@/lib/api', () => ({
  workspaceApi: {
    getMembers: () => mockMembers(),
    listInvites: () => mockInvites(),
    createInvite: (...args: unknown[]) => mockCreateInvite(...args),
    revokeInvite: (...args: unknown[]) => mockRevokeInvite(...args),
    removeMember: (...args: unknown[]) => mockRemoveMember(...args),
    updateMemberRole: (...args: unknown[]) => mockUpdateMemberRole(...args),
  },
}));

vi.mock('@/lib/sentryHelpers', () => ({
  captureError: vi.fn(),
}));

const mockUser = { id: 'user-1', name: 'Ahmad', email: 'ahmad@test.com', picture: null };

vi.mock('@/lib/store', () => ({
  useAuthStore: vi.fn((selector?: (state: Record<string, unknown>) => unknown) => {
    const state = { user: mockUser, isAuthenticated: true };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('next/router', () => ({
  useRouter: () => ({ push: vi.fn(), pathname: '/settings', query: {}, asPath: '/settings' }),
}));

// -- Helpers --

function renderTeamSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TeamSection />
    </QueryClientProvider>
  );
}

const ownerMember = {
  id: 'mem-1', userId: 'user-1', role: 'owner' as const, joinedAt: '2026-01-01',
  user: { id: 'user-1', name: 'Ahmad', email: 'ahmad@test.com', picture: null },
};

const adminMember = {
  id: 'mem-2', userId: 'user-2', role: 'admin' as const, joinedAt: '2026-02-01',
  user: { id: 'user-2', name: 'Sara', email: 'sara@test.com', picture: null },
};

const regularMember = {
  id: 'mem-3', userId: 'user-3', role: 'member' as const, joinedAt: '2026-03-01',
  user: { id: 'user-3', name: 'Omar', email: 'omar@test.com', picture: null },
};

describe('TeamSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMembers.mockResolvedValue({ data: [ownerMember] });
    mockInvites.mockResolvedValue({ data: [] });
  });

  it('renders team section with header', async () => {
    renderTeamSection();
    const teamHeaders = await screen.findAllByText('Team');
    expect(teamHeaders.length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText('Invite people to help manage your replies')).toBeInTheDocument();
  });

  it('shows invite form for owner', async () => {
    renderTeamSection();
    expect(await screen.findByPlaceholderText('Email address')).toBeInTheDocument();
    expect(await screen.findByText('Invite')).toBeInTheDocument();
  });

  it('renders member list with owner badge', async () => {
    renderTeamSection();
    expect(await screen.findByText('Ahmad')).toBeInTheDocument();
    expect(await screen.findByText('Owner')).toBeInTheDocument();
    expect(await screen.findByText('(You)')).toBeInTheDocument();
  });

  it('renders multiple members', async () => {
    mockMembers.mockResolvedValue({ data: [ownerMember, adminMember, regularMember] });
    renderTeamSection();

    expect(await screen.findByText('Ahmad')).toBeInTheDocument();
    expect(await screen.findByText('Sara')).toBeInTheDocument();
    expect(await screen.findByText('Omar')).toBeInTheDocument();
  });

  it('shows pending invites', async () => {
    mockInvites.mockResolvedValue({
      data: [{
        id: 'inv-1', email: 'ali@test.com', role: 'member', status: 'pending',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
      }],
    });
    renderTeamSection();

    expect(await screen.findByText('ali@test.com')).toBeInTheDocument();
    expect(await screen.findByText('Pending')).toBeInTheDocument();
  });

  it('sends invite on button click', async () => {
    mockCreateInvite.mockResolvedValue({ data: { id: 'inv-new' } });
    renderTeamSection();

    const input = await screen.findByPlaceholderText('Email address');
    fireEvent.change(input, { target: { value: 'new@test.com' } });

    const button = screen.getByText('Invite');
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockCreateInvite).toHaveBeenCalledWith('new@test.com');
    });
  });

  it('rejects invalid email', async () => {
    renderTeamSection();

    const input = await screen.findByPlaceholderText('Email address');
    fireEvent.change(input, { target: { value: 'not-an-email' } });

    const button = screen.getByText('Invite');
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockCreateInvite).not.toHaveBeenCalled();
    });
  });

  it('shows remove button for non-owner members', async () => {
    mockMembers.mockResolvedValue({ data: [ownerMember, regularMember] });
    renderTeamSection();

    const removeButtons = await screen.findAllByText('Remove');
    expect(removeButtons).toHaveLength(1);
  });

  it('does not show remove for owner row', async () => {
    mockMembers.mockResolvedValue({ data: [ownerMember, adminMember] });
    renderTeamSection();

    await screen.findByText('Ahmad');
    const removeButtons = screen.getAllByText('Remove');
    // Only admin gets a remove button, not owner
    expect(removeButtons).toHaveLength(1);
  });

  it('shows limit hint when near capacity', async () => {
    const members = [ownerMember, adminMember, regularMember, {
      ...regularMember, id: 'mem-4', userId: 'user-4',
      user: { ...regularMember.user, id: 'user-4', name: 'Fatima', email: 'fatima@test.com' },
    }];
    mockMembers.mockResolvedValue({ data: members });
    renderTeamSection();

    expect(await screen.findByText('You can invite 1 more person')).toBeInTheDocument();
  });

  it('shows limit reached at max capacity', async () => {
    // user-1 (current user) must be in the list as owner
    const members = [
      ownerMember,
      ...Array.from({ length: 4 }, (_, i) => ({
        ...regularMember, id: `mem-${i + 2}`, userId: `user-${i + 10}`,
        user: { id: `user-${i + 10}`, name: `User ${i + 2}`, email: `user${i + 10}@test.com`, picture: null },
      })),
    ];
    mockMembers.mockResolvedValue({ data: members });
    renderTeamSection();

    expect(await screen.findByText('Member limit reached (5)')).toBeInTheDocument();
  });
});
