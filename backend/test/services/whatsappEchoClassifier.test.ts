import { describe, it, expect } from 'vitest';
import {
    classifyEcho,
    APP_AUTO_WINDOW_MS,
    APP_AUTO_INACTIVITY_DAYS,
} from '../../src/services/whatsappEchoClassifier';

/**
 * The rule is WhatsApp's own greeting definition ("first message, or after 14
 * days of no activity") measured against production on 2026-08-29: app
 * greetings arrive 1–4 s after the inbound; no human answered a conversation
 * opener in under 10 s across 729 inbox replies. See D-109.
 */
describe('classifyEcho — WhatsApp Coexistence echo authorship', () => {
    it('pins the measured constants (change them with new evidence, not by accident)', () => {
        expect(APP_AUTO_WINDOW_MS).toBe(10_000);
        expect(APP_AUTO_INACTIVITY_DAYS).toBe(14);
    });

    // The production case: «صباح الخير» 06:03:12 → app greeting echo 06:03:16.
    it('APP: an echo seconds after a conversation opener is the app greeting', () => {
        expect(classifyEcho({ msSinceLastInbound: 4_000, priorInboundBeforeWindow: false })).toBe('app_auto');
    });

    it('APP: right at the window edge still counts', () => {
        expect(classifyEcho({ msSinceLastInbound: APP_AUTO_WINDOW_MS, priorInboundBeforeWindow: false })).toBe('app_auto');
    });

    // Retry path: the inbound row was written while we waited, so its created_at
    // is a little LATER than the echo's receipt time.
    it('APP: a small negative gap (inbound stored during the re-read) is still fast', () => {
        expect(classifyEcho({ msSinceLastInbound: -800, priorInboundBeforeWindow: false })).toBe('app_auto');
    });

    // A customer's 2–3-message burst is not an active thread: priorInboundBeforeWindow
    // is measured from the window EDGE, so the caller passes false here.
    it('APP: an opener sent as a burst of messages is still an opener', () => {
        expect(classifyEcho({ msSinceLastInbound: 1_500, priorInboundBeforeWindow: false })).toBe('app_auto');
    });

    // Fastest human reply to an opener in 90 days of production: 10–30 s.
    it('HUMAN: a reply slower than the window is a typed reply', () => {
        expect(classifyEcho({ msSinceLastInbound: APP_AUTO_WINDOW_MS + 1, priorInboundBeforeWindow: false })).toBe('manual');
        expect(classifyEcho({ msSinceLastInbound: 100_000, priorInboundBeforeWindow: false })).toBe('manual');
    });

    // The failure the rule must never produce: a merchant mid-conversation on
    // the phone answers within seconds; the AI must NOT talk over them.
    it('HUMAN: a fast reply inside an ACTIVE thread is a typed reply', () => {
        expect(classifyEcho({ msSinceLastInbound: 2_000, priorInboundBeforeWindow: true })).toBe('manual');
    });

    it('HUMAN: with no inbound at all (merchant-initiated outreach, or a row we never stored)', () => {
        expect(classifyEcho({ msSinceLastInbound: null, priorInboundBeforeWindow: false })).toBe('manual');
    });

    it('HUMAN: an absurdly negative gap is not trusted as "fast"', () => {
        expect(classifyEcho({ msSinceLastInbound: -APP_AUTO_WINDOW_MS - 1, priorInboundBeforeWindow: false })).toBe('manual');
    });
});
