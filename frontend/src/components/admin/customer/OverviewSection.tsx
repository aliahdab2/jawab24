import React from 'react';
import { useTranslations } from 'next-intl';
import { Calendar, FileText, Zap, Globe, Mail, Facebook, Instagram, ExternalLink, Users } from 'lucide-react';
import clsx from 'clsx';
import { Card, WhatsAppIcon, PLATFORM_TINT } from '@/components/ui';
import {
    type CustomerDetail,
    type FormatDate,
    type IntlLocale,
    EMPTY_LEADS,
    PAGE_OFF_REASON_KEYS,
} from './types';
import { PageModeBadges } from './PageModeBadges';

interface Props {
    customer: CustomerDetail;
    formatDate: FormatDate;
    intlLocale: IntlLocale;
}

export function OverviewSection({ customer, formatDate, intlLocale }: Props) {
    const t = useTranslations('admin');
    const leads = customer.leads ?? EMPTY_LEADS;

    return (
        <div className="space-y-6">
            {/* Profile Card */}
            <Card>
                <h3 className="text-lg font-semibold text-foreground mb-4">
                    {t('customer.profile')}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="flex items-center gap-3">
                        <Mail className="w-5 h-5 text-muted-foreground" />
                        <div>
                            <div className="text-xs text-muted-foreground">{t('customer.email')}</div>
                            <div className="font-medium">{customer.email || '-'}</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <Facebook className="w-5 h-5 text-muted-foreground" />
                        <div>
                            <div className="text-xs text-muted-foreground">{t('customer.facebookId')}</div>
                            <div className="font-medium font-mono text-sm">{customer.facebookId}</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <Calendar className="w-5 h-5 text-muted-foreground" />
                        <div>
                            <div className="text-xs text-muted-foreground">{t('customer.signedUp')}</div>
                            <div className="font-medium">{formatDate(customer.createdAt)}</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <Globe className="w-5 h-5 text-muted-foreground" />
                        <div>
                            <div className="text-xs text-muted-foreground">{t('customer.pagesCount')}</div>
                            <div className="font-medium">{customer.pages.length}</div>
                        </div>
                    </div>
                </div>
            </Card>

            {/* Connected Pages */}
            <Card>
                <h3 className="text-lg font-semibold text-foreground mb-4">
                    {t('customer.pagesCount')}
                </h3>
                {customer.pages && customer.pages.length > 0 ? (
                    <ul className="space-y-2">
                        {customer.pages.map((p) => {
                            const fbHref = p.facebookPageId ? `https://www.facebook.com/${p.facebookPageId}` : null;
                            const igHref = p.instagramUsername ? `https://www.instagram.com/${p.instagramUsername}` : null;
                            // wa.me needs bare digits; the stored display number is formatted.
                            const waDigits = p.whatsappDisplayPhoneNumber?.replace(/\D/g, '') || null;
                            const waHref = waDigits ? `https://wa.me/${waDigits}` : null;
                            // A card with no Facebook page is a WhatsApp-only card — showing it
                            // behind a Facebook avatar misreads the whole row at a glance.
                            const isWhatsAppOnly = !p.facebookPageId && !!p.whatsappPhoneNumberId;
                            const primaryHref = fbHref || igHref || waHref;
                            return (
                                <li
                                    key={p.id}
                                    className="group flex items-center gap-3 p-3 border border-theme-border rounded-lg hover:bg-muted/50 hover:border-brand-300 transition-colors"
                                >
                                    <div className={clsx(
                                        'w-10 h-10 rounded-full flex items-center justify-center shrink-0',
                                        isWhatsAppOnly ? PLATFORM_TINT.whatsapp : PLATFORM_TINT.facebook,
                                    )}>
                                        {isWhatsAppOnly ? <WhatsAppIcon className="w-5 h-5" /> : <Facebook className="w-5 h-5" />}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        {primaryHref ? (
                                            <a
                                                href={primaryHref}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="font-medium text-foreground hover:text-brand-600 hover:underline truncate block"
                                            >
                                                {p.name || t('customer.unnamedPage')}
                                            </a>
                                        ) : (
                                            <div className="font-medium truncate">{p.name || t('customer.unnamedPage')}</div>
                                        )}
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground" dir="ltr">
                                            {p.facebookPageId && (
                                                <span className="font-mono truncate">{p.facebookPageId}</span>
                                            )}
                                            {p.facebookPageId && p.instagramUsername && <span aria-hidden>·</span>}
                                            {p.instagramUsername && (
                                                <span className="inline-flex items-center gap-1 truncate">
                                                    <Instagram className="w-3 h-3" />
                                                    @{p.instagramUsername}
                                                </span>
                                            )}
                                            {(p.facebookPageId || p.instagramUsername) && p.whatsappPhoneNumberId && <span aria-hidden>·</span>}
                                            {p.whatsappPhoneNumberId && (
                                                <span className="inline-flex items-center gap-1 truncate" title={p.whatsappCoexistence ? t('customer.whatsappCoexistence') : undefined}>
                                                    <WhatsAppIcon className="w-3 h-3" />
                                                    {p.whatsappDisplayPhoneNumber || p.whatsappPhoneNumberId}
                                                    {/* Coexistence changes what support can tell a merchant: the number
                                                        is ALSO live on their phone, so "we stopped replying" may mean
                                                        they answered it themselves. Worth seeing at a glance. */}
                                                    {p.whatsappCoexistence && <span aria-hidden>↔</span>}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <span
                                            className={clsx(
                                                'text-xs px-2 py-0.5 rounded-full border whitespace-nowrap',
                                                p.disconnected
                                                    ? 'status-error'
                                                    : p.autoReplyEnabled
                                                        ? 'status-success'
                                                        : 'status-warning',
                                            )}
                                        >
                                            {p.disconnected
                                                ? t('customer.pageDisconnected')
                                                : p.autoReplyEnabled
                                                    ? t('customer.pageReplyOn')
                                                    : t(
                                                        (p.autoReplyDisabledReason && PAGE_OFF_REASON_KEYS[p.autoReplyDisabledReason])
                                                        || 'customer.pageReplyOff',
                                                    )}
                                        </span>
                                        {/* Mode + persona, on EVERY page. Shared with the
                                            Business Info cards via PageModeBadges — see the
                                            rationale there for why 'sales' is no longer
                                            hidden and why the persona pin earns a badge. */}
                                        <PageModeBadges page={p} />
                                        {fbHref && (
                                            <a
                                                href={fbHref}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                aria-label={t('customer.viewOnFacebook')}
                                                title={t('customer.viewOnFacebook')}
                                                className="p-2 rounded-md text-muted-foreground hover:text-[#1877F2] hover:bg-background transition-colors"
                                            >
                                                <Facebook className="w-4 h-4" />
                                            </a>
                                        )}
                                        {igHref && (
                                            <a
                                                href={igHref}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                aria-label={t('customer.viewOnInstagram')}
                                                title={t('customer.viewOnInstagram')}
                                                className="p-2 rounded-md text-muted-foreground hover:text-[#E4405F] hover:bg-background transition-colors"
                                            >
                                                <Instagram className="w-4 h-4" />
                                            </a>
                                        )}
                                        {waHref && (
                                            <a
                                                href={waHref}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                aria-label={t('customer.openWhatsApp')}
                                                title={t('customer.openWhatsApp')}
                                                className="p-2 rounded-md text-muted-foreground hover:text-[#128C7E] hover:bg-background transition-colors"
                                            >
                                                <WhatsAppIcon className="w-4 h-4" />
                                            </a>
                                        )}
                                        {primaryHref && (
                                            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/60 ms-1" aria-hidden />
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <p className="text-muted-foreground">{t('customer.noPages')}</p>
                )}
            </Card>

            {/* Usage Card */}
            <Card>
                <h3 className="text-lg font-semibold text-foreground mb-4">
                    {t('customer.usage')}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-background rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <Zap className="w-4 h-4 text-brand-500" />
                            <span className="text-sm text-muted-foreground">
                                {t('customer.aiReplies')}
                            </span>
                        </div>
                        <div className="text-2xl font-bold text-foreground">
                            {customer.usage.aiRepliesCount}
                            {customer.usage.limit !== null && (
                                <span className="text-sm font-normal text-muted-foreground">
                                    {' '}/ {customer.usage.limit}
                                </span>
                            )}
                        </div>
                        {customer.usage.limit !== null && (
                            <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-brand-500 rounded-full"
                                    style={{
                                        width: `${Math.min(100, (customer.usage.aiRepliesCount / customer.usage.limit) * 100)}%`
                                    }}
                                />
                            </div>
                        )}
                    </div>
                    <div className="bg-background rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <FileText className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">
                                {t('customer.postReplies')}
                            </span>
                        </div>
                        <div className="text-2xl font-bold text-foreground">
                            {customer.usage.postRepliesCount}
                        </div>
                    </div>
                </div>
            </Card>

            {/* Leads Card — captured leads from messages and comments across all pages */}
            <Card>
                <div className="flex items-center gap-2 mb-4">
                    <Users className="w-5 h-5 text-brand-500" />
                    <h3 className="text-lg font-semibold text-foreground">
                        {t('customer.leadsTitle')}
                    </h3>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                    <div className="bg-background rounded-lg p-3">
                        <p className="text-xs text-muted-foreground">{t('customer.leadsTotal')}</p>
                        <p className="text-2xl font-bold text-foreground">{leads.total.toLocaleString(intlLocale)}</p>
                    </div>
                    <div className="bg-background rounded-lg p-3">
                        <p className="text-xs text-muted-foreground">{t('customer.leadsToday')}</p>
                        <p className="text-2xl font-bold text-foreground">{leads.today.toLocaleString(intlLocale)}</p>
                    </div>
                    <div className="bg-background rounded-lg p-3">
                        <p className="text-xs text-muted-foreground">{t('customer.leadsLast7d')}</p>
                        <p className="text-2xl font-bold text-foreground">{leads.last7d.toLocaleString(intlLocale)}</p>
                    </div>
                    <div className="bg-background rounded-lg p-3">
                        <p className="text-xs text-muted-foreground">{t('customer.leadsLast30d')}</p>
                        <p className="text-2xl font-bold text-foreground">{leads.last30d.toLocaleString(intlLocale)}</p>
                    </div>
                </div>
                {leads.total > 0 && (
                    <div className="grid grid-cols-3 gap-3">
                        <div className="bg-background rounded-lg p-3">
                            <p className="text-xs text-muted-foreground">{t('customer.leadsStatusNew')}</p>
                            <p className="text-lg font-bold text-foreground">{leads.byStatus.new.toLocaleString(intlLocale)}</p>
                        </div>
                        <div className="bg-background rounded-lg p-3">
                            <p className="text-xs text-muted-foreground">{t('customer.leadsStatusContacted')}</p>
                            <p className="text-lg font-bold text-foreground">{leads.byStatus.contacted.toLocaleString(intlLocale)}</p>
                        </div>
                        <div className="bg-background rounded-lg p-3">
                            <p className="text-xs text-muted-foreground">{t('customer.leadsStatusConverted')}</p>
                            <p className="text-lg font-bold text-foreground">{leads.byStatus.converted.toLocaleString(intlLocale)}</p>
                        </div>
                    </div>
                )}
            </Card>
        </div>
    );
}
