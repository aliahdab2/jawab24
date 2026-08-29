import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChannelBadges } from '@/components/ui/ChannelBadges';

const LABELS = { facebook: 'Facebook: on', instagram: 'Instagram: off', whatsapp: 'WhatsApp: on' };

describe('ChannelBadges', () => {
    it('renders one badge per connected channel with on/off state', () => {
        render(
            <ChannelBadges
                page={{
                    facebookPageId: 'fb-1',
                    autoReplyEnabled: true,
                    instagramUsername: 'shop',
                    instagramAutoReplyEnabled: false,
                    whatsappConnected: true,
                    whatsappAutoReplyEnabled: true,
                }}
                labels={LABELS}
            />
        );

        // Facebook on → colored (not muted)
        expect(screen.getByLabelText('Facebook: on').className).not.toContain('text-icon-muted');
        // Instagram connected but off → muted
        expect(screen.getByLabelText('Instagram: off').className).toContain('text-icon-muted');
        // WhatsApp on → colored
        expect(screen.getByLabelText('WhatsApp: on').className).not.toContain('text-icon-muted');
    });

    it('omits badges for unconnected channels (WhatsApp-only page shows one badge)', () => {
        render(
            <ChannelBadges
                page={{ facebookPageId: null, whatsappConnected: true, whatsappAutoReplyEnabled: true }}
                labels={LABELS}
            />
        );

        expect(screen.getByLabelText('WhatsApp: on')).toBeInTheDocument();
        expect(screen.queryByLabelText('Facebook: on')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Instagram: off')).not.toBeInTheDocument();
    });

    it('renders nothing when no channel is connected', () => {
        const { container } = render(<ChannelBadges page={{}} labels={LABELS} />);
        expect(container.firstChild).toBeNull();
    });
});
