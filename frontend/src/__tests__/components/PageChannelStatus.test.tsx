import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageChannelStatus } from '@/components/admin/customer/PageChannelStatus';
import type { CustomerDetail } from '@/components/admin/customer/types';
import adminEn from '@/i18n/en/admin.json';
import commentsEn from '@/i18n/en/comments.json';
import commonEn from '@/i18n/en/common.json';

type CustomerPage = CustomerDetail['pages'][number];

/** A card the support console might render — every channel absent and off. */
function page(overrides: Partial<CustomerPage> = {}): CustomerPage {
    return {
        id: 'page-1',
        name: 'Z net',
        facebookPageId: null,
        instagramUsername: null,
        instagramAccountId: null,
        whatsappPhoneNumberId: null,
        whatsappDisplayPhoneNumber: null,
        whatsappConnected: false,
        whatsappAutoReplyEnabled: false,
        whatsappCoexistence: null,
        whatsappDisconnectReason: null,
        instagramAutoReplyEnabled: false,
        autoReplyEnabled: false,
        autoReplyDisabledReason: null,
        disconnected: false,
        disconnectReason: null,
        replyMode: null,
        replyModeEffective: 'sales',
        brandVoiceNotesMulti: null,
        // Never read by this component; the KB summary belongs to KbSection.
        kb: {} as CustomerPage['kb'],
        ...overrides,
    };
}

const label = (platform: 'platformFacebook' | 'platformInstagram' | 'platformWhatsApp', on: boolean) =>
    `${commentsEn[platform]}: ${on ? commonEn.enabled : commonEn.disabled}`;

describe('PageChannelStatus (admin page card)', () => {
    it('a WhatsApp-only card with WhatsApp replying reads ON, whatever the Facebook column says', () => {
        // The shipped defect: facebook_page_id NULL ⇒ auto_reply_enabled false by
        // definition, and the pill read that column alone.
        render(<PageChannelStatus page={page({
            autoReplyEnabled: false,
            whatsappPhoneNumberId: '1181482325054612',
            whatsappConnected: true,
            whatsappAutoReplyEnabled: true,
        })} />);

        expect(screen.getByText(adminEn.customer.pageReplyOn)).toBeInTheDocument();
        expect(screen.queryByText(adminEn.customer.pageReplyOff)).not.toBeInTheDocument();
        // Exactly one badge — the WhatsApp channel — and it is colored, not muted.
        expect(screen.getByLabelText(label('platformWhatsApp', true)).className).not.toContain('text-icon-muted');
        expect(screen.queryByLabelText(label('platformFacebook', false))).not.toBeInTheDocument();
    });

    it('shows WHICH channel is off: Facebook muted, WhatsApp colored, pill still ON', () => {
        render(<PageChannelStatus page={page({
            facebookPageId: 'fb-1',
            autoReplyEnabled: false,
            autoReplyDisabledReason: 'user',
            whatsappConnected: true,
            whatsappAutoReplyEnabled: true,
        })} />);

        expect(screen.getByText(adminEn.customer.pageReplyOn)).toBeInTheDocument();
        expect(screen.getByLabelText(label('platformFacebook', false)).className).toContain('text-icon-muted');
        expect(screen.getByLabelText(label('platformWhatsApp', true)).className).not.toContain('text-icon-muted');
    });

    it('reads OFF with the recorded reason only when every connected channel is off', () => {
        render(<PageChannelStatus page={page({
            facebookPageId: 'fb-1',
            autoReplyEnabled: false,
            autoReplyDisabledReason: 'trial_block',
            instagramUsername: 'shop',
            instagramAutoReplyEnabled: false,
        })} />);

        expect(screen.getByText(adminEn.customer.pageOffTrialUsed)).toBeInTheDocument();
        expect(screen.getByLabelText(label('platformFacebook', false)).className).toContain('text-icon-muted');
        expect(screen.getByLabelText(label('platformInstagram', false)).className).toContain('text-icon-muted');
    });

    it('a disconnected card reads Disconnected regardless of toggles', () => {
        render(<PageChannelStatus page={page({
            facebookPageId: 'fb-1',
            autoReplyEnabled: true,
            disconnected: true,
        })} />);

        expect(screen.getByText(adminEn.customer.pageDisconnected)).toBeInTheDocument();
    });
});
