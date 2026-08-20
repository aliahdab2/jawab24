import React from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Info, Sparkles, SlidersHorizontal } from 'lucide-react';
import clsx from 'clsx';
import { hasPagePersonaPin } from '@jawab24/shared';
import { Card } from '@/components/ui';
import type { CustomerDetail, CustomerSettings } from './types';

interface Props {
    customer: CustomerDetail;
}

type SettingsValues = CustomerSettings['values'];

// Which settings to show, grouped as a support agent thinks about them. Keys map
// to i18n `customer.setting_<key>`; membership in `nonDefaultKeys` draws a marker.
const SETTING_GROUPS: { titleKey: string; keys: (keyof SettingsValues)[] }[] = [
    {
        titleKey: 'customer.settingsGroupReplies',
        keys: ['aiEnabled', 'aiModel', 'commentsAutoReply', 'messagesAutoReply', 'commentReplyMode', 'replyMode', 'holdLowConfidence', 'replyDelay'],
    },
    {
        titleKey: 'customer.settingsGroupLanguage',
        keys: ['defaultReplyLanguage', 'autoDetectLanguage', 'supportedLanguages'],
    },
    {
        titleKey: 'customer.settingsGroupHours',
        keys: ['businessHoursOnly', 'businessHoursStart', 'businessHoursEnd', 'timezone'],
    },
    {
        titleKey: 'customer.settingsGroupMessages',
        keys: ['greetingMessageEnabled', 'limitFallbackEnabled', 'newLeadAlertsEnabled', 'notificationsEnabled'],
    },
];

export function SettingsSection({ customer }: Props) {
    const t = useTranslations('admin');
    const settings = customer.settings;

    if (!settings) {
        return (
            <Card>
                <p className="text-sm text-muted-foreground">{t('customer.settingsNeverCreated')}</p>
            </Card>
        );
    }

    const { values, nonDefaultKeys } = settings;
    const nonDefault = new Set(nonDefaultKeys);
    const personaPlaceholder = customer.health.some(f => f.key === 'persona_placeholder');
    // Pages whose own persona pin makes the workspace text below unreachable.
    // `?? []` matches the guard OverviewSection already applies to this field:
    // the type says required, but a team-member-only account has no pages and
    // this card must render for them regardless.
    const personaPinnedPages = (customer.pages ?? []).filter(p => hasPagePersonaPin(p.brandVoiceNotesMulti));

    const formatValue = (key: keyof SettingsValues): string => {
        const v = values[key];
        if (v == null || v === '') return '—';
        if (typeof v === 'boolean') return v ? t('customer.valOn') : t('customer.valOff');
        if (Array.isArray(v)) return v.join(', ');
        return String(v);
    };

    // Persona variants. The jsonb is `{ ar, en, sourceLang }` — `sourceLang` is
    // METADATA, not a language, so iterating raw keys printed the string "en"
    // as if it were persona text. Pull it out and use it as a caption instead.
    const { sourceLang, ...langVariants } = values.brandVoiceNotesMulti ?? {};
    const variants = Object.entries(langVariants).filter(([, txt]) => txt && txt.trim());

    // Only the merchant-AUTHORED text is shown in full — a machine translation of
    // a 400-word persona is noise for support, and the legacy `brandVoiceNotes`
    // column is just an en-preferring sync of this jsonb (so printing it first
    // showed an Arabic merchant's persona in English). sourceLang names the
    // authored language; 'manual' means every language is hand-written and
    // missing/'default' means authorship is unknown — show all variants in both
    // cases. Rows predating the multi column only have brandVoiceNotes.
    const authoredLang =
        sourceLang && sourceLang !== 'manual' && sourceLang !== 'default' && langVariants[sourceLang]?.trim()
            ? String(sourceLang)
            : null;
    const shownVariants = authoredLang ? variants.filter(([lang]) => lang === authoredLang) : variants;
    const translatedLangs = authoredLang ? variants.filter(([lang]) => lang !== authoredLang).map(([lang]) => lang) : [];
    const legacyNotes = variants.length === 0 ? (values.brandVoiceNotes ?? '').trim() : '';

    return (
        <div className="space-y-6">
            {/* The backend overlays the workspace store (what the reply pipeline
                actually reads, D-026) before sending values. When that overlay
                could not run, the values below are the raw legacy row — the
                exact state that once showed 30 silent merchants as healthy —
                so the degradation must never pass silently. */}
            {settings.source === 'legacy-fallback' && (
                <div className="flex items-start gap-2 status-warning border rounded-lg px-3 py-2" role="alert">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                    <span className="text-sm">{t('customer.settingsLegacyFallbackWarn')}</span>
                </div>
            )}

            {/* Persona / brand voice */}
            <Card className="space-y-4">
                <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
                    {t('customer.settingsPersona')}
                </h3>

                {personaPlaceholder && (
                    <div className="flex items-start gap-2 status-warning border rounded-lg px-3 py-2">
                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                        <span className="text-sm">{t('customer.personaPlaceholderWarn')}</span>
                    </div>
                )}

                {/* This card shows the WORKSPACE persona. A page carrying its own
                    pin (D-084) ignores it completely — resolveBrandVoiceNotes
                    resolves inside the override with no workspace fallback — so
                    without this line the text below reads as "what every page
                    says", which for the pinned pages is the opposite of true.
                    Same trap D-087 fixed for reply mode; the pinned pages are
                    named because those are the ones support was called about. */}
                {personaPinnedPages.length > 0 && (
                    <div className="flex items-start gap-2 bg-muted border border-theme-border rounded-lg px-3 py-2">
                        <Info className="w-4 h-4 mt-0.5 shrink-0 text-icon-muted" aria-hidden="true" />
                        <span className="text-sm text-muted-foreground" dir="auto">
                            {t('customer.personaPageOverrideNote', {
                                count: personaPinnedPages.length,
                                pages: personaPinnedPages.map(p => p.name || p.id).join('، '),
                            })}
                        </span>
                    </div>
                )}

                <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{t('customer.setting_replyStyle')}</span>
                    <span className="inline-flex px-2.5 py-0.5 text-xs font-medium rounded-full status-brand border">
                        {values.replyStyle || '—'}
                    </span>
                </div>

                {legacyNotes && (
                    <pre className="text-sm text-foreground whitespace-pre-wrap break-words bg-muted rounded-lg p-3 font-sans" dir="auto">
                        {legacyNotes}
                    </pre>
                )}

                {shownVariants.map(([lang, txt]) => (
                    <div key={lang}>
                        {/* The language label only earns its row when several variants show
                            (hand-written in both languages / unknown authorship) — for a
                            single authored text the caption below already names it. */}
                        {shownVariants.length > 1 && (
                            <span className="text-xs font-medium text-muted-foreground uppercase">{lang}</span>
                        )}
                        <pre className="text-sm text-foreground whitespace-pre-wrap break-words bg-muted rounded-lg p-3 font-sans mt-1" dir="auto">
                            {txt}
                        </pre>
                    </div>
                ))}

                {(authoredLang || translatedLangs.length > 0) && (
                    <p className="text-xs text-muted-foreground">
                        {authoredLang && t('customer.personaSourceLang', { lang: authoredLang.toUpperCase() })}
                        {authoredLang && translatedLangs.length > 0 && ' · '}
                        {translatedLangs.length > 0 && t('customer.personaAutoTranslatedTo', { langs: translatedLangs.join(', ').toUpperCase() })}
                    </p>
                )}

                {!legacyNotes && variants.length === 0 && (
                    <p className="text-sm text-muted-foreground">{t('customer.personaEmpty')}</p>
                )}
            </Card>

            {/* Settings / toggles */}
            <Card className="space-y-5">
                <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <SlidersHorizontal className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
                    {t('customer.settingsToggles')}
                </h3>

                {SETTING_GROUPS.map(group => (
                    <div key={group.titleKey}>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                            {t(group.titleKey as Parameters<typeof t>[0])}
                        </h4>
                        <dl className="divide-y divide-theme-border">
                            {group.keys.map(key => {
                                const changed = nonDefault.has(key);
                                return (
                                    <div key={key} className="flex items-center justify-between gap-3 py-1.5">
                                        <dt className="text-sm text-muted-foreground flex items-center gap-1.5">
                                            {changed && (
                                                <span
                                                    className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"
                                                    title={t('customer.nonDefault')}
                                                    aria-label={t('customer.nonDefault')}
                                                />
                                            )}
                                            {t(`customer.setting_${key}` as Parameters<typeof t>[0])}
                                        </dt>
                                        <dd className={clsx('text-sm text-end', changed ? 'text-foreground font-medium' : 'text-foreground')} dir="auto">
                                            {formatValue(key)}
                                        </dd>
                                    </div>
                                );
                            })}
                        </dl>
                    </div>
                ))}
            </Card>
        </div>
    );
}
