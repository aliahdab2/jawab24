import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StageCustomizerModal } from './StageCustomizerModal';
import en from '@/i18n/en/leads.json';
import type { LeadStagesConfig } from '@/lib/api';

const { updateSettings, updateLeadConfig } = vi.hoisted(() => ({ updateSettings: vi.fn(), updateLeadConfig: vi.fn() }));

vi.mock('@/lib/api', () => ({
  workspaceApi: { updateSettings },
  pagesApi: { updateLeadConfig },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/i18n/hooks', () => ({
  useLanguage: () => ({ language: 'en' }),
}));

// Modal uses portals — a light stand-in keeps the test on the component's own logic.
vi.mock('@/components/ui', () => ({
  Modal: ({ children, isOpen, title, footer }: { children: React.ReactNode; isOpen: boolean; title?: string; footer?: React.ReactNode }) =>
    isOpen ? (
      <div role="dialog">
        {title && <h1>{title}</h1>}
        {children}
        {footer}
      </div>
    ) : null,
  Button: ({ children, onClick, disabled, loading }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; loading?: boolean }) => (
    <button onClick={onClick} disabled={disabled || loading}>{children}</button>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

const EXISTING: LeadStagesConfig = {
  converted: [{ id: 'id-1', label: 'My custom stage', color: 'cyan' }],
};

function renderModal(props: Partial<React.ComponentProps<typeof StageCustomizerModal>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <StageCustomizerModal isOpen onClose={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

describe('StageCustomizerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSettings.mockResolvedValue({ data: {} });
    updateLeadConfig.mockResolvedValue({ data: {} });
  });

  it('offers templates on an empty draft and applies one in place (no overwrite prompt)', () => {
    renderModal();
    // Empty draft → templates are visible.
    expect(screen.getByText(en.templates)).toBeInTheDocument();
    fireEvent.click(screen.getByText(en.templateSchool));

    // School template (EN): contacted stages + course field
    expect(screen.getByDisplayValue('Interested')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Enrolled')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Course')).toBeInTheDocument();
  });

  it('hides the templates once the merchant has customized (existing stages)', () => {
    renderModal({ workspaceStages: EXISTING });
    // Draft seeded with existing content → the templates section is gone, so a
    // template can never overwrite the merchant's setup.
    expect(screen.queryByText(en.templates)).not.toBeInTheDocument();
    expect(screen.queryByText(en.templateStore)).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('My custom stage')).toBeInTheDocument();
  });

  it('save drops rows with empty labels and trims the rest', async () => {
    renderModal({ workspaceStages: EXISTING });
    // Add an empty row under converted — it must not reach the server.
    const addButtons = screen.getAllByText(en.addSubStage);
    fireEvent.click(addButtons[addButtons.length - 1]);
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    const payload = updateSettings.mock.calls[0][0];
    expect(payload.leadStages.converted).toEqual([
      { id: 'id-1', label: 'My custom stage', color: 'cyan' },
    ]);
    expect(payload.leadFields).toEqual([]);
  });

  it('hides the add button when a status reaches the 20 sub-stage cap', () => {
    const full: LeadStagesConfig = {
      converted: Array.from({ length: 20 }, (_, i) => ({
        id: `id-${i}`,
        label: `Stage ${i}`,
        color: 'blue' as const,
      })),
    };
    renderModal({ workspaceStages: full });
    // "new" and "contacted" sections still offer add; the full "converted" must not:
    // 2 collapsed sections → exactly 2 add-stage buttons remain.
    expect(screen.getAllByText(en.addSubStage)).toHaveLength(2);
    expect(screen.getByText('(20/20)')).toBeInTheDocument();
  });

  // Scope is implicit: the page selector on the leads screen IS the scope.
  describe('scope routing (no toggle in the UI)', () => {
    it('single-page workspace edits the shared workspace config, with a plain title', async () => {
      renderModal({ workspaceStages: EXISTING });
      expect(screen.getByText(en.customizeStages)).toBeInTheDocument(); // "Customize leads" (no page name)
      fireEvent.click(screen.getByText('Save'));
      await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
      expect(updateLeadConfig).not.toHaveBeenCalled();
    });

    it('multi-page workspace saves the SELECTED page override and names the page in the title', async () => {
      renderModal({ multiPage: true, selectedPageId: 'pg1', pageName: 'Nourva', workspaceStages: EXISTING });
      expect(screen.getByText(en.customizeStagesForPage.replace('{name}', 'Nourva'))).toBeInTheDocument();
      fireEvent.click(screen.getByText('Save'));
      await waitFor(() => expect(updateLeadConfig).toHaveBeenCalledTimes(1));
      expect(updateLeadConfig.mock.calls[0][0]).toBe('pg1');
      expect(updateSettings).not.toHaveBeenCalled();
    });

    it('keeps a page override editable even when the workspace is now single-page (not orphaned)', async () => {
      const pageOverride: LeadStagesConfig = { converted: [{ id: 'po', label: 'PageOnlyStage', color: 'blue' }] };
      renderModal({ multiPage: false, selectedPageId: 'pg1', pageStages: pageOverride, workspaceStages: EXISTING });
      // Seeds from the PAGE override, not the workspace config — the override is reachable.
      expect(screen.getByDisplayValue('PageOnlyStage')).toBeInTheDocument();
      expect(screen.queryByDisplayValue('My custom stage')).not.toBeInTheDocument();
      fireEvent.click(screen.getByText('Save'));
      await waitFor(() => expect(updateLeadConfig).toHaveBeenCalledTimes(1));
      expect(updateLeadConfig.mock.calls[0][0]).toBe('pg1');
    });
  });
});
