/**
 * Regression suite for the WhatsApp language bug reported 2026-07-29.
 *
 * REPRODUCTION (the exact screenshot, an Arabic-KB training institute on WhatsApp):
 *
 *   customer 13:18  "What is the courses do you have ?"   → replied ENGLISH  ✓
 *   customer 13:18  "Quels cours proposez-vous ?"         → replied ENGLISH  ✗ BUG
 *   customer 13:19  "Hangi kurslarınız var?"              → replied TURKISH  ✓
 *
 * Turkish worked because `ı` hits the detector's char-only Turkish branch. French
 * failed because THIS French sentence is ACCENT-FREE: every legacy branch needs a
 * diacritic, so it falls through to the Latin default en@0.5 ("Latin script,
 * recognized nothing"), and the tinyld override can't help either — its gate
 * requires a non-ASCII LETTER, which is what keeps ASCII Arabizi from being
 * mislabelled Spanish. So LANG_ENGINE=tinyld does NOT fix this case; the detector
 * genuinely cannot tell accent-free French from English, and neither can any
 * off-the-shelf LID at this length.
 *
 * The defect is therefore NOT the detection — it is that we take a NON-detection
 * and assert it to the model as fact: "The customer wrote in English. Do NOT
 * switch to another language." The model knew the message was French and obeyed
 * us anyway. Industry standard (Intercom Fin, researched 2026-07-29) says a
 * below-threshold read must be labelled "undetermined" and fall through — never
 * asserted as a positive reading.
 *
 * Fix under test: the prompt may only claim "the customer wrote in X" when X came
 * from a POSITIVE reading of the current message. When X came from the history
 * anchor / post / KB / merchant default, the directive keeps X as the sticky
 * default but explicitly authorises the model to mirror the customer's language
 * when THIS message is visibly in another one.
 */
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../src/services/reply/promptBuilder';
import { validateReply } from '../src/services/reply/replyValidator';
import type { GenerateRequest } from '../src/services/reply/types';

/** The Arabic-KB institute from the screenshot, mid-thread on WhatsApp. */
const institute = (currentMessage: string, priorCustomerTurn: string): GenerateRequest => ({
    comment: currentMessage,
    // No explicit `language`: the backend only passes one when its own detector
    // names a NON-'en' language. Accent-free French reads en@0.5, so nothing is
    // passed and the ai-worker's chain resolves from history — the bug's entry point.
    context: {
        channel: 'dm',
        pageName: 'معهد الدمشقي للتدريب',
        knowledgeBase: 'نقدم دورات في الطاقة الشمسية، الكهرباء المنزلية، التمريض، ICDL، إدخال البيانات، إكسل المتقدم، اللغة الإنجليزية، التركية، الألمانية.',
        conversationHistory: [
            { role: 'user', content: priorCustomerTurn },
            { role: 'assistant', content: 'We offer a variety of courses including Solar Energy Installation and Maintenance, Home Electricity, Nursing, ICDL, Data Entry, Advanced Excel, English language levels, Turkish, German.' },
        ],
    },
});

const FRENCH_DM = 'Quels cours proposez-vous ?';
const PRIOR_ENGLISH_TURN = 'What is the courses do you have ?';

describe('the screenshot bug: French DM on an English-anchored Arabic thread', () => {
    it('reproduces the setup — the resolved language is English, from the history anchor and NOT from the French message', () => {
        // This is the precondition, and it stays true after the fix: we are not
        // claiming to detect French. Accent-free French is an accepted detection miss.
        const prompt = buildSystemPrompt(institute(FRENCH_DM, PRIOR_ENGLISH_TURN));
        expect(prompt).toContain('Reply language: English');
    });

    it('must NOT assert to the model that the customer wrote in English', () => {
        const prompt = buildSystemPrompt(institute(FRENCH_DM, PRIOR_ENGLISH_TURN));
        // The false statement that caused the bug.
        expect(prompt).not.toContain('The customer wrote in English');
        // ...and the ban that stopped the model from self-correcting.
        expect(prompt).not.toContain('You MUST reply in English');
    });

    it('must authorise mirroring the customer\'s own language for THIS message', () => {
        const prompt = buildSystemPrompt(institute(FRENCH_DM, PRIOR_ENGLISH_TURN));
        expect(prompt).toMatch(/repl(y|ies) in the (same )?language the customer used|mirror the customer's language/i);
    });

    it('still forbids letting the Arabic knowledge base pick the reply language', () => {
        // The softened directive must NOT reopen the known failure mode where an
        // all-Arabic KB + Arabic persona pulls the reply to Arabic (114 of 156
        // language_mismatch flags are expected:en → reply:ar).
        const prompt = buildSystemPrompt(institute(FRENCH_DM, PRIOR_ENGLISH_TURN));
        expect(prompt).toMatch(/<business_knowledge>/);
        expect(prompt).toMatch(/never let .*<business_knowledge>.* language|not .*because .*<business_knowledge>|regardless of .*<business_knowledge>/i);
    });
});

describe('a POSITIVE reading of the current message keeps the hard directive', () => {
    it('Turkish (named from its own characters) still gets "You MUST reply in Turkish"', () => {
        // The screenshot's Turkish message worked and must keep working: the backend
        // detects 'tr' and passes it explicitly, which is a positive current-message read.
        const req: GenerateRequest = {
            ...institute('Hangi kurslarınız var?', PRIOR_ENGLISH_TURN),
            language: 'tr',
        };
        const prompt = buildSystemPrompt(req);
        expect(prompt).toContain('You MUST reply in Turkish');
        expect(prompt).toContain('The customer wrote in Turkish');
    });

    it('Arabic (the money path) still gets the hard directive — unchanged', () => {
        const req: GenerateRequest = {
            ...institute('ما هي الدورات المتوفرة؟', 'كم سعر دورة ICDL؟'),
            language: 'ar',
        };
        const prompt = buildSystemPrompt(req);
        expect(prompt).toContain('You MUST reply in Arabic');
        expect(prompt).toContain('The customer wrote in Arabic');
    });

    it('a clearly-English message keeps the hard directive (no drift to Arabic on an Arabic-KB page)', () => {
        // Production faithfulness matters here: the backend reads this as en@0.9 (real
        // English stopwords), so it sends BOTH language:'en' and languageCertain:true —
        // `language: deferToHistory ? undefined : msgLang` with deferToHistory false.
        // This must not be softened into an invitation to answer in the KB's Arabic.
        const req: GenerateRequest = {
            ...institute('What is the price of the nursing course please?', PRIOR_ENGLISH_TURN),
            language: 'en',
            languageCertain: true,
        };
        const prompt = buildSystemPrompt(req);
        expect(prompt).toContain('You MUST reply in English');
        expect(prompt).toContain('The customer wrote in English');
    });
});

/**
 * The validator re-resolves the language independently, so it has to agree with the
 * directive. If it did not, EVERY reply the fix makes correct would be flagged
 * `language_mismatch` — which for QUESTION-like intents means needs_attention
 * (computeNeedsAttention treats any flag as meaningful) and bars the reply from the
 * reply cache (cacheQualityGate denies that flag). Correct behaviour would have
 * looked like a defect to the merchant.
 */
describe('validator agrees with the directive it validated against', () => {
    const frenchReply = {
        reply: 'Nous proposons des cours d\'énergie solaire, d\'électricité, de soins infirmiers, ICDL et de langues.',
        intent: 'QUESTION',
        confidence: 'high' as const,
        language: 'fr',
        flags: [],
    };

    it('does NOT flag a mirrored language switch when the resolved language was uncertain', () => {
        const request: GenerateRequest = {
            comment: FRENCH_DM,
            language: 'en',
            languageCertain: false,
            context: { channel: 'dm', pageName: 'معهد الدمشقي للتدريب', knowledgeBase: 'دورات ICDL واللغات.' },
        };
        const result = validateReply(frenchReply, request);
        expect(result.flags).not.toContain('language_mismatch');
        expect(result.flags.some(f => f.startsWith('expected_lang:'))).toBe(false);
    });

    it('STILL flags a mismatch when the language WAS a positive reading', () => {
        // Arabic customer, French reply — a real defect, and it must keep surfacing.
        const request: GenerateRequest = {
            comment: 'ما هي الدورات المتوفرة؟',
            language: 'ar',
            languageCertain: true,
            context: { channel: 'dm', pageName: 'معهد الدمشقي للتدريب', knowledgeBase: 'دورات ICDL واللغات.' },
        };
        const result = validateReply(frenchReply, request);
        expect(result.flags).toContain('language_mismatch');
        expect(result.flags).toContain('expected_lang:ar');
        expect(result.flags).toContain('reply_lang:fr');
    });
});

describe('the floor read is soft even with no history to defer to', () => {
    it('first-message accent-free French: backend passes en explicitly but flags it uncertain', () => {
        // No prior history ⇒ the backend's deferToHistory gate does NOT fire, so it
        // sends language:'en' for the en@0.5 floor read. languageCertain:false is the
        // only thing separating this from a real English detection — without it this
        // case keeps the hard "The customer wrote in English" and stays broken.
        const req: GenerateRequest = {
            comment: FRENCH_DM,
            language: 'en',
            languageCertain: false,
            context: { channel: 'dm', pageName: 'معهد الدمشقي للتدريب', knowledgeBase: 'نقدم دورات في ICDL واللغة الإنجليزية.' },
        };
        const prompt = buildSystemPrompt(req);
        expect(prompt).not.toContain('The customer wrote in English');
        expect(prompt).toContain('mirror the customer\'s language');
        // English is still the stated default — we are not guessing French, just
        // letting the model correct us.
        expect(prompt).toContain('Reply language: English');
    });
});
