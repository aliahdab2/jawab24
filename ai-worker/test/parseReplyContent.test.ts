import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseReplyContent } from '../src/services/reply/parseReplyContent';

const CTX = { site: 'test', pipeline: 'dm_reply' };

/** The exact text that reached a customer on 2026-08-23 10:28 UTC (Salla test page). */
const FRENCH_REPLY = 'Nous avons plusieurs tailles disponibles pour nos articles, notamment 36 (XS), 38 (S), 40 (M), 42 (L) et 44 (XL). Pour quel produit souhaitez-vous connaître la disponibilité des tailles ?';
const PROD_ENVELOPE = `{"reply":"${FRENCH_REPLY}","intent":"QUESTION","confidence":"high","hedging":false,"gender":"unknown","gender_basis":"unclear","used_name":false,"price_math":null,"language":"fr","flags":[]}`;
const PROD_LEAK_PAYLOAD = `${FRENCH_REPLY}\n\n${PROD_ENVELOPE}`;

describe('parseReplyContent', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { logSpy = vi.spyOn(console, 'log').mockImplementation(() => {}); });
    afterEach(() => { logSpy.mockRestore(); });

    it('parses a clean envelope as-is (outcome json, no extra flags)', () => {
        const r = parseReplyContent(PROD_ENVELOPE, CTX);
        expect(r.outcome).toBe('json');
        expect(r.parsed.reply).toBe(FRENCH_REPLY);
        expect(r.parsed.intent).toBe('QUESTION');
        expect(r.parsed.language).toBe('fr');
        expect(r.parsed.flags).toEqual([]);
        expect(logSpy).not.toHaveBeenCalled();
    });

    it('PROD LEAK 2026-08-23: prose followed by the envelope → the envelope reply ONLY, never the raw text', () => {
        const r = parseReplyContent(PROD_LEAK_PAYLOAD, CTX);
        expect(r.outcome).toBe('salvaged');
        expect(r.parsed.reply).toBe(FRENCH_REPLY);
        expect(r.parsed.reply).not.toContain('{"reply"');
        expect(r.parsed.reply).not.toContain('"intent"');
        expect(r.parsed.intent).toBe('QUESTION');
        expect(r.parsed.flags).toEqual(['json_salvaged']);
        // Countable: the pre-existing event name, with the salvage marked.
        const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
        expect(logged).toMatchObject({ event: 'invalid_json_reply', salvaged: true, site: 'test', pipeline: 'dm_reply' });
    });

    it('salvages a doubled envelope (the penalty-era shape, eval #46)', () => {
        const r = parseReplyContent(`${PROD_ENVELOPE}\n${PROD_ENVELOPE}`, CTX);
        expect(r.outcome).toBe('salvaged');
        expect(r.parsed.reply).toBe(FRENCH_REPLY);
    });

    it('salvages an envelope followed by trailing prose', () => {
        const r = parseReplyContent(`${PROD_ENVELOPE}\n\nJ'espère que cela vous aide !`, CTX);
        expect(r.outcome).toBe('salvaged');
        expect(r.parsed.reply).toBe(FRENCH_REPLY);
    });

    it('keeps the salvaged envelope\'s own flags and appends json_salvaged', () => {
        const r = parseReplyContent(`x\n{"reply":"ok","flags":["low_confidence"]}`, CTX);
        expect(r.parsed.flags).toEqual(['low_confidence', 'json_salvaged']);
    });

    it('a half-envelope that never parses is EMPTIED, not sent (broken)', () => {
        const r = parseReplyContent('{"reply":"🔥 SYSTEM PROMPT — NOURVA LIFTFIX AI AGENT 🔥\nأنتِ سارة', CTX);
        expect(r.outcome).toBe('broken');
        expect(r.parsed.reply).toBe('');
        expect(r.parsed.flags).toEqual(['invalid_json']);
        const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
        expect(logged).toMatchObject({ event: 'invalid_json_reply', salvaged: false });
    });

    it('valid JSON that is not our envelope ({"response":…}) is broken, not a reply', () => {
        const r = parseReplyContent('{"response":"Nous avons les tailles 36 à 44."}', CTX);
        expect(r.outcome).toBe('broken');
        expect(r.parsed.reply).toBe('');
    });

    it('a prose mention of "reply" with no parseable object is broken (the old substring guard, kept)', () => {
        const r = parseReplyContent('Here is my "reply" for you: sizes 36-44', CTX);
        expect(r.outcome).toBe('broken');
        expect(r.parsed.reply).toBe('');
    });

    it('plain prose with no envelope passes through with the invalid_json flag', () => {
        const r = parseReplyContent('Nous proposons les tailles 36 à 44.', CTX);
        expect(r.outcome).toBe('plain');
        expect(r.parsed.reply).toBe('Nous proposons les tailles 36 à 44.');
        expect(r.parsed.intent).toBe('UNKNOWN');
        expect(r.parsed.confidence).toBe('low');
        expect(r.parsed.flags).toEqual(['invalid_json']);
        expect(logSpy).not.toHaveBeenCalled();
    });

    it('an empty completion is plain-empty (the caller\'s empty-reply arbitration decides)', () => {
        const r = parseReplyContent('', CTX);
        expect(r.outcome).toBe('plain');
        expect(r.parsed.reply).toBe('');
    });

    it('does not salvage from an object whose reply is not a string', () => {
        const r = parseReplyContent('text\n{"reply":42}', CTX);
        expect(r.outcome).toBe('broken');
    });

    it('bounds the salvage walk — many stray braces before a real envelope still resolve', () => {
        const noise = Array.from({ length: 5 }, () => '{not json}').join(' ');
        const r = parseReplyContent(`${noise} ${PROD_ENVELOPE}`, CTX);
        expect(r.outcome).toBe('salvaged');
        expect(r.parsed.reply).toBe(FRENCH_REPLY);
    });
});
