import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChannelPickerModal } from '@/components/pages/ChannelPickerModal';
import enPages from '@/i18n/en/pages.json';

vi.mock('@/components/ui', () => ({
    Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    FacebookIcon: () => <svg data-testid="fb-icon" />,
    InstagramIcon: () => <svg data-testid="ig-icon" />,
    WhatsAppIcon: () => <svg data-testid="wa-icon" />,
    Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    ChoiceRow: ({ title, description }: { title: string; description: string }) => (
        <div>
            <span>{title}</span>
            <span>{description}</span>
        </div>
    ),
}));

const baseProps = {
    isOpen: true,
    onClose: () => {},
    onPickFacebook: () => {},
    onPickWhatsApp: () => {},
    onPickInstagram: () => {},
    whatsappAvailable: false,
    whatsappConnecting: false,
    instagramAvailable: false,
};

describe('ChannelPickerModal — D-117 WhatsApp copy for Zid accounts', () => {
    it('default accounts see the Facebook description that promises WhatsApp later', () => {
        render(<ChannelPickerModal {...baseProps} whatsappCopyHidden={false} />);
        expect(screen.getByText(enPages.channelFacebookDesc)).toBeInTheDocument();
        expect(enPages.channelFacebookDesc).toMatch(/WhatsApp/);
    });

    it('Zid-connected accounts see the WhatsApp-free Facebook description', () => {
        render(<ChannelPickerModal {...baseProps} whatsappCopyHidden={true} />);
        expect(screen.getByText(enPages.channelFacebookDescNoWhatsApp)).toBeInTheDocument();
        expect(screen.queryByText(enPages.channelFacebookDesc)).not.toBeInTheDocument();
        expect(enPages.channelFacebookDescNoWhatsApp).not.toMatch(/WhatsApp/);
    });
});
