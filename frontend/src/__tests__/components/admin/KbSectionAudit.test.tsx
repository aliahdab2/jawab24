import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { KbSection } from '@/components/admin/customer/KbSection';
import type { CustomerDetail } from '@/components/admin/customer/types';

const { mockAudit } = vi.hoisted(() => ({ mockAudit: vi.fn() }));
vi.mock('@/lib/api', () => ({
  adminApi: {
    auditBusinessInfo: mockAudit,
    getKbStatus: vi.fn().mockResolvedValue({ success: true, data: { kbText: '' } }),
    getKbGaps: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
}));

// Render the key so assertions stay independent of the copy (project rule:
// tests never hardcode translated strings).
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

const customer = {
  pages: [{
    id: 'page-1',
    name: 'متجر إجدابيا للأصلي',
    facebookPageId: 'fb-1',
    kb: {
      kbLength: 4200,
      kbActiveVersion: 71,
      kbUpdatedAt: null,
      chunksTotal: 40,
      chunksByType: { offering: 30, info: 10 },
      unresolvedGaps: 0,
    },
  }],
} as unknown as CustomerDetail;

const renderSection = () => render(<KbSection customer={customer} formatDate={() => '—'} />);
const openAudit = () => fireEvent.click(screen.getByText('customer.kbAuditTitle'));

describe('KbSection — instruction check', () => {
  beforeEach(() => mockAudit.mockReset());

  // Opening this expander spends an OpenAI call on a cache miss. Rendering the
  // customer page must never trigger it — only an explicit click may.
  it('does not audit until the merchant-support operator opens it', () => {
    renderSection();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('audits the page on first open', async () => {
    mockAudit.mockResolvedValue({ success: true, data: { findings: [], cached: false, classifierFailed: false } });
    renderSection();
    openAudit();
    await waitFor(() => expect(mockAudit).toHaveBeenCalledWith('page-1'));
  });

  it('lists a finding with its code and the merchant\'s own words', async () => {
    mockAudit.mockResolvedValue({
      success: true,
      data: {
        findings: [{
          code: 'lead_status_change',
          kind: 'impossible',
          quote: 'اي عميل يرسل رقم تلفونه تحوله ضمن (تم التحويل)',
          occurrences: 1,
        }],
        cached: false,
        classifierFailed: false,
      },
    });
    renderSection();
    openAudit();

    expect(await screen.findByText('lead_status_change')).toBeInTheDocument();
    expect(screen.getByText(/تحوله ضمن/)).toBeInTheDocument();
    expect(screen.getByText('customer.kbAuditCode_lead_status_change')).toBeInTheDocument();
  });

  // The whole point of the classifierFailed flag: "we found nothing" and "we
  // could not look" must never render the same, or the founder clears a
  // merchant who was never actually checked.
  it('warns that the result is partial when the classifier failed', async () => {
    mockAudit.mockResolvedValue({
      success: true,
      data: { findings: [], cached: false, classifierFailed: true },
    });
    renderSection();
    openAudit();

    expect(await screen.findByText('customer.kbAuditPartial')).toBeInTheDocument();
    expect(screen.queryByText('customer.kbAuditClean')).not.toBeInTheDocument();
  });

  it('reports a clean result only when the check actually ran', async () => {
    mockAudit.mockResolvedValue({
      success: true,
      data: { findings: [], cached: false, classifierFailed: false },
    });
    renderSection();
    openAudit();

    expect(await screen.findByText('customer.kbAuditClean')).toBeInTheDocument();
    expect(screen.queryByText('customer.kbAuditPartial')).not.toBeInTheDocument();
  });

  // Resolving with success:false rather than rejecting: it exercises the same
  // user-visible path, and vitest reports an error thrown inside a mock as an
  // unhandled test error even once the component has caught it.
  it('shows an error line instead of an empty panel when the request fails', async () => {
    mockAudit.mockResolvedValue({ success: false });
    renderSection();
    openAudit();

    expect(await screen.findByText('customer.kbAuditError')).toBeInTheDocument();
  });
});
