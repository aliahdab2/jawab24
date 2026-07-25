import { describe, it, expect } from 'vitest';
import { senderNameKeyHash, replyMentionsName } from '../../src/utils/senderName';

describe('senderNameKeyHash — per-name cache bucket', () => {
    // THE regression (prod 2026-07-25). The old first-token key hashed «أبو» for every
    // customer whose name begins with the kunya particle, so a reply that addressed one
    // of them BY NAME could be served to a different person entirely.
    it('separates two customers who share a kunya particle', () => {
        expect(senderNameKeyHash('أبو حسان شومان')).not.toBe(senderNameKeyHash('أبو خالد'));
    });

    it('separates two customers who share a theophoric prefix', () => {
        expect(senderNameKeyHash('عبد الرحمن')).not.toBe(senderNameKeyHash('عبد الله'));
    });

    it('separates two customers who share a given name but not a family name', () => {
        expect(senderNameKeyHash('أحمد علي')).not.toBe(senderNameKeyHash('أحمد محمد'));
    });

    it('is stable across alef variants, case, and whitespace padding', () => {
        expect(senderNameKeyHash('  احمد  علي ')).toBe(senderNameKeyHash('أحمد علي'));
        expect(senderNameKeyHash('Sarah Smith')).toBe(senderNameKeyHash('sarah   smith'));
    });

    it('returns null when nothing usable survives normalization', () => {
        expect(senderNameKeyHash('')).toBeNull();
        expect(senderNameKeyHash('   ')).toBeNull();
        expect(senderNameKeyHash('!!! ???')).toBeNull();
    });

    it('is 16 hex chars — the width the gender-map key uses, for the same collision reason', () => {
        expect(senderNameKeyHash('أبو حسان')).toMatch(/^[0-9a-f]{16}$/);
    });
});

describe('replyMentionsName — shared-bucket guard', () => {
    it('catches the part of the name the model actually used, not just the leading token', () => {
        // The model is handed «أبو حسان شومان» and shortens it to «أبو حسان» itself.
        expect(replyMentionsName('أهلاً يا أبو حسان! كيف بقدر ساعدك؟', 'أبو حسان شومان')).toBe(true);
        // ...or drops the kunya and uses the given name alone.
        expect(replyMentionsName('تكرم عينك حسان', 'أبو حسان شومان')).toBe(true);
    });

    it('catches a family name used on its own', () => {
        expect(replyMentionsName('أهلاً أستاذ شومان', 'أبو حسان شومان')).toBe(true);
    });

    it('matches across alef variants and case', () => {
        expect(replyMentionsName('اهلا احمد', 'أحمد علي')).toBe(true);
        expect(replyMentionsName('Hi SARAH!', 'Sarah Smith')).toBe(true);
    });

    it('is false for a reply that never names the customer', () => {
        expect(replyMentionsName('السعر 35 ألف ليرة.', 'أبو حسان شومان')).toBe(false);
        expect(replyMentionsName('The price is 35,000.', 'Sarah Smith')).toBe(false);
    });

    // The guard gates entry to the SHARED cache buckets, so every false positive
    // demotes a perfectly shareable reply to the per-name tier. Arabic attaches
    // pronouns and particles to the word, so substring matching (what this started
    // as) fires on ordinary reply text that names nobody.
    it.each([
        ['علي', 'شكراً عليك كتير'],
        ['حسن', 'أحسن سعر عنا'],
        ['نور', 'نورت المحل'],
        ['سما', 'عندنا سماعات'],
        ['رنا', 'بنرناوي عالسعر'],
    ])('does not fire on «%s» merely appearing INSIDE a reply word: %s', (name, reply) => {
        expect(replyMentionsName(reply, name)).toBe(false);
    });

    it('still fires when the same name stands as its own word', () => {
        expect(replyMentionsName('شكراً علي', 'علي')).toBe(true);
        expect(replyMentionsName('نور، السعر 35 ألف', 'نور')).toBe(true);
    });

    it('ignores single-character tokens — initials collide with ordinary words', () => {
        // 'و' as a standalone token must not make every Arabic reply (which is full of
        // the conjunction و) look like it named the customer.
        expect(replyMentionsName('السعر 35 ألف وبنوصلك خلال يومين', 'و')).toBe(false);
        expect(replyMentionsName('Sure, we deliver.', 'J K')).toBe(false);
    });

    it('is false for an empty name', () => {
        expect(replyMentionsName('أهلاً بك', '')).toBe(false);
    });
});
