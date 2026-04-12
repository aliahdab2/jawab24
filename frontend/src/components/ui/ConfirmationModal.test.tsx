import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { ConfirmationModal } from './ConfirmationModal';

// Mock Modal since it uses portals
vi.mock('./Modal', () => ({
  Modal: ({ children, isOpen, onClose, title }: { children: React.ReactNode; isOpen: boolean; onClose: () => void; title?: string }) => isOpen ? (
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
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    render(<ConfirmationModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Confirm'));
    expect(defaultProps.onConfirm).toHaveBeenCalled();
  });

  it('calls onClose when cancel button is clicked', () => {
    render(<ConfirmationModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Cancel'));
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
    const cancelBtn = screen.getByText('Cancel').closest('button');
    expect(cancelBtn).toBeDisabled();
    
    const confirmBtn = screen.getByText('Confirm').closest('button');
    expect(confirmBtn).toBeDisabled();
  });
});
