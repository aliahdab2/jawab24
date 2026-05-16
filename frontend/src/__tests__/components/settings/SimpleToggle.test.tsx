import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Bot } from 'lucide-react';
import { SimpleToggle } from '@/components/settings/SimpleToggle';

/**
 * Regression tests for SimpleToggle's `prominent` hero variant.
 *
 * Renders the real Toggle from @/components/ui (only deps are next-intl —
 * globally mocked in test/setup.ts — and clsx) so we don't duplicate the
 * inline Toggle mock present in CommentsAutoReplyCard.test.tsx etc.
 *
 * Asserts on class membership rather than visual snapshots: the prominent
 * variant is fully expressed through Tailwind utility classes, so checking
 * for the semantic class (`shadow-card-glow`) and the larger icon container
 * (`w-14`) gives durable signal without coupling to compiled CSS.
 */
describe('SimpleToggle', () => {
    const noop = vi.fn();

    function rootEl() {
        // SimpleToggle structure: outer div → (left content wrapper, Toggle).
        // The Toggle renders as <button role="switch"> — explicit role beats the
        // implicit "button" role. The Toggle's parent IS the outer root.
        const toggleSwitch = screen.getByRole('switch', { name: 'Smart Replies' });
        return toggleSwitch.parentElement!;
    }

    // Treat the className string as a set of tokens. Substring matching falsely
    // hits "landscape:w-12" when asserting on "w-12"; split-and-check avoids that.
    function hasClass(el: HTMLElement, cls: string): boolean {
        return el.className.split(/\s+/).includes(cls);
    }

    describe('default (non-prominent) variant', () => {
        it('does not apply the hero brand glow when enabled', () => {
            render(
                <SimpleToggle
                    icon={<Bot />}
                    title="Smart Replies"
                    description="Toggle smart replies"
                    enabled={true}
                    onChange={noop}
                />,
            );
            // Hero glow class must be reserved for prominent. Default enabled state
            // uses the lighter `shadow-sm`.
            expect(hasClass(rootEl(), 'shadow-card-glow')).toBe(false);
            expect(hasClass(rootEl(), 'shadow-sm')).toBe(true);
        });

        it('uses the standard 12x12 icon container', () => {
            render(
                <SimpleToggle
                    icon={<Bot data-testid="icon" />}
                    title="Smart Replies"
                    description="Toggle smart replies"
                    enabled={true}
                    onChange={noop}
                />,
            );
            const iconContainer = screen.getByTestId('icon').parentElement!;
            expect(hasClass(iconContainer, 'w-12')).toBe(true);
            expect(hasClass(iconContainer, 'w-14')).toBe(false);
        });
    });

    describe('prominent variant', () => {
        it('applies shadow-card-glow when enabled', () => {
            render(
                <SimpleToggle
                    icon={<Bot />}
                    title="Smart Replies"
                    description="Toggle smart replies"
                    enabled={true}
                    onChange={noop}
                    prominent
                />,
            );
            // The semantic-class signal we care about: prominent + enabled lights
            // up the brand glow. If a future refactor inlines the shadow recipe
            // again (a bug we already had to fix once), this assertion catches it.
            expect(hasClass(rootEl(), 'shadow-card-glow')).toBe(true);
        });

        it('does NOT apply shadow-card-glow when disabled', () => {
            render(
                <SimpleToggle
                    icon={<Bot />}
                    title="Smart Replies"
                    description="Toggle smart replies"
                    enabled={false}
                    onChange={noop}
                    prominent
                />,
            );
            // Glow is conditional on enabled state, not on prominent alone — make
            // sure we don't accidentally promote disabled state to a hero look.
            expect(hasClass(rootEl(), 'shadow-card-glow')).toBe(false);
            expect(hasClass(rootEl(), 'bg-card')).toBe(true);
        });

        it('uses the larger 14x14 icon container with landscape downshift', () => {
            render(
                <SimpleToggle
                    icon={<Bot data-testid="icon" />}
                    title="Smart Replies"
                    description="Toggle smart replies"
                    enabled={true}
                    onChange={noop}
                    prominent
                />,
            );
            const iconContainer = screen.getByTestId('icon').parentElement!;
            // Base size w-14 (prominent), with landscape:w-12 to fit shorter
            // landscape viewports. The base `w-12` token (without landscape:
            // prefix) must NOT be present — that would mean the default-variant
            // size is leaking through.
            expect(hasClass(iconContainer, 'w-14')).toBe(true);
            expect(hasClass(iconContainer, 'landscape:w-12')).toBe(true);
            expect(hasClass(iconContainer, 'w-12')).toBe(false);
        });

        it('uses larger padding (p-5) with landscape downshift (p-4)', () => {
            render(
                <SimpleToggle
                    icon={<Bot />}
                    title="Smart Replies"
                    description="Toggle smart replies"
                    enabled={true}
                    onChange={noop}
                    prominent
                />,
            );
            // Prominent uses p-5 base, p-4 in landscape. The unprefixed p-4 (the
            // default-variant padding) must not be present.
            expect(hasClass(rootEl(), 'p-5')).toBe(true);
            expect(hasClass(rootEl(), 'landscape:p-4')).toBe(true);
            expect(hasClass(rootEl(), 'p-4')).toBe(false);
        });
    });
});
