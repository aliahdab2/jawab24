import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { Link2, Link2Off, Pencil, Plus } from 'lucide-react';
import { Button, Input, Modal } from '@/components/ui';
import { adminApi, type AdminCustomer, type AdminPartner } from '@/lib/api';
import { useDebounce } from '@/hooks';
import { captureError } from '@/lib/sentryHelpers';

/**
 * Reseller registry management — the admin surface for the partner rows the
 * portal authenticates against.
 *
 * It exists because the portal binding is an access boundary that can land on
 * the wrong account: `userId: null` (unlink) is the recovery path, and
 * `isActive: false` is the kill switch that cuts a reseller's access to
 * merchant data on their next request. Without both, fixing either situation
 * means a hand-written UPDATE against production.
 *
 * Only the phone auto-binds a reseller's login (unique + OTP-proven).
 * `users.email` is settable to any value by any authenticated user, so it is
 * contact information here, never an anchor — an email-only reseller is linked
 * to their account deliberately, by an admin, from this screen.
 *
 * ⛔ The auto-bind is narrower than "has a phone on file", which is why the
 * LINK action is offered on every unlinked reseller rather than only the
 * phone-less ones. `partners.phone` records the number we hold for a reseller;
 * the anchor requires a USER ACCOUNT carrying that same number, verified. A rep
 * who signs up with Facebook has `users.phone = NULL`, and a rep in a country
 * where SMS never lands (Syria, +963 — blocked at the provider) can never
 * verify one. Both look "phone on file" here and can never bind on their own.
 */

/** Blank draft for the create form and the reset after a successful save. */
const EMPTY_DRAFT = { name: '', email: '', phone: '', commissionPct: '15' };
type Draft = typeof EMPTY_DRAFT;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// E.164, matching `users.phone` — what the portal compares a login against.
const PHONE_RE = /^\+[1-9]\d{6,18}$/;

/** At least one contact, each supplied one well-formed, commission 0-100. */
function draftIsValid(draft: Draft): boolean {
    const email = draft.email.trim();
    const phone = draft.phone.trim();
    const pct = Number(draft.commissionPct);
    return draft.name.trim().length > 0
        && (email.length > 0 || phone.length > 0)
        && (email.length === 0 || EMAIL_RE.test(email))
        && (phone.length === 0 || PHONE_RE.test(phone))
        && Number.isInteger(pct) && pct >= 0 && pct <= 100;
}

function DraftFields({
    draft,
    onChange,
    showAnchorHelper,
}: {
    draft: Draft;
    onChange: (next: Draft) => void;
    showAnchorHelper?: boolean;
}) {
    const t = useTranslations('admin');
    return (
        <div className="space-y-3">
            <Input
                label={t('customers.resellerName')}
                value={draft.name}
                onChange={(e) => onChange({ ...draft, name: e.target.value })}
                dir="auto"
            />
            <Input
                label={t('customers.resellerEmail')}
                type="email"
                value={draft.email}
                onChange={(e) => onChange({ ...draft, email: e.target.value })}
                dir="auto"
            />
            <Input
                label={t('customers.resellerPhone')}
                type="tel"
                value={draft.phone}
                onChange={(e) => onChange({ ...draft, phone: e.target.value })}
                dir="ltr"
                placeholder="+963944123456"
                helperText={showAnchorHelper ? t('customers.resellerAnchorHelper') : undefined}
            />
            <Input
                label={t('customers.resellerCommission')}
                type="number"
                min={0}
                max={100}
                value={draft.commissionPct}
                onChange={(e) => onChange({ ...draft, commissionPct: e.target.value })}
                dir="ltr"
            />
        </div>
    );
}

export function PartnerManagerModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
    const t = useTranslations('admin');
    const tc = useTranslations('common');
    const queryClient = useQueryClient();

    const [creating, setCreating] = useState(false);
    const [createDraft, setCreateDraft] = useState<Draft>(EMPTY_DRAFT);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
    // Two-step unlink: the row asks for confirmation in place rather than
    // stacking a second modal on top of this one.
    const [confirmUnlinkId, setConfirmUnlinkId] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    // Account picker for the manual link, opened per row.
    const [linkingId, setLinkingId] = useState<string | null>(null);
    const [linkSearch, setLinkSearch] = useState('');
    const debouncedLinkSearch = useDebounce(linkSearch, 300);

    const { data: partners = [], isLoading } = useQuery<AdminPartner[]>({
        queryKey: ['admin', 'partners'],
        queryFn: async () => {
            const response = await adminApi.listPartners();
            return response.success ? response.data : [];
        },
        enabled: isOpen,
        staleTime: 10 * 60_000,
    });

    // Candidate accounts for the manual link. Deliberately reuses the customer
    // search the admin table already runs — there is no separate "user lookup"
    // endpoint to add, and the reseller's own account is a customer row like
    // any other. Two characters minimum so opening the picker doesn't fire a
    // full unfiltered page load.
    const linkQuery = debouncedLinkSearch.trim();
    const { data: linkResults = [], isFetching: linkSearching } = useQuery<AdminCustomer[]>({
        queryKey: ['admin', 'partner-link-search', linkQuery],
        queryFn: async () => {
            const response = await adminApi.listUsers({ search: linkQuery, limit: 8 });
            return response.success ? response.data : [];
        },
        enabled: linkingId !== null && linkQuery.length >= 2,
        staleTime: 60_000,
    });

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'partners'] });
        // A reseller's name and assignment both render in the customers table.
        queryClient.invalidateQueries({ queryKey: ['admin', 'customers'] });
    };

    const closeLinkPicker = () => {
        setLinkingId(null);
        setLinkSearch('');
    };

    /**
     * Open the picker pre-filled with the reseller's own contact details, so
     * the ordinary case ("this rep, on the account carrying their address") is
     * one click rather than a typed search.
     */
    const startLinking = (partner: AdminPartner) => {
        setLinkingId(partner.id);
        setLinkSearch(partner.email || partner.phone || partner.name);
        setActionError(null);
    };

    const createPartner = useMutation({
        mutationFn: () => adminApi.createPartner({
            name: createDraft.name.trim(),
            email: createDraft.email.trim() || null,
            phone: createDraft.phone.trim() || null,
            commissionPct: Number(createDraft.commissionPct),
        }),
        onSuccess: () => {
            invalidate();
            setCreating(false);
            setCreateDraft(EMPTY_DRAFT);
            setActionError(null);
        },
        onError: (err) => {
            captureError(err, 'Failed to create partner', { tags: { page: 'admin-customers' } });
            setActionError(t('customers.resellerCreateFailed'));
        },
    });

    const updatePartner = useMutation({
        mutationFn: ({ id, input }: { id: string; input: Parameters<typeof adminApi.updatePartner>[1] }) =>
            adminApi.updatePartner(id, input),
        onSuccess: () => {
            invalidate();
            setEditingId(null);
            setConfirmUnlinkId(null);
            closeLinkPicker();
            setActionError(null);
        },
        // One endpoint serves three actions that fail for three different
        // reasons, and the variables are the only thing that says which ran.
        // Note `userId` is THREE-valued, not two: a string links, `null`
        // unlinks, `undefined` means the call never touched the binding. A
        // `!== undefined` test would answer a failed UNLINK with "that account
        // already belongs to another reseller" — the opposite of what happened.
        onError: (err, variables) => {
            captureError(err, 'Failed to update partner', { tags: { page: 'admin-customers' } });
            const { userId } = variables.input;
            setActionError(t(
                typeof userId === 'string' ? 'customers.resellerLinkFailed'
                    : userId === null ? 'customers.resellerUnlinkFailed'
                        : 'customers.resellerUpdateFailed',
            ));
        },
    });

    const startEditing = (partner: AdminPartner) => {
        setEditingId(partner.id);
        setActionError(null);
        setEditDraft({
            name: partner.name,
            email: partner.email ?? '',
            phone: partner.phone ?? '',
            commissionPct: String(partner.commissionPct),
        });
    };

    const saveEdit = (id: string) => {
        updatePartner.mutate({
            id,
            input: {
                name: editDraft.name.trim(),
                email: editDraft.email.trim() || null,
                phone: editDraft.phone.trim() || null,
                commissionPct: Number(editDraft.commissionPct),
            },
        });
    };

    const busy = createPartner.isPending || updatePartner.isPending;
    const createValid = useMemo(() => draftIsValid(createDraft), [createDraft]);
    const editValid = useMemo(() => draftIsValid(editDraft), [editDraft]);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('customers.resellersManage')} size="lg">
            <div className="space-y-4">
                {actionError && (
                    <p className="text-sm status-error rounded-lg px-3 py-2" role="alert">
                        {actionError}
                    </p>
                )}

                {/* Create */}
                {creating ? (
                    <div className="border border-theme-border rounded-lg p-3 space-y-3">
                        <DraftFields draft={createDraft} onChange={setCreateDraft} showAnchorHelper />
                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => { setCreating(false); setActionError(null); }}>
                                {tc('cancel')}
                            </Button>
                            <Button size="sm" onClick={() => createPartner.mutate()} disabled={!createValid || busy}>
                                {createPartner.isPending ? tc('loading') : tc('save')}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <Button variant="secondary" size="sm" onClick={() => { setCreating(true); setActionError(null); }}>
                        <Plus className="w-4 h-4 me-2" aria-hidden="true" />
                        {t('customers.addReseller')}
                    </Button>
                )}

                {/* Registry */}
                {isLoading ? (
                    <p className="text-sm text-muted-foreground py-4 text-center" aria-busy="true">{tc('loading')}</p>
                ) : partners.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">{t('customers.resellersEmpty')}</p>
                ) : (
                    <ul className="divide-y divide-theme-border">
                        {partners.map((partner) => (
                            <li key={partner.id} className="py-3">
                                {editingId === partner.id ? (
                                    <div className="space-y-3">
                                        <DraftFields draft={editDraft} onChange={setEditDraft} />
                                        <div className="flex justify-end gap-2">
                                            <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                                                {tc('cancel')}
                                            </Button>
                                            <Button size="sm" onClick={() => saveEdit(partner.id)} disabled={!editValid || busy}>
                                                {updatePartner.isPending ? tc('loading') : tc('save')}
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                    <div className="flex items-start justify-between gap-3 flex-wrap">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-medium text-foreground" dir="auto">{partner.name}</span>
                                                <span className={clsx(
                                                    'text-xs px-2 py-0.5 rounded-full',
                                                    partner.linked ? 'status-success' : 'bg-muted text-muted-foreground',
                                                )}>
                                                    {partner.linked ? t('customers.resellerLinked') : t('customers.resellerNotLinked')}
                                                </span>
                                                {!partner.isActive && (
                                                    <span className="text-xs px-2 py-0.5 rounded-full status-error">
                                                        {tc('inactive')}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-xs text-muted-foreground mt-0.5" dir="auto">
                                                {partner.email || '—'}
                                                {partner.phone && (
                                                    <> · <span className="font-mono" dir="ltr">{partner.phone}</span></>
                                                )}
                                                {' · '}
                                                {partner.commissionPct}%
                                                {' · '}
                                                {t('customers.resellerMerchants', { count: partner.merchantCount })}
                                            </div>
                                            {/* Fires on every unlinked reseller, NOT only the
                                                phone-less ones. Gating this on `!partner.phone`
                                                hid the warning from exactly the reps who need it
                                                most: a number we hold but no user account can
                                                verify still reads as "phone on file" here. */}
                                            {!partner.linked && (
                                                <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
                                                    {t('customers.resellerNeedsManualLink')}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <Button variant="ghost" size="sm" onClick={() => startEditing(partner)} disabled={busy}>
                                                <Pencil className="w-3.5 h-3.5 me-1.5" aria-hidden="true" />
                                                {tc('edit')}
                                            </Button>
                                            {!partner.linked && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => startLinking(partner)}
                                                    disabled={busy}
                                                    title={t('customers.resellerLinkHelper')}
                                                >
                                                    <Link2 className="w-3.5 h-3.5 me-1.5" aria-hidden="true" />
                                                    {t('customers.resellerLink')}
                                                </Button>
                                            )}
                                            {partner.linked && (
                                                confirmUnlinkId === partner.id ? (
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs text-muted-foreground">
                                                            {t('customers.resellerUnlinkConfirm')}
                                                        </span>
                                                        <Button
                                                            variant="danger"
                                                            size="sm"
                                                            onClick={() => updatePartner.mutate({ id: partner.id, input: { userId: null } })}
                                                            disabled={busy}
                                                        >
                                                            {tc('confirm')}
                                                        </Button>
                                                        <Button variant="ghost" size="sm" onClick={() => setConfirmUnlinkId(null)}>
                                                            {tc('cancel')}
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => { setConfirmUnlinkId(partner.id); setActionError(null); }}
                                                        disabled={busy}
                                                        title={t('customers.resellerUnlinkHelper')}
                                                    >
                                                        <Link2Off className="w-3.5 h-3.5 me-1.5" aria-hidden="true" />
                                                        {t('customers.resellerUnlink')}
                                                    </Button>
                                                )
                                            )}
                                            <Button
                                                variant={partner.isActive ? 'ghost' : 'secondary'}
                                                size="sm"
                                                onClick={() => updatePartner.mutate({ id: partner.id, input: { isActive: !partner.isActive } })}
                                                disabled={busy}
                                                title={t('customers.resellerActiveHelper')}
                                            >
                                                {partner.isActive ? t('customers.resellerDeactivate') : t('customers.resellerActivate')}
                                            </Button>
                                        </div>
                                    </div>

                                    {linkingId === partner.id && (
                                        <div className="mt-3 border border-theme-border rounded-lg p-3 space-y-3">
                                            <Input
                                                label={t('customers.resellerLinkSearch')}
                                                value={linkSearch}
                                                onChange={(e) => setLinkSearch(e.target.value)}
                                                dir="auto"
                                                helperText={t('customers.resellerLinkSearchHelper')}
                                            />
                                            {linkQuery.length < 2 ? (
                                                <p className="text-xs text-muted-foreground">
                                                    {t('customers.resellerLinkMinChars')}
                                                </p>
                                            ) : linkSearching ? (
                                                <p className="text-xs text-muted-foreground" aria-busy="true">{tc('loading')}</p>
                                            ) : linkResults.length === 0 ? (
                                                <p className="text-xs text-muted-foreground">
                                                    {t('customers.resellerLinkNoMatches')}
                                                </p>
                                            ) : (
                                                <ul className="divide-y divide-theme-border" aria-live="polite">
                                                    {linkResults.map((candidate) => (
                                                        <li key={candidate.id}>
                                                            <button
                                                                type="button"
                                                                className="w-full text-start py-2 px-1 rounded hover:bg-muted disabled:opacity-50"
                                                                onClick={() => updatePartner.mutate({
                                                                    id: partner.id,
                                                                    input: { userId: candidate.id },
                                                                })}
                                                                disabled={busy}
                                                            >
                                                                <span className="text-sm text-foreground block" dir="auto">
                                                                    {candidate.name || t('customers.resellerLinkUnnamed')}
                                                                </span>
                                                                <span className="text-xs text-muted-foreground block" dir="auto">
                                                                    {candidate.email || '—'}
                                                                    {candidate.phone && (
                                                                        <> · <span className="font-mono" dir="ltr">{candidate.phone}</span></>
                                                                    )}
                                                                </span>
                                                            </button>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                            <div className="flex justify-end">
                                                <Button variant="ghost" size="sm" onClick={closeLinkPicker} disabled={busy}>
                                                    {tc('cancel')}
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                    </>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </Modal>
    );
}
