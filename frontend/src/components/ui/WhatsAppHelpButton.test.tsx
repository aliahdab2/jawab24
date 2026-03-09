import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { WhatsAppHelpButton } from './WhatsAppHelpButton';

// Mock next/router
vi.mock('next/router', () => ({
  useRouter: () => ({ pathname: '/dashboard' }),
}));

// Mock useLandscape hook
vi.mock('@/hooks/useLandscape', () => ({
  useLandscape: () => false,
}));

describe('WhatsAppHelpButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the floating button', () => {
    render(<WhatsAppHelpButton />);
    expect(screen.getByLabelText('Need help?')).toBeInTheDocument();
  });

  it('hides when hidden prop is true', () => {
    render(<WhatsAppHelpButton hidden />);
    const button = screen.getByLabelText('Need help?');
    expect(button.className).toContain('pointer-events-none');
  });

  it('opens popup card on click', () => {
    render(<WhatsAppHelpButton />);
    fireEvent.click(screen.getByLabelText('Need help?'));
    expect(screen.getAllByText('Need help?').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("We're here to help! Contact us directly for instant support.")).toBeInTheDocument();
    expect(screen.getByText('Contact us on WhatsApp')).toBeInTheDocument();
  });

  it('closes popup when clicking backdrop', () => {
    render(<WhatsAppHelpButton />);
    fireEvent.click(screen.getByLabelText('Need help?'));
    expect(screen.getByText('Contact us on WhatsApp')).toBeInTheDocument();

    // Click the backdrop (the div with bg-black/30)
    const backdrop = document.querySelector('.bg-black\\/30');
    if (backdrop) fireEvent.click(backdrop);
    expect(screen.queryByText('Contact us on WhatsApp')).not.toBeInTheDocument();
  });

  it('opens WhatsApp link with encoded message', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<WhatsAppHelpButton />);
    fireEvent.click(screen.getByLabelText('Need help?'));
    fireEvent.click(screen.getByText('Contact us on WhatsApp'));

    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://wa.me/46700224720?text='),
      '_blank'
    );
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent('Hello, I need help using Jawab24')),
      '_blank'
    );
    openSpy.mockRestore();
  });
});
