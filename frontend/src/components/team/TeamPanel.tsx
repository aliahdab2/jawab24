import { useState, useEffect, useCallback, useRef } from 'react';
import clsx from 'clsx';
import { Card, Button, Input, ConfirmationModal } from '@/components/ui';
import { Users, Mail, Phone, Crown, Shield, User, X, ChevronDown, Copy, Check, Link, UserPlus, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { workspaceApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { captureError } from '@/lib/sentryHelpers';
import { toast } from 'sonner';
import { isValidContact } from '@jawab24/shared';
import { BRAND_ASSETS } from '@/constants/brand';
import type { WorkspaceRole } from '@jawab24/shared';

interface MemberRow {
  id: string;
  userId: string;
  role: WorkspaceRole;
  joinedAt: string | null;
  userName: string | null;
  userEmail: string | null;
  userPicture: string | null;
  lastSeenAt: string | null;
}

function MemberAvatar({ picture, name }: { picture: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const initial = name.charAt(0).toUpperCase();

  if (picture && !failed) {
    return (
      <img
        src={picture}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="w-9 h-9 rounded-full object-cover flex-shrink-0"
      />
    );
  }
  return (
    <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900/30 text-brand-600 flex items-center justify-center font-bold text-sm flex-shrink-0" aria-hidden="true">
      {initial}
    </div>
  );
}

function PresenceBadge({ lastSeenAt, t }: { lastSeenAt: string | null; t: ReturnType<typeof useTranslations<'team'>> }) {
  if (!lastSeenAt) return null;
  const diffMs = Date.now() - new Date(lastSeenAt).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 5) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 flex-shrink-0" aria-hidden="true" />
        {t('online')}
      </span>
    );
  }
  if (diffMin < 60) {
    return <span className="text-xs text-muted-foreground">{t('lastSeenMinutes', { minutes: diffMin })}</span>;
  }
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return <span className="text-xs text-muted-foreground">{t('lastSeenHours', { hours: diffHours })}</span>;
  }
  return null;
}

interface InviteRow {
  id: string;
  email: string | null;
  phone: string | null;
  role: WorkspaceRole;
  status: string;
  expiresAt: string;
  createdAt: string | null;
}

const MAX_MEMBERS = 5;

const ROLE_ICONS: Record<WorkspaceRole, typeof Crown> = {
  owner: Crown,
  admin: Shield,
  member: User,
};

function getRoleColor(role: WorkspaceRole) {
  switch (role) {
    case 'owner': return 'status-warning';
    case 'admin': return 'status-brand';
    case 'member': return 'bg-surface-100 text-muted-foreground dark:bg-surface-800';
  }
}

function hoursUntil(dateStr: string): number {
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60)));
}

/**
 * Team management view — member list, role management, and invites.
 *
 * Rendered as the body of the dedicated `/team` page. The page supplies the
 * title/description via PageHeader; this panel owns all data fetching and
 * mutations. Mutations persist on each click (no page-level Save).
 *
 * Read-only for Members: the invite form, resend/revoke, role dropdown and
 * remove controls are all gated by `isAdmin` (owner||admin) derived from the
 * fetched member list — so a Member who reaches `/team` by URL sees a safe,
 * informational view even though the nav tile is hidden for them.
 */
export function TeamPanel() {
  const t = useTranslations('team');
  const tc = useTranslations('common');
  const user = useAuthStore((s) => s.user);

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [contact, setContact] = useState('');
  const [sending, setSending] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<MemberRow | null>(null);
  const [roleDropdown, setRoleDropdown] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<{ url: string; contact: string } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  // Transient "saved" status: flashes for ~2s after any successful mutation,
  // then fades back to the idle autosave hint. (Team changes persist per click.)
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const myMember = members.find((m) => m.userId === user?.id);
  const myRole = myMember?.role ?? 'member';
  const isOwner = myRole === 'owner';
  const isAdmin = myRole === 'owner' || myRole === 'admin';
  const totalCount = members.length + invites.length;
  const remaining = MAX_MEMBERS - totalCount;

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const membersRes = await workspaceApi.getMembers();
      const fetchedMembers: MemberRow[] = membersRes.data ?? [];
      setMembers(fetchedMembers);

      // Only fetch invites for admin+ — members don't have access to GET /workspaces/current/invites
      const myM = fetchedMembers.find((m) => m.userId === user?.id);
      const role = myM?.role ?? 'member';
      if (role === 'owner' || role === 'admin') {
        const invitesRes = await workspaceApi.listInvites();
        setInvites(invitesRes.data ?? []);
      }
    } catch (error) {
      captureError(error, 'Failed to fetch team data', { tags: { page: 'team' } });
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Flash the "saved" confirmation, resetting any in-flight timer so rapid
  // successive saves keep the confirmation visible for a full window each time.
  const flashSaved = useCallback(() => {
    setJustSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setJustSaved(false), 2000);
  }, []);

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  const showInviteLink = (token: string, contactValue: string) => {
    const url = `${BRAND_ASSETS.urls.base}/invites/accept?token=${token}`;
    setInviteLink({ url, contact: contactValue });
    setLinkCopied(false);
  };

  const processInviteResponse = (
    res: { data?: { token?: string; smsSent?: boolean; emailSent?: boolean } },
    contactValue: string,
    isResend: boolean,
  ) => {
    const token = res.data?.token;
    const smsSent = res.data?.smsSent;
    const emailSent = res.data?.emailSent;
    const delivered = smsSent || emailSent;
    // The invite is delivered automatically by email (or SMS). The copy-link
    // is the manual fallback — show it only when no channel actually
    // delivered (e.g. email provider down), and clear any stale link when a
    // resend does go out via a channel.
    if (token && !delivered) {
      showInviteLink(token, contactValue);
    } else if (delivered) {
      setInviteLink(null);
    }
    const key = isResend
      ? (smsSent ? 'inviteResentSms' : emailSent ? 'inviteResentEmail' : 'inviteResent')
      : (smsSent ? 'inviteSentSms' : emailSent ? 'inviteSentEmail' : 'inviteSent');
    toast.success(t(key as Parameters<typeof t>[0], { contact: contactValue }));
    flashSaved();
  };

  const handleInvite = async () => {
    const trimmed = contact.trim().toLowerCase();
    if (!trimmed || !isValidContact(trimmed)) {
      toast.error(t('invalidContact'));
      return;
    }
    if (members.some((m) => m.userEmail?.toLowerCase() === trimmed)) {
      toast.error(t('alreadyMember'));
      return;
    }
    if (invites.some((i) => (i.email ?? i.phone ?? '').toLowerCase() === trimmed)) {
      toast.error(t('invitePending'));
      return;
    }
    setSending(true);
    try {
      const res = await workspaceApi.createInvite(trimmed);
      setContact('');
      processInviteResponse(res, trimmed, false);
      await fetchData();
    } catch (error) {
      captureError(error, 'Failed to send invite', { tags: { page: 'team', action: 'invite' } });
      toast.error(t('inviteError'));
    } finally {
      setSending(false);
    }
  };

  const handleResend = async (invite: InviteRow) => {
    const contactValue = (invite.phone ?? invite.email ?? '').toLowerCase();
    setResendingId(invite.id);
    try {
      const res = await workspaceApi.createInvite(contactValue);
      processInviteResponse(res, contactValue, true);
      await fetchData();
    } catch (error) {
      captureError(error, 'Failed to resend invite', { tags: { page: 'team', action: 'resendInvite' } });
      toast.error(t('inviteError'));
    } finally {
      setResendingId(null);
    }
  };

  const handleRevoke = async (inviteId: string) => {
    try {
      await workspaceApi.revokeInvite(inviteId);
      setInviteLink(null);
      toast.success(t('inviteRevoked'));
      flashSaved();
      await fetchData();
    } catch (error) {
      captureError(error, 'Failed to revoke invite', { tags: { page: 'team', action: 'revokeInvite' } });
    }
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    try {
      await workspaceApi.removeMember(removeTarget.userId);
      toast.success(t('memberRemoved', { name: removeTarget.userName || removeTarget.userEmail || '' }));
      setRemoveTarget(null);
      flashSaved();
      await fetchData();
    } catch (error) {
      captureError(error, 'Failed to remove member', { tags: { page: 'team', action: 'removeMember' } });
      toast.error(t('removeError'));
    }
  };

  const handleRoleChange = async (userId: string, newRole: WorkspaceRole) => {
    setRoleDropdown(null);
    try {
      await workspaceApi.updateMemberRole(userId, newRole);
      toast.success(t('roleUpdated'));
      flashSaved();
      await fetchData();
    } catch (error) {
      captureError(error, 'Failed to update role', { tags: { page: 'team', action: 'updateRole' } });
    }
  };

  if (loading) {
    return (
      <Card className="border-none p-6 animate-pulse">
        <div className="h-12 bg-muted rounded-xl" />
      </Card>
    );
  }

  const isAlone = members.length <= 1 && invites.length === 0;

  return (
    <>
      <Card className="border-none p-4 landscape:p-3 animate-slide-up">
        {/* The {totalCount} / {MAX_MEMBERS} quota readout shows how close the
            workspace is to the cap while managing the team. */}
        <div className="mb-2 flex items-center justify-end gap-3">
          <span className="text-xs text-muted-foreground font-normal whitespace-nowrap">
            {totalCount} / {MAX_MEMBERS}
          </span>
        </div>
        {/* Autosave status — flashes a transient "saved" confirmation after a
            mutation, then fades back to the idle hint. aria-live announces it. */}
        <p
          aria-live="polite"
          className={clsx(
            'text-xs mb-4 transition-colors duration-500',
            justSaved
              ? 'text-emerald-600 dark:text-emerald-400 font-medium not-italic'
              : 'text-muted-foreground italic',
          )}
        >
          {justSaved ? t('savedConfirmation') : t('savedAutomatically')}
        </p>

        {/* Invite form — admins and owners only */}
        {isAdmin && remaining > 0 && (
          <div className="flex gap-2 mb-4">
            <Input
              type="text"
              dir="auto"
              placeholder={t('invitePlaceholder')}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleInvite(); }}
              className="flex-1"
              aria-label={t('invitePlaceholder')}
            />
            <Button
              onClick={handleInvite}
              disabled={sending || !contact.trim()}
              size="sm"
              className="px-4 whitespace-nowrap"
            >
              <UserPlus className="w-4 h-4 me-1.5" aria-hidden="true" />
              {t('sendInvite')}
            </Button>
          </div>
        )}

        {/* Invite link — manual fallback, shown when no channel delivered */}
        {inviteLink && (
          <div className="mb-4 p-3 rounded-xl bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800">
            <div className="flex items-center gap-2 mb-2">
              <Link className="w-4 h-4 text-brand-600 dark:text-brand-400 flex-shrink-0" aria-hidden="true" />
              <p className="text-sm font-bold text-brand-700 dark:text-brand-300 min-w-0 truncate">
                {t('shareLinkDesc', { contact: inviteLink.contact })}
              </p>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                dir="ltr"
                value={inviteLink.url}
                className="flex-1 min-w-0 text-xs bg-background border border-brand-200 dark:border-brand-700 rounded-lg px-3 py-2 text-foreground font-mono truncate"
                onClick={(e) => (e.target as HTMLInputElement).select()}
                aria-label={t('copyLink')}
              />
              <Button
                size="sm"
                variant={linkCopied ? 'secondary' : 'primary'}
                className="flex-shrink-0 px-3 sm:px-4"
                onClick={async () => {
                  await navigator.clipboard.writeText(inviteLink.url);
                  setLinkCopied(true);
                  toast.success(t('linkCopied'));
                  setTimeout(() => setLinkCopied(false), 3000);
                }}
              >
                {linkCopied ? (
                  <>
                    <Check className="w-4 h-4 sm:me-1.5" aria-hidden="true" />
                    <span className="hidden sm:inline">{t('linkCopied')}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 sm:me-1.5" aria-hidden="true" />
                    <span className="hidden sm:inline">{t('copyLink')}</span>
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-brand-600 dark:text-brand-400 mt-2">{t('linkExpires')}</p>
          </div>
        )}

        {/* Limit hint */}
        {isAdmin && remaining > 0 && remaining <= 2 && (
          <p className="text-xs text-muted-foreground mb-3">{t('limitHint', { remaining })}</p>
        )}
        {isAdmin && remaining <= 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">{t('limitReached')}</p>
        )}

        {/* Empty state — shown to non-admins who are alone */}
        {isAlone && !isAdmin && (
          <div className="text-center py-8">
            <Users className="w-10 h-10 mx-auto text-icon-muted mb-3" aria-hidden="true" />
            <p className="font-bold text-foreground">{t('emptyTitle')}</p>
            <p className="text-sm text-muted-foreground mt-1">{t('emptyDesc')}</p>
          </div>
        )}

        {/* Member + invite list */}
        <div className="divide-y divide-theme-border">
          {members.map((member) => {
            const isMe = member.userId === user?.id;
            const isMemberOwner = member.role === 'owner';
            const canChangeRole = isOwner && !isMe;
            const canRemove = isOwner ? (!isMe && !isMemberOwner) : (isAdmin && !isMe && member.role === 'member');
            const RoleIcon = ROLE_ICONS[member.role];

            return (
              <div key={member.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                {/* Avatar */}
                <MemberAvatar picture={member.userPicture} name={member.userName || member.userEmail || '?'} />

                {/* Name + email */}
                <div className="flex-1 min-w-0 text-start">
                  <p className="font-bold text-sm text-foreground truncate">
                    {member.userName || member.userEmail}
                    {isMe && <span className="text-muted-foreground font-normal ms-1.5">({t('you')})</span>}
                  </p>
                  {member.userName && member.userEmail && (
                    <p className="text-xs text-muted-foreground truncate">{member.userEmail}</p>
                  )}
                  <PresenceBadge lastSeenAt={member.lastSeenAt} t={t} />
                </div>

                {/* Role badge / dropdown */}
                <div className="relative flex-shrink-0">
                  {canChangeRole ? (
                    <button
                      onClick={() => setRoleDropdown(roleDropdown === member.id ? null : member.id)}
                      className={clsx('inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold transition-colors', getRoleColor(member.role))}
                      aria-label={t('changeRole')}
                    >
                      <RoleIcon className="w-3 h-3" aria-hidden="true" />
                      {t(`role${member.role.charAt(0).toUpperCase() + member.role.slice(1)}` as 'roleOwner' | 'roleAdmin' | 'roleMember')}
                      <ChevronDown className="w-3 h-3" aria-hidden="true" />
                    </button>
                  ) : (
                    <span className={clsx('inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold', getRoleColor(member.role))}>
                      <RoleIcon className="w-3 h-3" aria-hidden="true" />
                      {t(`role${member.role.charAt(0).toUpperCase() + member.role.slice(1)}` as 'roleOwner' | 'roleAdmin' | 'roleMember')}
                    </span>
                  )}

                  {roleDropdown === member.id && (
                    <div className="absolute end-0 top-full mt-1 bg-card border border-theme-border rounded-xl shadow-xl z-20 py-1 min-w-[120px]">
                      {(['admin', 'member'] as WorkspaceRole[]).map((r) => (
                        <button
                          key={r}
                          onClick={() => handleRoleChange(member.userId, r)}
                          className={clsx(
                            'w-full text-start px-3 py-2 text-sm hover:bg-muted transition-colors',
                            member.role === r && 'font-bold text-brand-600'
                          )}
                        >
                          {t(`role${r.charAt(0).toUpperCase() + r.slice(1)}` as 'roleAdmin' | 'roleMember')}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Remove button */}
                {canRemove && (
                  <button
                    onClick={() => setRemoveTarget(member)}
                    className="text-xs text-muted-foreground hover:text-red-500 dark:hover:text-red-400 transition-colors flex-shrink-0"
                  >
                    {t('removeMember')}
                  </button>
                )}
              </div>
            );
          })}

          {/* Pending invites */}
          {invites.map((invite) => {
            const hours = hoursUntil(invite.expiresAt);
            const isExpired = hours <= 0;
            const displayContact = invite.phone ?? invite.email ?? '';
            const isPhone = !!invite.phone;
            const ContactIcon = isPhone ? Phone : Mail;

            return (
              <div key={invite.id} className="flex items-start gap-3 py-3 opacity-70">
                {/* Icon avatar */}
                <div className="w-9 h-9 rounded-full bg-surface-100 dark:bg-surface-800 text-icon-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                  <ContactIcon className="w-4 h-4" aria-hidden="true" />
                </div>

                {/* Contact + expiry + resend — 2-line layout */}
                <div className="flex-1 min-w-0 text-start">
                  <p className="font-bold text-sm text-foreground truncate" dir={isPhone ? 'ltr' : undefined}>{displayContact}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <p className="text-xs text-muted-foreground">
                      {isExpired ? t('expired') : t('expiresIn', { hours })}
                    </p>
                    {isAdmin && (
                      <button
                        onClick={() => handleResend(invite)}
                        disabled={resendingId === invite.id}
                        className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors disabled:opacity-50"
                        aria-label={t('resendInvite')}
                      >
                        {resendingId === invite.id
                          ? <RefreshCw className="w-3 h-3 animate-spin" aria-hidden="true" />
                          : t('resendInvite')
                        }
                      </button>
                    )}
                  </div>
                </div>

                {/* Pending badge + revoke */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60">
                    {t('pending')}
                  </span>
                  {isAdmin && (
                    <button
                      onClick={() => handleRevoke(invite.id)}
                      className="p-1 text-muted-foreground hover:text-red-500 dark:hover:text-red-400 transition-colors"
                      aria-label={t('revokeInvite')}
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Role explainer — what each kind of member can do. Reuses the same
            icons + colors as the member badges above so the legend reads as
            a key to them. Helps owners pick the right role when inviting. */}
        <div className="mt-5 pt-4 border-t border-theme-border">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">
            {t('rolesExplainerTitle')}
          </p>
          <ul className="space-y-3">
            {(['owner', 'admin', 'member'] as WorkspaceRole[]).map((r) => {
              const RoleIcon = ROLE_ICONS[r];
              const cap = r.charAt(0).toUpperCase() + r.slice(1);
              return (
                <li key={r} className="flex items-start gap-3">
                  <span className={clsx('inline-flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0', getRoleColor(r))}>
                    <RoleIcon className="w-3.5 h-3.5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 text-start">
                    <p className="text-sm font-bold text-foreground">
                      {t(`role${cap}` as 'roleOwner' | 'roleAdmin' | 'roleMember')}
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {t(`roleDesc${cap}` as 'roleDescOwner' | 'roleDescAdmin' | 'roleDescMember')}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </Card>

      {/* Remove confirmation */}
      {removeTarget && (
        <ConfirmationModal
          isOpen
          onClose={() => setRemoveTarget(null)}
          onConfirm={handleRemove}
          title={t('removeMember')}
          message={t('removeConfirm', { name: removeTarget.userName || removeTarget.userEmail || '' })}
          confirmText={t('removeMember')}
          cancelText={tc('cancel')}
          variant="danger"
        />
      )}
    </>
  );
}
