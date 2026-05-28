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

vi.mock('@/constants/brand', () => ({
  BRAND_ASSETS: {
    urls: { base: 'https://jawab24.com' },
  },
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

// Mock data matches the flat format returned by production API
const ownerMember = {
  id: 'mem-1', userId: 'user-1', role: 'owner' as const, joinedAt: '2026-01-01',
  userName: 'Ahmad', userEmail: 'ahmad@test.com', userPicture: null,
};

const adminMember = {
  id: 'mem-2', userId: 'user-2', role: 'admin' as const, joinedAt: '2026-02-01',
  userName: 'Sara', userEmail: 'sara@test.com', userPicture: null,
};

const regularMember = {
  id: 'mem-3', userId: 'user-3', role: 'member' as const, joinedAt: '2026-03-01',
  userName: 'Omar', userEmail: 'omar@test.com', userPicture: null,
};

const pendingEmailInvite = {
  id: 'inv-1', email: 'ali@test.com', phone: null, role: 'member' as const, status: 'pending',
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  createdAt: new Date().toISOString(),
};

const pendingPhoneInvite = {
  id: 'inv-2', email: null, phone: '+966501234567', role: 'member' as const, status: 'pending',
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  createdAt: new Date().toISOString(),
};

describe('TeamSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMembers.mockResolvedValue({ data: [ownerMember] });
    mockInvites.mockResolvedValue({ data: [] });
    // Most existing tests assert content inside the Team panel. The section
    // is collapsed by default now, so seed the persisted-expanded flag for
    // those tests. Tests that care about the default-collapsed behavior
    // explicitly remove this key in their own setup.
    window.localStorage.setItem('settings:team:expanded', '1');
  });

  it('is collapsed by default and expands on click', async () => {
    window.localStorage.removeItem('settings:team:expanded');
    renderTeamSection();
    // Header is always visible; description (inside the Card) appears only when expanded.
    expect(screen.queryByText('Invite people to help manage your replies')).not.toBeInTheDocument();
    const toggle = await screen.findByRole('button', { name: /Team/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(await screen.findByText('Invite people to help manage your replies')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders team section with header', async () => {
    renderTeamSection();
    const teamHeaders = await screen.findAllByText('Team');
    expect(teamHeaders.length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText('Invite people to help manage your replies')).toBeInTheDocument();
  });

  it('shows invite form for owner', async () => {
    renderTeamSection();
    expect(await screen.findByPlaceholderText('Email or phone (+966xxxxxxxxx)')).toBeInTheDocument();
    expect(await screen.findByText('Invite')).toBeInTheDocument();
  });

  it('renders member list with owner badge', async () => {
    renderTeamSection();
    expect(await screen.findByText('Ahmad')).toBeInTheDocument();
    // "Owner" appears both as the member's role badge (a <span>) and in the
    // "What each role can do" legend (a <p>). Scope to the badge span so this
    // assertion still verifies the member row specifically.
    expect(await screen.findByText('Owner', { selector: 'span' })).toBeInTheDocument();
    expect(await screen.findByText('(You)')).toBeInTheDocument();
  });

  it('renders multiple members', async () => {
    mockMembers.mockResolvedValue({ data: [ownerMember, adminMember, regularMember] });
    renderTeamSection();

    expect(await screen.findByText('Ahmad')).toBeInTheDocument();
    expect(await screen.findByText('Sara')).toBeInTheDocument();
    expect(await screen.findByText('Omar')).toBeInTheDocument();
  });

  it('shows pending email invite', async () => {
    mockInvites.mockResolvedValue({ data: [pendingEmailInvite] });
    renderTeamSection();

    expect(await screen.findByText('ali@test.com')).toBeInTheDocument();
    expect(await screen.findByText('Pending')).toBeInTheDocument();
  });

  it('shows pending phone invite', async () => {
    mockInvites.mockResolvedValue({ data: [pendingPhoneInvite] });
    renderTeamSection();

    expect(await screen.findByText('+966501234567')).toBeInTheDocument();
    expect(await screen.findByText('Pending')).toBeInTheDocument();
  });

  it('sends invite with email on button click', async () => {
    mockCreateInvite.mockResolvedValue({ data: { id: 'inv-new' } });
    renderTeamSection();

    const input = await screen.findByPlaceholderText('Email or phone (+966xxxxxxxxx)');
    fireEvent.change(input, { target: { value: 'new@test.com' } });

    const button = screen.getByText('Invite');
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockCreateInvite).toHaveBeenCalledWith('new@test.com');
    });
  });

  it('sends invite with phone number on button click', async () => {
    mockCreateInvite.mockResolvedValue({ data: { id: 'inv-new', token: 'tok123' } });
    renderTeamSection();

    const input = await screen.findByPlaceholderText('Email or phone (+966xxxxxxxxx)');
    fireEvent.change(input, { target: { value: '+966501234567' } });

    const button = screen.getByText('Invite');
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockCreateInvite).toHaveBeenCalledWith('+966501234567');
    });
  });

  it('rejects invalid contact (no + prefix phone)', async () => {
    renderTeamSection();

    const input = await screen.findByPlaceholderText('Email or phone (+966xxxxxxxxx)');
    fireEvent.change(input, { target: { value: '0501234567' } });

    const button = screen.getByText('Invite');
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockCreateInvite).not.toHaveBeenCalled();
    });
  });

  it('rejects invalid contact (malformed string)', async () => {
    renderTeamSection();

    const input = await screen.findByPlaceholderText('Email or phone (+966xxxxxxxxx)');
    fireEvent.change(input, { target: { value: 'not-valid' } });

    const button = screen.getByText('Invite');
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockCreateInvite).not.toHaveBeenCalled();
    });
  });

  it('shows resend button on pending invites', async () => {
    mockInvites.mockResolvedValue({ data: [pendingEmailInvite] });
    renderTeamSection();

    expect(await screen.findByText('Resend')).toBeInTheDocument();
  });

  it('resend calls createInvite with invite contact', async () => {
    mockCreateInvite.mockResolvedValue({ data: { token: 'newtoken' } });
    mockInvites.mockResolvedValue({ data: [pendingEmailInvite] });
    renderTeamSection();

    const resendButton = await screen.findByText('Resend');
    fireEvent.click(resendButton);

    await waitFor(() => {
      expect(mockCreateInvite).toHaveBeenCalledWith('ali@test.com');
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
      userName: 'Fatima', userEmail: 'fatima@test.com',
    }];
    mockMembers.mockResolvedValue({ data: members });
    renderTeamSection();

    expect(await screen.findByText('You can invite 1 more person')).toBeInTheDocument();
  });

  it('shows limit reached at max capacity', async () => {
    const members = [
      ownerMember,
      ...Array.from({ length: 4 }, (_, i) => ({
        ...regularMember, id: `mem-${i + 2}`, userId: `user-${i + 10}`,
        userName: `User ${i + 2}`, userEmail: `user${i + 10}@test.com`, userPicture: null,
      })),
    ];
    mockMembers.mockResolvedValue({ data: members });
    renderTeamSection();

    expect(await screen.findByText('Member limit reached (5)')).toBeInTheDocument();
  });

  it('shows member count in header', async () => {
    mockMembers.mockResolvedValue({ data: [ownerMember, adminMember] });
    renderTeamSection();

    // Header shows "2 / 5"
    expect(await screen.findByText('2 / 5')).toBeInTheDocument();
  });

  it('invite link uses canonical domain not window.location.origin', async () => {
    const token = 'abc123token';
    mockCreateInvite.mockResolvedValue({ data: { token } });
    renderTeamSection();

    const input = await screen.findByPlaceholderText('Email or phone (+966xxxxxxxxx)');
    fireEvent.change(input, { target: { value: 'new@test.com' } });
    fireEvent.click(screen.getByText('Invite'));

    await waitFor(() => {
      const linkInput = document.querySelector('input[readonly]') as HTMLInputElement;
      expect(linkInput?.value).toContain('https://jawab24.com/invites/accept?token=');
      expect(linkInput?.value).not.toContain('localhost');
      expect(linkInput?.value).not.toContain('app.jawab24.com');
    });
  });

  it('shows email below name when both exist', async () => {
    renderTeamSection();

    expect(await screen.findByText('Ahmad')).toBeInTheDocument();
    expect(await screen.findByText('ahmad@test.com')).toBeInTheDocument();
  });

  // ─── Avatar: referrerPolicy + onError fallback ────────────────────────

  it('renders profile picture with referrerPolicy="no-referrer" when userPicture is set', async () => {
    mockMembers.mockResolvedValue({
      data: [{ ...ownerMember, userPicture: 'https://platform-lookaside.fbsbx.com/picture.jpg' }],
    });
    renderTeamSection();

    const img = await screen.findByRole('img', { name: 'Ahmad' });
    expect(img).toHaveAttribute('src', 'https://platform-lookaside.fbsbx.com/picture.jpg');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('shows initial avatar when userPicture is null', async () => {
    mockMembers.mockResolvedValue({ data: [{ ...ownerMember, userPicture: null }] });
    renderTeamSection();

    await screen.findByText('Ahmad');
    // No img element for this member — initial div shown instead
    expect(screen.queryByRole('img', { name: 'Ahmad' })).not.toBeInTheDocument();
  });

  it('falls back to initial avatar when profile image fails to load', async () => {
    mockMembers.mockResolvedValue({
      data: [{ ...ownerMember, userPicture: 'https://platform-lookaside.fbsbx.com/picture.jpg' }],
    });
    renderTeamSection();

    const img = await screen.findByRole('img', { name: 'Ahmad' });

    // Simulate network failure
    fireEvent.error(img);

    // Image should be gone, initial letter should appear
    expect(screen.queryByRole('img', { name: 'Ahmad' })).not.toBeInTheDocument();
  });
});
