import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BusinessListsSection } from '@/components/business/BusinessListsSection';
import { factCollectionsApi, type FactCollectionWithRows } from '@/lib/api';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    factCollectionsApi: {
      list: vi.fn(),
      addRow: vi.fn(),
      updateRow: vi.fn(),
      deleteRow: vi.fn(),
      setCompleteness: vi.fn(),
    },
  };
});

const PAGE = 'page-1';

/** Dates chosen relative to NOW so the expired split can't rot: the section
 *  groups by comparison with today, exactly like the fixture's relative slots. */
const future = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
const past = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);

const collection = (over: Partial<FactCollectionWithRows> = {}): FactCollectionWithRows => ({
  id: 'coll-1',
  label: 'مواعيد الدورات المعلنة',
  keyAttr: 'الدورة',
  isComplete: null,
  rowCount: 2,
  rows: [
    {
      id: 'row-live', name: 'دورة ICDL', price: null, currency: null,
      attributes: [{ label: 'الدورة', value: 'ICDL' }, { label: 'الأيام', value: 'الأحد والثلاثاء' }],
      startsAt: future, endsAt: future, isAvailable: true,
    },
    {
      id: 'row-expired', name: 'دورة المكياج', price: '35000.00', currency: 'ل.س قديمة',
      attributes: [{ label: 'الدورة', value: 'مكياج' }],
      startsAt: past, endsAt: past, isAvailable: true,
    },
  ],
  ...over,
});

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BusinessListsSection pageId={PAGE} />
    </QueryClientProvider>,
  );
}

describe('BusinessListsSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders NOTHING for a page without collections — absence is the rollout gate', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [] } } as any);
    const { container } = renderSection();
    await waitFor(() => expect(factCollectionsApi.list).toHaveBeenCalled());
    expect(container.querySelector('section')).toBeNull();
  });

  it('shows live rows directly and expired rows only behind the toggle', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [collection()] } } as any);
    renderSection();

    expect(await screen.findByText('دورة ICDL')).toBeInTheDocument();
    // Expired row is not visible until the divider is expanded…
    expect(screen.queryByText('دورة المكياج')).toBeNull();

    fireEvent.click(screen.getByText('1 expired row'));
    expect(screen.getByText('دورة المكياج')).toBeInTheDocument();
  });

  it('renders the row meta from attributes + price, never raw column form', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [collection()] } } as any);
    renderSection();
    await screen.findByText('دورة ICDL');
    fireEvent.click(screen.getByText('1 expired row'));
    // "35000.00" must display as "35000 ل.س قديمة" — the merchant's own form.
    expect(screen.getByText(/35000 ل\.س قديمة/)).toBeInTheDocument();
    expect(screen.queryByText(/35000\.00/)).toBeNull();
  });

  it('asks the completeness question ONLY while un-asked, and sends the tri-state answer', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [collection()] } } as any);
    vi.mocked(factCollectionsApi.setCompleteness).mockResolvedValue({} as any);
    renderSection();

    await screen.findByText('دورة ICDL');
    fireEvent.click(screen.getByText('Yes, complete'));
    expect(factCollectionsApi.setCompleteness).toHaveBeenCalledWith(PAGE, 'coll-1', true);
  });

  it('shows the confirmed state (not the question) once answered', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({
      data: { data: [collection({ isComplete: true })] },
    } as any);
    renderSection();
    await screen.findByText('دورة ICDL');
    expect(screen.queryByText('Yes, complete')).toBeNull();
    expect(screen.getByText(/confident/)).toBeInTheDocument();
  });

  it('opens the row sheet on tap and PATCHes through the API on save', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [collection()] } } as any);
    vi.mocked(factCollectionsApi.updateRow).mockResolvedValue({ data: { data: {} } } as any);
    renderSection();

    fireEvent.click(await screen.findByText('دورة ICDL'));
    const nameInput = screen.getByLabelText('Name');
    fireEvent.change(nameInput, { target: { value: 'دورة ICDL مسائية' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(factCollectionsApi.updateRow).toHaveBeenCalledWith(
      PAGE, 'coll-1', 'row-live',
      expect.objectContaining({ name: 'دورة ICDL مسائية' }),
    ));
  });

  it('a NEW row inherits the collection attribute labels with empty values', async () => {
    vi.mocked(factCollectionsApi.list).mockResolvedValue({ data: { data: [collection()] } } as any);
    renderSection();

    await screen.findByText('دورة ICDL');
    fireEvent.click(screen.getByText('Add row'));
    // The schema labels from the first row appear as empty labelled inputs.
    expect(screen.getByLabelText('الدورة')).toHaveValue('');
    expect(screen.getByLabelText('الأيام')).toHaveValue('');
  });
});
