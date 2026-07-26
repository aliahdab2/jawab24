import React from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Sparkles, SlidersHorizontal } from 'lucide-react';
import clsx from 'clsx';
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
        keys: ['aiEnabled', 'aiModel', 'commentsAutoReply', 'messagesAutoReply', 'commentReplyMode', 'holdLowConfidence', 'replyDelay'],
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
    const baseNotes = (values.brandVoiceNotes ?? '').trim();
    const hasBaseNotes = Boolean(baseNotes);

    // A translation identical to the original is not worth a second copy of a
    // 400-word persona — it only matters THAT it exists. Show the differing
    // ones in full; collapse the identical ones to their language codes.
    const variants = Object.entries(langVariants).filter(([, txt]) => txt && txt.trim());
    const differingVariants = variants.filter(([, txt]) => txt.trim() !== baseNotes);
    const identicalLangs = variants.filter(([, txt]) => txt.trim() === baseNotes).map(([lang]) => lang);

    return (
        <div className="space-y-6">
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

                <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{t('customer.setting_replyStyle')}</span>
                    <span className="inline-flex px-2.5 py-0.5 text-xs font-medium rounded-full status-brand border">
                        {values.replyStyle || '—'}
                    </span>
                </div>

                {hasBaseNotes && (
                    <pre className="text-sm text-foreground whitespace-pre-wrap break-words bg-muted rounded-lg p-3 font-sans" dir="auto">
                        {values.brandVoiceNotes}
                    </pre>
                )}

                {differingVariants.map(([lang, txt]) => (
                    <div key={lang}>
                        <span className="text-xs font-medium text-muted-foreground uppercase">{lang}</span>
                        <pre className="text-sm text-foreground whitespace-pre-wrap break-words bg-muted rounded-lg p-3 font-sans mt-1" dir="auto">
                            {txt}
                        </pre>
                    </div>
                ))}

                {(identicalLangs.length > 0 || sourceLang) && (
                    <p className="text-xs text-muted-foreground">
                        {identicalLangs.length > 0 && t('customer.personaSameAsOriginal', { langs: identicalLangs.join(', ').toUpperCase() })}
                        {identicalLangs.length > 0 && sourceLang && ' · '}
                        {sourceLang && t('customer.personaSourceLang', { lang: String(sourceLang).toUpperCase() })}
                    </p>
                )}

                {!hasBaseNotes && variants.length === 0 && (
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
