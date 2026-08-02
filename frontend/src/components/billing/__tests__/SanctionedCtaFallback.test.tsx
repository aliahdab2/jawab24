import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SanctionedCtaFallback } from '../SanctionedCtaFallback';
import { PaymentsUnavailableNotice } from '@/components/PaymentsUnavailableNotice';
import { GEO_CACHE_KEY } from '@/utils/geoCheck';
import en from '@/i18n/en/payment.json';

/**
 * The sanctioned surfaces carry two things support depends on:
 *
 *  1. A WhatsApp message that names payment/pricing. One support number serves
 *     every entry point, so a generic "I want to ask about Jawab24" leaves the
 *     merchant's question unattributable — the reason this text changed.
 *  2. The region-specific rail. Stripe cannot charge a Syrian card, but Sham
 *     Cash exists, so a Syrian merchant must be told rather than left at a dead
 *     end. Every other blocked region must NOT see it, and neither must a
 *     merchant whose country we failed to resolve — an unknown country is the
 *     fail-closed path, and guessing there would point someone at a payment
 *     method they cannot use.
 *
 * Strings are imported from the locale JSON, never retyped, so a copy edit
 * moves the assertion with it.
 */

function cacheCountry(country: string | undefined) {
  localStorage.setItem(
    GEO_CACHE_KEY,
    JSON.stringify({ sanctioned: true, country, timestamp: Date.now() }),
  );
}

describe('SanctionedCtaFallback', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('names pricing/payment in the WhatsApp message so support knows the source', () => {
    render(<SanctionedCtaFallback />);
    const link = screen.getByRole('link', { name: en.unavailable.supportLink });
    expect(decodeURIComponent(link.getAttribute('href') ?? '')).toContain(
      en.unavailable.whatsappMessagePricing,
    );
  });

  it('offers Sham Cash to a merchant in Syria', () => {
    cacheCountry('SY');
    render(<SanctionedCtaFallback />);
    expect(screen.getByText(en.unavailable.localAlternative)).toBeInTheDocument();
  });

  it('does not offer Sham Cash in another blocked region', () => {
    cacheCountry('IR');
    render(<SanctionedCtaFallback />);
    expect(screen.queryByText(en.unavailable.localAlternative)).not.toBeInTheDocument();
  });

  it('does not offer Sham Cash when the country is unknown', () => {
    // isUserSanctioned() fails CLOSED — it can block with no country resolved.
    cacheCountry(undefined);
    render(<SanctionedCtaFallback />);
    expect(screen.queryByText(en.unavailable.localAlternative)).not.toBeInTheDocument();
  });

  it('does not offer Sham Cash when no geo check has run at all', () => {
    render(<SanctionedCtaFallback />);
    expect(screen.queryByText(en.unavailable.localAlternative)).not.toBeInTheDocument();
  });

  it('honours the SIMULATE_SANCTIONS country override', () => {
    // The documented way to preview this copy. It writes no cache entry, so the
    // component has to read the flag itself — pinned here because a regression
    // would be invisible until someone tried to test the feature.
    localStorage.setItem('SIMULATE_SANCTIONS', 'SY');
    render(<SanctionedCtaFallback />);
    expect(screen.getByText(en.unavailable.localAlternative)).toBeInTheDocument();
  });
});

describe('PaymentsUnavailableNotice', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('offers Sham Cash to a merchant in Syria', () => {
    cacheCountry('SY');
    render(<PaymentsUnavailableNotice />);
    expect(screen.getByText(en.unavailable.localAlternative)).toBeInTheDocument();
  });

  it('does not offer Sham Cash in another blocked region', () => {
    cacheCountry('CU');
    render(<PaymentsUnavailableNotice />);
    expect(screen.queryByText(en.unavailable.localAlternative)).not.toBeInTheDocument();
  });

  it('sends a translated, payment-scoped WhatsApp message', () => {
    render(<PaymentsUnavailableNotice />);
    const link = screen.getByRole('link', { name: en.unavailable.contactWhatsApp });
    const href = decodeURIComponent(link.getAttribute('href') ?? '');
    expect(href).toContain(en.unavailable.whatsappMessageCheckout);
    // The old copy was a hardcoded English string that bypassed i18n entirely.
    expect(href).not.toContain("I'd like to upgrade my Jawab24 account");
  });
});
