import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button, InputFieldWrapper, CharCounter } from '@/components/ui';
import { useAutoFocus } from '@/hooks/useAutoFocus';
import { priceMinorToText, parseMoneyToPriceMinor } from '@/utils/money';
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

    // Auto-focus the Name field on create. Skipped on edit so the existing
    // value isn't selected and accidentally overtyped.
    const nameRef = useAutoFocus<HTMLInputElement>(!!initialItem);

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
            const minor = parseMoneyToPriceMinor(state.priceText);
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

        const priceMinor = showPrice && state.priceText.trim() ? parseMoneyToPriceMinor(state.priceText) : null;
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

                {/* Description — uses the shared InputFieldWrapper + CharCounter
                    primitives (same pattern as every settings card), so users
                    get the consistent focus-ring chrome and tri-tier counter
                    coloring (muted → amber at 80% → red at cap). */}
                <div>
                    <label htmlFor="catalog-description" className="block text-sm font-medium text-foreground mb-1.5">
                        {t('form.description')}
                    </label>
                    <InputFieldWrapper
                        disabled={isSubmitting}
                        trailing={<CharCounter value={state.description} max={DESCRIPTION_MAX} hideWhenZero />}
                    >
                        <textarea
                            id="catalog-description"
                            dir="auto"
                            value={state.description}
                            onChange={e => update('description', e.target.value)}
                            disabled={isSubmitting}
                            maxLength={DESCRIPTION_MAX}
                            rows={3}
                            className="w-full p-3 pe-14 bg-transparent border-none text-foreground text-sm focus:outline-none focus:ring-0 resize-y"
                            aria-invalid={!!errors.description}
                        />
                    </InputFieldWrapper>
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
                                // type=text + inputMode=decimal is the best-practice money
                                // input (per GDS / Shopify / Stripe). type=number has well-
                                // documented footguns: it formats with locale comma in many
                                // languages ("0,07") which confused merchants here, the
                                // spinner buttons make accidental cents-bumps trivial, and
                                // step validation interferes with controlled state during
                                // typing. With type=text we control display exactly and
                                // accept both "." and "," via parseMoneyToPriceMinor.
                                type="text"
                                inputMode="decimal"
                                value={state.priceText}
                                onChange={(e) => {
                                    const raw = e.target.value;
                                    // Restrict typing to a sensible money pattern so the
                                    // field never lands in an obviously-broken state.
                                    if (raw === '' || /^[0-9]*[.,]?[0-9]{0,2}$/.test(raw)) {
                                        update('priceText', raw);
                                    }
                                }}
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
