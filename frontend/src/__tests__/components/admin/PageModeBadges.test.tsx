import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageModeBadges } from '@/components/admin/customer/PageModeBadges';
import type { CustomerDetail } from '@/components/admin/customer/types';

// Render the key so assertions stay independent of the copy (project rule:
// tests never hardcode translated strings).
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

type CustomerPage = CustomerDetail['pages'][number];

function page(overrides: Partial<CustomerPage> = {}): CustomerPage {
  return {
    id: 'page-1',
    name: 'صفحة',
    replyMode: null,
    replyModeEffective: 'sales',
    brandVoiceNotesMulti: null,
    ...overrides,
  } as unknown as CustomerPage;
}

describe('PageModeBadges — the mode is stated on EVERY page', () => {
  // Before this, the badge rendered for 'info' only, on the reasoning that
  // 'sales' is the default and a badge everywhere is noise. But an absent badge
  // does not read as "sales" — it reads as "this console does not know", which
  // is what sent support back to the workspace value, the very failure D-087
  // created the badge to prevent.
  it('shows sales, not nothing, for a default page', () => {
    render(<PageModeBadges page={page()} />);
    expect(screen.getByText('customer.pageModeSales')).toBeInTheDocument();
  });

  it('shows info for a page running info-desk', () => {
    render(<PageModeBadges page={page({ replyMode: 'info', replyModeEffective: 'info' })} />);
    expect(screen.getByText('customer.pageModeInfo')).toBeInTheDocument();
  });

  it('marks a pinned mode as pinned — it survives a workspace flip', () => {
    render(<PageModeBadges page={page({ replyMode: 'info', replyModeEffective: 'info' })} />);
    expect(screen.getByText(/customer\.pageModePinned/)).toBeInTheDocument();
    expect(screen.queryByText(/customer\.pageModeInherited/)).not.toBeInTheDocument();
  });

  it('marks an inherited mode as inherited — support must change the WORKSPACE for it', () => {
    // The case D-087 was written about: an info page under a sales workspace,
    // and the reverse — info inherited from the workspace, no page pin.
    render(<PageModeBadges page={page({ replyMode: null, replyModeEffective: 'info' })} />);
    expect(screen.getByText(/customer\.pageModeInherited/)).toBeInTheDocument();
    expect(screen.queryByText(/customer\.pageModePinned/)).not.toBeInTheDocument();
  });

  it('treats an unknown stored mode as inherited, matching resolveEffectiveReplyMode', () => {
    // The column is a raw varchar. The resolver ignores anything that is not a
    // known mode, so the badge must not call it a pin.
    render(<PageModeBadges page={page({ replyMode: 'garbage', replyModeEffective: 'sales' })} />);
    expect(screen.getByText(/customer\.pageModeInherited/)).toBeInTheDocument();
  });

  it('an explicit sales pin under an info workspace still reads as pinned', () => {
    render(<PageModeBadges page={page({ replyMode: 'sales', replyModeEffective: 'sales' })} />);
    expect(screen.getByText('customer.pageModeSales')).toBeInTheDocument();
    expect(screen.getByText(/customer\.pageModePinned/)).toBeInTheDocument();
  });
});

describe('PageModeBadges — the persona pin', () => {
  it('badges a page whose own persona overrides the workspace one', () => {
    render(<PageModeBadges page={page({ brandVoiceNotesMulti: { ar: 'لهجة شامية' } })} />);
    expect(screen.getByText('customer.pagePersonaPinned')).toBeInTheDocument();
  });

  it('stays silent for a page that inherits the workspace persona', () => {
    render(<PageModeBadges page={page({ brandVoiceNotesMulti: {} })} />);
    expect(screen.queryByText('customer.pagePersonaPinned')).not.toBeInTheDocument();
  });

  it('does not badge a sourceLang-only or whitespace-only record', () => {
    render(<PageModeBadges page={page({ brandVoiceNotesMulti: { sourceLang: 'ar', ar: '  ' } })} />);
    expect(screen.queryByText('customer.pagePersonaPinned')).not.toBeInTheDocument();
  });
});
