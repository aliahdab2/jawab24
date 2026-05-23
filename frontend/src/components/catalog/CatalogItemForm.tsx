import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { Button } from '@/components/ui';
import type { CatalogItem, CatalogItemType, CreateCatalogItemPayload } from '@/lib/api';

const TYPES: CatalogItemType[] = ['course', 'product', 'service', 'event', 'branch', 'package'];

// Common currencies for our market. Free-typing is risky (typos break formatting
// in CatalogItemCard's Intl.NumberFormat); keep the picker constrained.
const CURRENCIES = ['USD', 'EUR', 'SAR', 'AED', 'EGP', 'JOD', 'KWD', 'QAR', 'TRY', 'SYP'] as const;

// Types where temporal fields make semantic sense. Hidden for the rest so
// merchants aren't asked to enter a "start date" for, say, a physical product.
const TYPES_WITH_DATES = new Set<CatalogItemType>(['course', 'event']);
// Types where enrollment-closes is meaningful (only courses, in practice).
const TYPES_WITH_ENROLLMENT = new Set<CatalogItemType>(['course']);
// Types where price is meaningful (everything except locations).
const TYPES_WITH_PRICE = new Set<CatalogItemType>(['course', 'product', 'service', 'event', 'package']);

interface Props {
    pageId: string;
    /** When provided, the form pre-fills these values and submits via update; otherwise create. */
    initialItem?: CatalogItem | null;
    onSubmit: (payload: CreateCatalogItemPayload) => Promise<void>;
    onCancel: () => void;
    /** Disable inputs + submit while the mutation is in flight. */
    isSubmitting?: boolean;
}

interface FormState {
    type: CatalogItemType;
    name: string;
    description: string;
    /** Price as a decimal string (e.g. "29.99"). Converted to priceMinor on submit. */
    priceText: string;
    currency: string;
    /** YYYY-MM-DD strings from native <input type="date">. */
    startsAt: string;
    endsAt: string;
    enrollmentClosesAt: string;
}

function isoToDateInput(iso: string | null | undefined): string {
    if (!iso) return '';
    // Take the date portion of the ISO string — native date input accepts YYYY-MM-DD only.
    return iso.slice(0, 10);
}

function dateInputToIso(value: string): string | null {
    if (!value) return null;
    // Treat the date as UTC midnight. Matches Stage 2.2 server-side handling of native date inputs.
    return `${value}T00:00:00.000Z`;
}

function priceMinorToText(priceMinor: number | null | undefined): string {
    if (priceMinor == null) return '';
    return (priceMinor / 100).toString();
}

function textToPriceMinor(text: string): number | null {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    if (!Number.isFinite(num) || num < 0) return null;
    return Math.round(num * 100);
}

function initialFormState(item: CatalogItem | null | undefined): FormState {
    return {
        type: item?.type ?? 'course',
        name: item?.name ?? '',
        description: item?.description ?? '',
        priceText: priceMinorToText(item?.priceMinor),
        currency: item?.currency ?? 'USD',
        startsAt: isoToDateInput(item?.startsAt),
        endsAt: isoToDateInput(item?.endsAt),
        enrollmentClosesAt: isoToDateInput(item?.enrollmentClosesAt),
    };
}

export function CatalogItemForm({ pageId, initialItem, onSubmit, onCancel, isSubmitting }: Props) {
    const t = useTranslations('catalog');
    const tc = useTranslations('common');

    const [state, setState] = useState<FormState>(() => initialFormState(initialItem));
    const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

    // Auto-focus the first meaningful field when the form mounts so the
    // merchant can start typing immediately. Skipped on edit to avoid
    // accidentally selecting & overtyping an existing name.
    const nameRef = useRef<HTMLInputElement | null>(null);
    useEffect(() => {
        if (!initialItem && nameRef.current) nameRef.current.focus();
    }, [initialItem]);

    const DESCRIPTION_MAX = 4000;

    const showDates = TYPES_WITH_DATES.has(state.type);
    const showEnrollment = TYPES_WITH_ENROLLMENT.has(state.type);
    const showPrice = TYPES_WITH_PRICE.has(state.type);

    const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
        setState(prev => ({ ...prev, [key]: value }));
        // Clear the error for this field as the user edits — preserves errors on untouched fields.
        if (errors[key]) setErrors(prev => ({ ...prev, [key]: undefined }));
    };

    const validate = (): boolean => {
        const next: Partial<Record<keyof FormState, string>> = {};

        if (!state.name.trim()) next.name = t('form.errNameRequired');
        else if (state.name.length > 200) next.name = t('form.errNameTooLong');

        if (state.description.length > 4000) next.description = t('form.errDescriptionTooLong');

        if (showPrice && state.priceText.trim()) {
            const minor = textToPriceMinor(state.priceText);
            if (minor === null) next.priceText = t('form.errPriceInvalid');
            if (!state.currency) next.currency = t('form.errCurrencyRequired');
        }

        if (showDates && state.startsAt && state.endsAt && state.endsAt < state.startsAt) {
            next.endsAt = t('form.errEndsBeforeStarts');
        }
        if (showEnrollment && state.enrollmentClosesAt && state.startsAt && state.enrollmentClosesAt > state.startsAt) {
            next.enrollmentClosesAt = t('form.errEnrollmentAfterStarts');
        }

        setErrors(next);
        return Object.keys(next).length === 0;
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!validate()) return;

        const priceMinor = showPrice && state.priceText.trim() ? textToPriceMinor(state.priceText) : null;
        const payload: CreateCatalogItemPayload = {
            pageId,
            type: state.type,
            name: state.name.trim(),
            description: state.description.trim() || null,
            priceMinor,
            currency: priceMinor !== null ? state.currency : null,
            startsAt: showDates ? dateInputToIso(state.startsAt) : null,
            endsAt: showDates ? dateInputToIso(state.endsAt) : null,
            enrollmentClosesAt: showEnrollment ? dateInputToIso(state.enrollmentClosesAt) : null,
        };
        await onSubmit(payload);
    };

    const isEdit = !!initialItem;

    return (
        <form onSubmit={handleSubmit} className="flex flex-col h-full">
            <div className="flex-1 px-5 py-4 space-y-4">
                {/* Type */}
                <div>
                    <label htmlFor="catalog-type" className="block text-sm font-medium text-foreground mb-1.5">
                        {t('form.type')}
                    </label>
                    <select
                        id="catalog-type"
                        value={state.type}
                        onChange={e => update('type', e.target.value as CatalogItemType)}
                        disabled={isSubmitting || isEdit}
                        className="w-full px-3 py-2 rounded-lg border border-theme-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
                    >
                        {TYPES.map(typ => (
                            <option key={typ} value={typ}>{t(`types.${typ}`)}</option>
                        ))}
                    </select>
                    {isEdit && (
                        <p className="text-xs text-muted-foreground mt-1">{t('form.typeLockedHint')}</p>
                    )}
                </div>

                {/* Name */}
                <div>
                    <label htmlFor="catalog-name" className="block text-sm font-medium text-foreground mb-1.5">
                        {t('form.name')} <span className="text-error">*</span>
                    </label>
                    <input
                        id="catalog-name"
                        ref={nameRef}
                        type="text"
                        dir="auto"
                        value={state.name}
                        onChange={e => update('name', e.target.value)}
                        disabled={isSubmitting}
                        maxLength={200}
                        className="w-full px-3 py-2 rounded-lg border border-theme-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
                        aria-invalid={!!errors.name}
                    />
                    {errors.name && <p className="text-xs text-error mt-1">{errors.name}</p>}
                </div>

                {/* Description */}
                <div>
                    <div className="flex items-center justify-between mb-1.5">
                        <label htmlFor="catalog-description" className="text-sm font-medium text-foreground">
                            {t('form.description')}
                        </label>
                        {/* Char counter — only render once they've started typing
                            to avoid showing 0/4000 on the empty form (visual
                            noise). At 80% of the limit the counter switches to
                            warning color so the merchant sees the ceiling
                            approaching. */}
                        {state.description.length > 0 && (
                            <span
                                className={clsx(
                                    'text-xs tabular-nums',
                                    state.description.length > DESCRIPTION_MAX * 0.8
                                        ? 'text-warning'
                                        : 'text-muted-foreground',
                                )}
                            >
                                {state.description.length} / {DESCRIPTION_MAX}
                            </span>
                        )}
                    </div>
                    <textarea
                        id="catalog-description"
                        dir="auto"
                        value={state.description}
                        onChange={e => update('description', e.target.value)}
                        disabled={isSubmitting}
                        maxLength={DESCRIPTION_MAX}
                        rows={3}
                        className="w-full px-3 py-2 rounded-lg border border-theme-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60 resize-y"
                        aria-invalid={!!errors.description}
                    />
                    {errors.description && <p className="text-xs text-error mt-1">{errors.description}</p>}
                </div>

                {/* Price + currency (type-conditional) */}
                {showPrice && (
                    <div className="flex gap-2">
                        <div className="flex-1">
                            <label htmlFor="catalog-price" className="block text-sm font-medium text-foreground mb-1.5">
                                {t('form.price')}
                            </label>
                            <input
                                id="catalog-price"
                                type="number"
                                min="0"
                                step="0.01"
                                value={state.priceText}
                                onChange={e => update('priceText', e.target.value)}
                                disabled={isSubmitting}
                                placeholder={t('form.pricePlaceholder')}
                                className="w-full px-3 py-2 rounded-lg border border-theme-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
                                aria-invalid={!!errors.priceText}
                            />
                            {errors.priceText && <p className="text-xs text-error mt-1">{errors.priceText}</p>}
                        </div>
                        <div className="w-28">
                            <label htmlFor="catalog-currency" className="block text-sm font-medium text-foreground mb-1.5">
                                {t('form.currency')}
                            </label>
                            <select
                                id="catalog-currency"
                                value={state.currency}
                                onChange={e => update('currency', e.target.value)}
                                disabled={isSubmitting || !state.priceText.trim()}
                                className="w-full px-3 py-2 rounded-lg border border-theme-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
                            >
                                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                            {errors.currency && <p className="text-xs text-error mt-1">{errors.currency}</p>}
                        </div>
                    </div>
                )}

                {/* Dates (type-conditional) */}
                {showDates && (
                    <>
                        <div>
                            <label htmlFor="catalog-starts" className="block text-sm font-medium text-foreground mb-1.5">
                                {t('form.startsAt')}
                            </label>
                            <input
                                id="catalog-starts"
                                type="date"
                                value={state.startsAt}
                                onChange={e => update('startsAt', e.target.value)}
                                disabled={isSubmitting}
                                className="w-full px-3 py-2 rounded-lg border border-theme-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
                                aria-invalid={!!errors.startsAt}
                            />
                        </div>
                        <div>
                            <label htmlFor="catalog-ends" className="block text-sm font-medium text-foreground mb-1.5">
                                {t('form.endsAt')}
                            </label>
                            <input
                                id="catalog-ends"
                                type="date"
                                value={state.endsAt}
                                onChange={e => update('endsAt', e.target.value)}
                                disabled={isSubmitting}
                                className="w-full px-3 py-2 rounded-lg border border-theme-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
                                aria-invalid={!!errors.endsAt}
                            />
                            {errors.endsAt && <p className="text-xs text-error mt-1">{errors.endsAt}</p>}
                        </div>
                    </>
                )}

                {/* Enrollment close (courses only) */}
                {showEnrollment && (
                    <div>
                        <label htmlFor="catalog-enrollment" className="block text-sm font-medium text-foreground mb-1.5">
                            {t('form.enrollmentClosesAt')}
                        </label>
                        <input
                            id="catalog-enrollment"
                            type="date"
                            value={state.enrollmentClosesAt}
                            onChange={e => update('enrollmentClosesAt', e.target.value)}
                            disabled={isSubmitting}
                            className="w-full px-3 py-2 rounded-lg border border-theme-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
                            aria-invalid={!!errors.enrollmentClosesAt}
                        />
                        {errors.enrollmentClosesAt && <p className="text-xs text-error mt-1">{errors.enrollmentClosesAt}</p>}
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-theme-border bg-card flex-shrink-0">
                <Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
                    {tc('cancel')}
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? tc('saving') : isEdit ? t('form.save') : t('form.create')}
                </Button>
            </div>
        </form>
    );
}
