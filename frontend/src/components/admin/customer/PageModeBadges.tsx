import React from 'react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { hasPagePersonaPin, isReplyMode } from '@jawab24/shared';
import type { CustomerDetail } from './types';

type CustomerPage = CustomerDetail['pages'][number];

/**
 * The per-page overrides that decide how a page answers, rendered in one place
 * because two sections show them (the Connected Pages list and each Business
 * Info card) and a page whose mode reads differently in two tabs is worse than
 * one that shows it nowhere.
 *
 * Both badges exist for the SAME reason, recorded in D-087 for reply mode and
 * true again for persona (D-084): the effective value is page-then-workspace, so
 * a console that shows only the workspace value tells support the wrong thing
 * for exactly the pages someone deliberately configured — and those are the
 * pages support gets called about. The ticket that brings them here is
 * «توقف عن أخذ أرقام الزبائن» or «الردود بتحكي بلهجة غلط»; neither is answerable
 * from a workspace-scoped value.
 */
export function PageModeBadges({ page, className }: { page: CustomerPage; className?: string }) {
    const t = useTranslations('admin');

    const mode = page.replyModeEffective;
    // `isReplyMode` is what resolveEffectiveReplyMode itself uses to decide
    // whether the stored varchar counts as an override, so "pinned" here means
    // exactly what it means to the pipeline. Comparing `replyMode === mode`
    // instead would agree by accident today and diverge the moment a third mode
    // exists or an unknown string is stored.
    const pinned = isReplyMode(page.replyMode);
    // The SAME predicate the reply pipeline decides the pin with
    // (resolveBrandVoiceNotes → resolvePagePersonaLanguages), not a lookalike:
    // `sourceLang` is bookkeeping rather than a language and a whitespace-only
    // variant is not content, so a hand-rolled `Object.keys(...).length > 0`
    // here would claim a pin the pipeline does not honour. Importing it costs
    // nothing extra — MessageMerchantModal already pulls the shared barrel into
    // this same page's bundle.
    const personaPinned = hasPagePersonaPin(page.brandVoiceNotesMulti);

    return (
        <div className={clsx('flex flex-wrap items-center gap-1', className)}>
            {/* Shown for sales too, not just info. 'sales' being the default is
                why it used to be hidden ("a badge on every page is noise") — but
                an ABSENT badge is not read as "sales", it is read as "this
                console does not know", which is the state that sent support to
                the workspace value in the first place. */}
            {mode && (
                <span
                    className={clsx(
                        'text-xs px-2 py-0.5 rounded-full border whitespace-nowrap',
                        mode === 'info' ? 'status-warning' : 'status-brand',
                    )}
                    title={pinned ? t('customer.pageModePinnedHint') : t('customer.pageModeInheritedHint')}
                >
                    {mode === 'info' ? t('customer.pageModeInfo') : t('customer.pageModeSales')}
                    {/* An inherited mode is fixed on the workspace and flips with
                        it; a pin survives a workspace flip. Support has to change
                        a different setting depending on which it is. */}
                    <span className="opacity-70">
                        {' · '}
                        {pinned ? t('customer.pageModePinned') : t('customer.pageModeInherited')}
                    </span>
                </span>
            )}

            {/* A persona pin suppresses the workspace persona ENTIRELY for this
                page, so the text on the Settings tab reaches none of its
                customers. Without this badge that difference is invisible. */}
            {personaPinned && (
                <span
                    className="text-xs px-2 py-0.5 rounded-full border whitespace-nowrap status-brand"
                    title={t('customer.pagePersonaPinnedHint')}
                >
                    {t('customer.pagePersonaPinned')}
                </span>
            )}
        </div>
    );
}
