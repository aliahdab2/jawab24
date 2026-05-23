import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CatalogItemForm } from '@/components/catalog/CatalogItemForm';
import type { CatalogItem } from '@/lib/api';

// Common props builder so each test only specifies what it cares about.
function makeProps(overrides: Partial<Parameters<typeof CatalogItemForm>[0]> = {}) {
    return {
        pageId: 'page-uuid-1',
        onSubmit: vi.fn().mockResolvedValue(undefined),
        onCancel: vi.fn(),
        ...overrides,
    };
}

function makeCourseItem(overrides: Partial<CatalogItem> = {}): CatalogItem {
    return {
        id: 'item-1',
        pageId: 'page-uuid-1',
        type: 'course',
        name: 'Existing Course',
        description: 'Existing description',
        priceMinor: 50000,
        currency: 'SAR',
        startsAt: '2026-09-01T00:00:00.000Z',
        endsAt: '2026-12-15T00:00:00.000Z',
        enrollmentClosesAt: '2026-08-25T00:00:00.000Z',
        metadata: {},
        archivedAt: null,
        sourceTier: 2,
        createdAt: '2026-05-23T00:00:00.000Z',
        updatedAt: '2026-05-23T00:00:00.000Z',
        ...overrides,
    };
}

describe('CatalogItemForm — type-aware field surfacing', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders all fields for a course (default type)', () => {
        render(<CatalogItemForm {...makeProps()} />);
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/price/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/currency/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/starts on/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/ends on/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/enrollment closes on/i)).toBeInTheDocument();
    });

    it('hides date fields for a product', () => {
        render(<CatalogItemForm {...makeProps()} />);
        fireEvent.change(screen.getByLabelText(/type/i), { target: { value: 'product' } });
        // Price stays — products have prices.
        expect(screen.getByLabelText(/price/i)).toBeInTheDocument();
        // Dates + enrollment-closes go away.
        expect(screen.queryByLabelText(/starts on/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/ends on/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/enrollment closes on/i)).not.toBeInTheDocument();
    });

    it('hides enrollment-closes for non-course types that still have dates (event)', () => {
        render(<CatalogItemForm {...makeProps()} />);
        fireEvent.change(screen.getByLabelText(/type/i), { target: { value: 'event' } });
        // Events have start/end but no enrollment-closes (which is course-specific).
        expect(screen.getByLabelText(/starts on/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/ends on/i)).toBeInTheDocument();
        expect(screen.queryByLabelText(/enrollment closes on/i)).not.toBeInTheDocument();
    });

    it('hides price entirely for a branch (locations have no price)', () => {
        render(<CatalogItemForm {...makeProps()} />);
        fireEvent.change(screen.getByLabelText(/type/i), { target: { value: 'branch' } });
        expect(screen.queryByLabelText(/price/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/currency/i)).not.toBeInTheDocument();
    });
});

describe('CatalogItemForm — validation', () => {
    beforeEach(() => vi.clearAllMocks());

    it('blocks submit when name is empty', async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        render(<CatalogItemForm {...makeProps({ onSubmit })} />);
        fireEvent.click(screen.getByRole('button', { name: /create/i }));
        await waitFor(() => {
            expect(screen.getByText(/name is required/i)).toBeInTheDocument();
        });
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('blocks submit when endsAt is before startsAt', async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        render(<CatalogItemForm {...makeProps({ onSubmit })} />);
        fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Course' } });
        fireEvent.change(screen.getByLabelText(/starts on/i), { target: { value: '2026-09-01' } });
        fireEvent.change(screen.getByLabelText(/ends on/i), { target: { value: '2026-08-01' } });
        fireEvent.click(screen.getByRole('button', { name: /create/i }));
        await waitFor(() => {
            expect(screen.getByText(/end date can't be before start date/i)).toBeInTheDocument();
        });
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('blocks submit when enrollment-closes is after start date', async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        render(<CatalogItemForm {...makeProps({ onSubmit })} />);
        fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Course' } });
        fireEvent.change(screen.getByLabelText(/starts on/i), { target: { value: '2026-09-01' } });
        fireEvent.change(screen.getByLabelText(/enrollment closes on/i), { target: { value: '2026-09-15' } });
        fireEvent.click(screen.getByRole('button', { name: /create/i }));
        await waitFor(() => {
            expect(screen.getByText(/enrollment must close/i)).toBeInTheDocument();
        });
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('rejects an over-200-char name (server-mirror)', async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        render(<CatalogItemForm {...makeProps({ onSubmit })} />);
        // Use evaluate-style approach: jsdom respects maxLength like real browsers,
        // so we set the state through the native setter to bypass the cap. The
        // validation runs on `state.name.length > 200`, so this proves the
        // client-side check matches the server-side Zod max(200).
        const nameInput = screen.getByLabelText(/name/i) as HTMLInputElement;
        const longValue = 'x'.repeat(201);
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
        setter.call(nameInput, longValue);
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        fireEvent.click(screen.getByRole('button', { name: /create/i }));
        await waitFor(() => {
            expect(screen.getByText(/name is too long/i)).toBeInTheDocument();
        });
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('converts decimal price to priceMinor (×100) on submit', async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        render(<CatalogItemForm {...makeProps({ onSubmit })} />);
        fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Course' } });
        fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '29.99' } });
        fireEvent.click(screen.getByRole('button', { name: /create/i }));
        await waitFor(() => {
            expect(onSubmit).toHaveBeenCalledTimes(1);
        });
        const payload = onSubmit.mock.calls[0][0];
        expect(payload.priceMinor).toBe(2999);
        expect(payload.currency).toBe('USD'); // default
    });

    it('sends null for priceMinor + currency when price field is empty', async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        render(<CatalogItemForm {...makeProps({ onSubmit })} />);
        fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Free course' } });
        fireEvent.click(screen.getByRole('button', { name: /create/i }));
        await waitFor(() => {
            expect(onSubmit).toHaveBeenCalled();
        });
        const payload = onSubmit.mock.calls[0][0];
        expect(payload.priceMinor).toBeNull();
        expect(payload.currency).toBeNull();
    });
});

describe('CatalogItemForm — edit mode', () => {
    beforeEach(() => vi.clearAllMocks());

    it('pre-fills all fields from initialItem', () => {
        render(<CatalogItemForm {...makeProps({ initialItem: makeCourseItem() })} />);
        expect((screen.getByLabelText(/name/i) as HTMLInputElement).value).toBe('Existing Course');
        expect((screen.getByLabelText(/description/i) as HTMLTextAreaElement).value).toBe('Existing description');
        expect((screen.getByLabelText(/price/i) as HTMLInputElement).value).toBe('500');
        expect((screen.getByLabelText(/currency/i) as HTMLSelectElement).value).toBe('SAR');
        expect((screen.getByLabelText(/starts on/i) as HTMLInputElement).value).toBe('2026-09-01');
        expect((screen.getByLabelText(/ends on/i) as HTMLInputElement).value).toBe('2026-12-15');
        expect((screen.getByLabelText(/enrollment closes on/i) as HTMLInputElement).value).toBe('2026-08-25');
    });

    it('disables the type field with explanatory hint', () => {
        render(<CatalogItemForm {...makeProps({ initialItem: makeCourseItem() })} />);
        expect(screen.getByLabelText(/type/i)).toBeDisabled();
        expect(screen.getByText(/type can't be changed after creation/i)).toBeInTheDocument();
    });

    it('uses "Save changes" instead of "Create" as the submit label', () => {
        render(<CatalogItemForm {...makeProps({ initialItem: makeCourseItem() })} />);
        expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^create$/i })).not.toBeInTheDocument();
    });
});

describe('CatalogItemForm — UX polish', () => {
    beforeEach(() => vi.clearAllMocks());

    it('auto-focuses the name field on mount (create mode)', () => {
        render(<CatalogItemForm {...makeProps()} />);
        expect(document.activeElement).toBe(screen.getByLabelText(/name/i));
    });

    it('does NOT auto-focus on edit mode (preserves existing value)', () => {
        render(<CatalogItemForm {...makeProps({ initialItem: makeCourseItem() })} />);
        // Active element should be the body, not the name input.
        expect(document.activeElement).not.toBe(screen.getByLabelText(/name/i));
    });

    it('hides the description char counter when empty', () => {
        render(<CatalogItemForm {...makeProps()} />);
        // Counter format is "N / 4000". Should not appear when description is empty.
        expect(screen.queryByText(/\/ 4000/)).not.toBeInTheDocument();
    });

    it('shows the description char counter once user types', () => {
        render(<CatalogItemForm {...makeProps()} />);
        fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Hello' } });
        expect(screen.getByText(/5 \/ 4000/)).toBeInTheDocument();
    });

    it('calls onCancel when Cancel is clicked', () => {
        const onCancel = vi.fn();
        render(<CatalogItemForm {...makeProps({ onCancel })} />);
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('disables the currency select until a price is entered', () => {
        render(<CatalogItemForm {...makeProps()} />);
        // Empty price → currency disabled.
        expect(screen.getByLabelText(/currency/i)).toBeDisabled();
        fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '10' } });
        expect(screen.getByLabelText(/currency/i)).not.toBeDisabled();
    });

    it('disables inputs and submit while isSubmitting=true', () => {
        render(<CatalogItemForm {...makeProps({ isSubmitting: true })} />);
        expect(screen.getByLabelText(/name/i)).toBeDisabled();
        expect(screen.getByRole('button', { name: /saving/i })).toBeInTheDocument();
    });
});

describe('CatalogItemForm — submit shape', () => {
    beforeEach(() => vi.clearAllMocks());

    it('omits date + enrollment fields when type is non-temporal (product)', async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        render(<CatalogItemForm {...makeProps({ onSubmit })} />);
        fireEvent.change(screen.getByLabelText(/type/i), { target: { value: 'product' } });
        fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Coffee beans' } });
        fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '15' } });
        fireEvent.click(screen.getByRole('button', { name: /create/i }));
        await waitFor(() => {
            expect(onSubmit).toHaveBeenCalled();
        });
        const payload = onSubmit.mock.calls[0][0];
        expect(payload.type).toBe('product');
        expect(payload.startsAt).toBeNull();
        expect(payload.endsAt).toBeNull();
        expect(payload.enrollmentClosesAt).toBeNull();
    });

    it('serializes dates as UTC midnight ISO strings', async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        render(<CatalogItemForm {...makeProps({ onSubmit })} />);
        fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Workshop' } });
        fireEvent.change(screen.getByLabelText(/starts on/i), { target: { value: '2026-09-01' } });
        fireEvent.click(screen.getByRole('button', { name: /create/i }));
        await waitFor(() => {
            expect(onSubmit).toHaveBeenCalled();
        });
        const payload = onSubmit.mock.calls[0][0];
        expect(payload.startsAt).toBe('2026-09-01T00:00:00.000Z');
    });

    it('clears field-level error as the user starts editing', async () => {
        render(<CatalogItemForm {...makeProps()} />);
        // Trigger the error first.
        fireEvent.click(screen.getByRole('button', { name: /create/i }));
        await waitFor(() => {
            expect(screen.getByText(/name is required/i)).toBeInTheDocument();
        });
        // Edit the field → error disappears immediately, before re-validation.
        act(() => {
            fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'X' } });
        });
        expect(screen.queryByText(/name is required/i)).not.toBeInTheDocument();
    });
});
