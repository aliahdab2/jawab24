import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LeadCustomFieldsSection } from './LeadCustomFields';
import en from '@/i18n/en/leads.json';
import type { Lead, LeadCustomFieldDef } from '@/lib/api';

const { updateCustomFields } = vi.hoisted(() => ({ updateCustomFields: vi.fn() }));

vi.mock('@/lib/api', () => ({
  leadsApi: { updateCustomFields },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const t = ((key: string) => (en as Record<string, string>)[key] ?? key) as never;

const FIELD_DEFS: LeadCustomFieldDef[] = [
  { id: 'f-amount', label: 'Amount paid' },
  { id: 'f-discount', label: 'Discount' },
];

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1',
    pageId: 'page-1',
    sourceType: 'message',
    sourceId: null,
    senderId: 's1',
    senderName: 'Ali',
    phone: '+966501234567',
    extractedData: { fields: [] },
    status: 'converted',
    subStage: null,
    customFields: { 'f-amount': '1500' },
    extractionStatus: 'completed',
    extractionAttempts: 0,
    digestEmailedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Lead;
}

function renderSection(lead: Lead, onSaved = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <LeadCustomFieldsSection lead={lead} fieldDefs={FIELD_DEFS} onSaved={onSaved} t={t} />
    </QueryClientProvider>,
  );
  return { ...view, onSaved, queryClient };
}

describe('LeadCustomFieldsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateCustomFields.mockResolvedValue({ data: makeLead() });
  });

  it('renders nothing when the workspace has no field definitions', () => {
    const queryClient = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <LeadCustomFieldsSection lead={makeLead()} fieldDefs={[]} onSaved={vi.fn()} t={t} />
      </QueryClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the save button only after a real change (trim-aware)', () => {
    renderSection(makeLead());
    expect(screen.queryByText(en.saveFields)).not.toBeInTheDocument();

    const amount = screen.getByLabelText('Amount paid');
    // Whitespace-only difference is not dirty
    fireEvent.change(amount, { target: { value: ' 1500 ' } });
    expect(screen.queryByText(en.saveFields)).not.toBeInTheDocument();

    fireEvent.change(amount, { target: { value: '2000' } });
    expect(screen.getByText(en.saveFields)).toBeInTheDocument();
  });

  it('sends every defined field id on save — cleared inputs delete values', async () => {
    const { onSaved } = renderSection(makeLead());
    fireEvent.change(screen.getByLabelText('Amount paid'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Discount'), { target: { value: '10%' } });
    fireEvent.click(screen.getByText(en.saveFields));

    await waitFor(() => expect(updateCustomFields).toHaveBeenCalledTimes(1));
    expect(updateCustomFields).toHaveBeenCalledWith('lead-1', 'page-1', {
      'f-amount': '',
      'f-discount': '10%',
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('re-seeds values when the panel switches to another lead', () => {
    const { rerender, queryClient } = renderSection(makeLead());
    expect(screen.getByLabelText('Amount paid')).toHaveValue('1500');

    rerender(
      <QueryClientProvider client={queryClient}>
        <LeadCustomFieldsSection
          lead={makeLead({ id: 'lead-2', customFields: { 'f-amount': '900' } })}
          fieldDefs={FIELD_DEFS}
          onSaved={vi.fn()}
          t={t}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText('Amount paid')).toHaveValue('900');
  });
});
