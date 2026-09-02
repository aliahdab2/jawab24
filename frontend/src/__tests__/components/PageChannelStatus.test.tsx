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
        whatsappNeedsReconnect: false,
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

    it('a severed WhatsApp link reads "needs reconnecting", never ON — the Z net shape', () => {
        // Token valid, toggle on, link severed at Meta: this exact card showed a
        // green "Auto-reply on" pill through a 27h webhook outage (2026-09-01).
        render(<PageChannelStatus page={page({
            whatsappPhoneNumberId: '1181482325054612',
            whatsappConnected: true,
            whatsappAutoReplyEnabled: true,
            whatsappDisconnectReason: 'app_uninstalled',
            whatsappNeedsReconnect: true,
        })} />);

        expect(screen.getByText(adminEn.customer.pageWhatsappReconnect)).toBeInTheDocument();
        expect(screen.queryByText(adminEn.customer.pageReplyOn)).not.toBeInTheDocument();
        // The badge stays colored (the toggle IS on) and carries the amber dot;
        // its aria label — the accessible carrier — says needs reconnecting.
        const waLabel = `${commentsEn.platformWhatsApp}: ${commonEn.needsReconnect}`;
        expect(screen.getByLabelText(waLabel).className).not.toContain('text-icon-muted');
        expect(screen.getByTestId('channel-reconnect-dot-whatsapp')).toBeInTheDocument();
    });

    it('a stale reason on a card with no WhatsApp channel does NOT read "needs reconnecting"', () => {
        // The SAME guard computeHealthFlags applies (whatsappConnected), pinned
        // by the health suite's twin case: WhatsApp disconnected entirely (token
        // cleared) with the reason column surviving. A red reconnect pill here
        // would point support at a number the card no longer carries.
        render(<PageChannelStatus page={page({
            facebookPageId: 'fb-1',
            autoReplyEnabled: true,
            whatsappConnected: false,
            whatsappDisconnectReason: 'app_uninstalled',
            whatsappNeedsReconnect: true,
        })} />);

        expect(screen.queryByText(adminEn.customer.pageWhatsappReconnect)).not.toBeInTheDocument();
        expect(screen.getByText(adminEn.customer.pageReplyOn)).toBeInTheDocument();
        // No WhatsApp channel ⇒ no badge, no dot.
        expect(screen.queryByTestId('channel-reconnect-dot-whatsapp')).not.toBeInTheDocument();
    });

    it('Disconnected outranks the severed-WhatsApp pill when both hold', () => {
        // A dead primary credential is the bigger fault — the reconnect pill
        // must not mask it. Pins the branch order, which is all that decides it.
        render(<PageChannelStatus page={page({
            facebookPageId: 'fb-1',
            disconnected: true,
            whatsappConnected: true,
            whatsappAutoReplyEnabled: true,
            whatsappDisconnectReason: 'app_uninstalled',
            whatsappNeedsReconnect: true,
        })} />);

        expect(screen.getByText(adminEn.customer.pageDisconnected)).toBeInTheDocument();
        expect(screen.queryByText(adminEn.customer.pageWhatsappReconnect)).not.toBeInTheDocument();
    });
});
