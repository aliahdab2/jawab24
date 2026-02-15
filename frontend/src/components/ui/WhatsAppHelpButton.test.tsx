import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { WhatsAppHelpButton } from './WhatsAppHelpButton';

// Mock next/router
vi.mock('next/router', () => ({
  useRouter: () => ({ pathname: '/dashboard' }),
}));

// Mock translation
vi.mock('@/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'common.needHelp': 'Need Help?',
        'common.helpDescription': 'Chat with us on WhatsApp',
        'common.contactWhatsApp': 'Contact on WhatsApp',
        'common.alwaysAvailable': 'Always available',
        'common.whatsappDefaultMessage': 'Hello, I need help using Jawab24',
      };
      return map[key] || key;
    },
    language: 'en',
  }),
  useLanguage: () => ({ language: 'en', setLanguage: vi.fn() }),
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
    expect(screen.getByLabelText('Need Help?')).toBeInTheDocument();
  });

  it('hides when hidden prop is true', () => {
    render(<WhatsAppHelpButton hidden />);
    const button = screen.getByLabelText('Need Help?');
    expect(button.className).toContain('pointer-events-none');
  });

  it('opens popup card on click', () => {
    render(<WhatsAppHelpButton />);
    fireEvent.click(screen.getByLabelText('Need Help?'));
    expect(screen.getByText('Need Help?')).toBeInTheDocument();
    expect(screen.getByText('Chat with us on WhatsApp')).toBeInTheDocument();
    expect(screen.getByText('Contact on WhatsApp')).toBeInTheDocument();
  });

  it('closes popup when clicking backdrop', () => {
    render(<WhatsAppHelpButton />);
    fireEvent.click(screen.getByLabelText('Need Help?'));
    expect(screen.getByText('Contact on WhatsApp')).toBeInTheDocument();

    // Click the backdrop (the div with bg-black/30)
    const backdrop = document.querySelector('.bg-black\\/30');
    if (backdrop) fireEvent.click(backdrop);
    expect(screen.queryByText('Contact on WhatsApp')).not.toBeInTheDocument();
  });

  it('opens WhatsApp link with encoded message', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<WhatsAppHelpButton />);
    fireEvent.click(screen.getByLabelText('Need Help?'));
    fireEvent.click(screen.getByText('Contact on WhatsApp'));

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
