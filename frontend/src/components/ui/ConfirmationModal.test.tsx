import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { ConfirmationModal } from './ConfirmationModal';

// Mock translation
vi.mock('@/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Mock Modal since it uses portals
vi.mock('./Modal', () => ({
  Modal: ({ children, isOpen, onClose, title }: any) => isOpen ? (
    <div role="dialog">
      {title && <h1>{title}</h1>}
      <button onClick={onClose} aria-label="Close">X</button>
      {children}
    </div>
  ) : null,
}));

describe('ConfirmationModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    title: 'Test Title',
    message: 'Test Message',
  };

  it('renders correctly', () => {
    render(<ConfirmationModal {...defaultProps} />);
    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('Test Message')).toBeInTheDocument();
    expect(screen.getByText('common.confirm')).toBeInTheDocument();
    expect(screen.getByText('common.cancel')).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    render(<ConfirmationModal {...defaultProps} />);
    fireEvent.click(screen.getByText('common.confirm'));
    expect(defaultProps.onConfirm).toHaveBeenCalled();
  });

  it('calls onClose when cancel button is clicked', () => {
    render(<ConfirmationModal {...defaultProps} />);
    fireEvent.click(screen.getByText('common.cancel'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('shows custom button text', () => {
    render(
      <ConfirmationModal 
        {...defaultProps} 
        confirmText="Yes, Delete" 
        cancelText="No, Keep" 
      />
    );
    expect(screen.getByText('Yes, Delete')).toBeInTheDocument();
    expect(screen.getByText('No, Keep')).toBeInTheDocument();
  });

  it('disables buttons when loading', () => {
    render(<ConfirmationModal {...defaultProps} loading={true} />);
    const cancelBtn = screen.getByText('common.cancel').closest('button');
    expect(cancelBtn).toBeDisabled();
    
    const confirmBtn = screen.getByText('common.confirm').closest('button');
    expect(confirmBtn).toBeDisabled();
  });
});
