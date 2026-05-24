import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { Check, MessageCircle, CreditCard, Mail, AlertCircle } from 'lucide-react';
import { Modal, Button } from '@/components/ui';
import { subscriptionApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { buildWhatsAppUrl } from '@/lib/whatsapp';

type Pack = '5k' | '10k';

interface TopupConfig {
    packs: Record<string, { repliesAdded: number; priceCents: number }>;
    currency: string;
    whatsappNumber: string;
}

interface TopUpRequestModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** User's primary email for the prefilled WhatsApp/email message. */
    userEmail?: string;
}

const PACKS_ORDER: Pack[] = ['5k', '10k'];
const SUPPORT_EMAIL = 'support@jawab24.com';

/**
 * Modal that lets a paying user request a top-up pack.
 *
 * Three render states keep the UX honest about what's actually possible:
 *
 *  - loading: skeleton placeholders, no actionable elements
 *  - available: pack picker + WhatsApp purchase path (the happy path)
 *  - unavailable: clean "coming soon" message with a working email fallback —
 *    never shows pack pricing or "select your pack" UI when there's no way to
 *    buy, since that mismatch was confusing users on the prod degraded state
 *    (whatsappNumber unset → pack picker visible but no purchase path)
 *
 * v0 ships ONLY the manual / WhatsApp purchase path. Card payment is stubbed
 * visually as "coming soon" so users see the future direction. PR 2b will wire
 * the actual Stripe PaymentElement here.
 */
export function TopUpRequestModal({ isOpen, onClose, userEmail }: TopUpRequestModalProps) {
    const t = useTranslations('topup');
    const [selectedPack, setSelectedPack] = useState<Pack>('5k');
    const [config, setConfig] = useState<TopupConfig | null>(null);
    const [loadError, setLoadError] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        // Reset both before fetching so stale data from a previous open doesn't
        // flash through before the new request resolves.
        setConfig(null);
        setLoadError(false);
        subscriptionApi.getTopupConfig()
            .then((res) => setConfig(res.data.data))
            .catch((err) => {
                captureError(err, 'Failed to load top-up config');
                setLoadError(true);
            });
    }, [isOpen]);

    // Inline the channel check below rather than computing a derived boolean
    // so TypeScript can narrow `config` and `config.whatsappNumber` through
    // the guard without needing a non-null assertion in the happy path.
    const isLoading = !config && !loadError;

    // Loading state: skeleton inside the same modal shell so the user sees the
    // title immediately and doesn't perceive a layout shift when config lands.
    if (isLoading) {
        return (
            <Modal isOpen={isOpen} onClose={onClose} title={t('modal.title')} size="md">
                <div className="space-y-4" aria-busy="true">
                    <div className="h-4 w-3/4 bg-surface-200 dark:bg-surface-700 rounded animate-pulse" />
                    <div className="grid grid-cols-2 gap-3">
                        {PACKS_ORDER.map((p) => <PackSkeleton key={p} />)}
                    </div>
                    <div className="h-16 bg-surface-100 dark:bg-surface-800 rounded animate-pulse" />
                </div>
            </Modal>
        );
    }

    // Unavailable state: config failed OR loaded but no purchase channel
    // configured. Render a coherent "coming soon" card with an actual fallback
    // contact instead of mixing pack pricing with a "service unavailable" error.
    if (loadError || !config || !config.whatsappNumber) {
        return (
            <Modal isOpen={isOpen} onClose={onClose} title={t('unavailable.title')} size="md">
                <UnavailableState onClose={onClose} userEmail={userEmail} loadError={loadError} />
            </Modal>
        );
    }

    // Available state — TS now narrows `config` and `config.whatsappNumber`
    // through the guard above. We still need to guard on `pack` because the
    // backend response could theoretically omit a known pack id (defensive).
    const pack = config.packs[selectedPack];
    if (!pack) {
        return (
            <Modal isOpen={isOpen} onClose={onClose} title={t('unavailable.title')} size="md">
                <UnavailableState onClose={onClose} userEmail={userEmail} loadError={true} />
            </Modal>
        );
    }

    // Two i18n keys (with/without email line) keep translator-facing strings
    // simple — no embedded select syntax — and let phone-only users (no email
    // on file) avoid a dangling "My email: " line in the prefilled message.
    const messageKey = userEmail ? 'modal.whatsappMessageWithEmail' : 'modal.whatsappMessage';
    const whatsappUrl = buildWhatsAppUrl(
        config.whatsappNumber,
        t(messageKey, {
            repliesCount: pack.repliesAdded,
            pack: selectedPack,
            priceUsd: pack.priceCents / 100,
            email: userEmail ?? '',
        }),
    );

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('modal.title')} size="md">
            <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    {t('modal.subtitle')}
                </p>

                {/* Pack picker */}
                <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t('modal.selectPack')}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                        {PACKS_ORDER.map((p) => (
                            <PackOption
                                key={p}
                                pack={p}
                                priceCents={config.packs[p]?.priceCents}
                                selected={selectedPack === p}
                                onSelect={() => setSelectedPack(p)}
                            />
                        ))}
                    </div>
                    <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                        {t('modal.neverExpires')}
                    </p>
                </div>

                {/* Payment methods */}
                <div className="space-y-2 pt-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t('modal.contactToBuy')}
                    </p>

                    {/* Card payment — disabled stub (PR 2b will enable) */}
                    <div
                        className="flex items-start gap-3 p-3 rounded-lg border border-surface-200 dark:border-surface-700 opacity-60"
                        aria-disabled="true"
                    >
                        <CreditCard className="w-5 h-5 text-icon-muted shrink-0 mt-0.5" aria-hidden="true" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold">{t('method.card')}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{t('method.cardSubtitle')}</p>
                        </div>
                    </div>

                    {/* WhatsApp manual path */}
                    <a
                        href={whatsappUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-3 p-3 rounded-lg border border-emerald-300 hover:border-emerald-400 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30 transition-colors"
                    >
                        <MessageCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold">{t('method.whatsapp')}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{t('method.whatsappSubtitle')}</p>
                        </div>
                    </a>
                </div>

                <div className="flex justify-end pt-2">
                    <Button variant="secondary" size="sm" onClick={onClose}>
                        {t('modal.close')}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

interface UnavailableStateProps {
    onClose: () => void;
    userEmail?: string;
    /** True when config fetch failed outright vs. config loaded but no channel configured. */
    loadError: boolean;
}

/**
 * Coherent fallback when no purchase channel is available. Shows a clean
 * "coming soon" card and a mailto fallback so the user always has an
 * actionable next step — never just a vague "contact support" string.
 *
 * Emits a Sentry breadcrumb on mount so the team knows the unavailable state
 * is firing in prod (typically means `JAWAB24_SUPPORT_WHATSAPP` got unset, an
 * ops issue we should not learn about from customer complaints).
 */
function UnavailableState({ onClose, userEmail, loadError }: UnavailableStateProps) {
    const t = useTranslations('topup');

    // Telemetry: surface the unavailable state to monitoring. The two causes
    // (load failure vs. missing channel config) have different remediation —
    // one is transient/client-side, the other is an ops misconfiguration.
    useEffect(() => {
        captureError(
            new Error(loadError ? 'topup_config_load_failed' : 'topup_no_whatsapp_configured'),
            'Top-up modal rendered unavailable state',
            { tags: { feature: 'topup', cause: loadError ? 'load_failed' : 'no_channel' } },
        );
    }, [loadError]);

    const bodyKey = userEmail ? 'unavailable.emailBodyWithEmail' : 'unavailable.emailBody';
    const subject = encodeURIComponent(t('unavailable.emailSubject'));
    const body = encodeURIComponent(t(bodyKey, { email: userEmail ?? '' }));
    const mailto = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;

    return (
        <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-surface-100 dark:bg-surface-800">
                <AlertCircle
                    className="w-5 h-5 text-icon-muted shrink-0 mt-0.5"
                    aria-hidden="true"
                />
                <p className="text-sm text-foreground leading-relaxed">
                    {loadError ? t('errors.loadFailed') : t('unavailable.message')}
                </p>
            </div>

            <a
                href={mailto}
                className="flex items-center justify-center gap-2 w-full p-3 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-semibold transition-colors"
            >
                <Mail className="w-4 h-4" aria-hidden="true" />
                {t('unavailable.emailButton')}
            </a>

            <div className="flex justify-end">
                <Button variant="secondary" size="sm" onClick={onClose}>
                    {t('modal.close')}
                </Button>
            </div>
        </div>
    );
}

interface PackOptionProps {
    pack: Pack;
    /** Price in cents from backend config. Always defined in the available state. */
    priceCents: number | undefined;
    selected: boolean;
    onSelect: () => void;
}

function PackOption({ pack, priceCents, selected, onSelect }: PackOptionProps) {
    const t = useTranslations('topup');
    const isBestValue = pack === '10k';

    return (
        <button
            type="button"
            onClick={onSelect}
            aria-pressed={selected}
            className={clsx(
                'relative p-4 rounded-lg border-2 text-start transition-colors',
                selected
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30'
                    : 'border-surface-200 hover:border-surface-300 dark:border-surface-700 dark:hover:border-surface-600',
            )}
        >
            {isBestValue && (
                <span className="absolute -top-2 end-2 bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {t('pack10k.bestValue')}
                </span>
            )}
            <p className="text-sm font-semibold">{pack === '5k' ? t('pack5k.name') : t('pack10k.name')}</p>
            <p className="text-xl font-bold mt-1">
                {priceCents !== undefined ? `$${priceCents / 100}` : '—'}
            </p>
        </button>
    );
}

function PackSkeleton() {
    return (
        <div
            aria-hidden="true"
            className="p-4 rounded-lg border-2 border-surface-200 dark:border-surface-700 animate-pulse"
        >
            <div className="h-3.5 w-24 bg-surface-200 dark:bg-surface-700 rounded mb-2" />
            <div className="h-6 w-14 bg-surface-200 dark:bg-surface-700 rounded" />
        </div>
    );
}
