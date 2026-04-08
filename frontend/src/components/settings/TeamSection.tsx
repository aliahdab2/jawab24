import { useState, useEffect, useCallback } from 'react';
import clsx from 'clsx';
import { Card, Button, Input, ConfirmationModal } from '@/components/ui';
import { Users, Mail, Phone, Crown, Shield, User, X, ChevronDown, Copy, Check, Link, UserPlus, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { workspaceApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { captureError } from '@/lib/sentryHelpers';
import { toast } from 'sonner';
import { isValidContact } from '@jawab24/shared';
import type { WorkspaceRole } from '@jawab24/shared';

interface MemberRow {
  id: string;
  userId: string;
  role: WorkspaceRole;
  joinedAt: string | null;
  userName: string | null;
  userEmail: string | null;
  userPicture: string | null;
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
    case 'member': return 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400';
  }
}

function hoursUntil(dateStr: string): number {
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60)));
}

export function TeamSection() {
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

  const myMember = members.find((m) => m.userId === user?.id);
  const myRole = myMember?.role ?? 'member';
  const isOwner = myRole === 'owner';
  const isAdmin = myRole === 'owner' || myRole === 'admin';
  const totalCount = members.length + invites.length;
  const remaining = MAX_MEMBERS - totalCount;

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [membersRes, invitesRes] = await Promise.all([
        workspaceApi.getMembers(),
        workspaceApi.listInvites().catch(() => ({ data: [] })),
      ]);
      setMembers(membersRes.data ?? []);
      setInvites(invitesRes.data ?? []);
    } catch (error) {
      captureError(error, 'Failed to fetch team data', { tags: { page: 'settings', section: 'team' } });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const showInviteLink = (token: string, contactValue: string) => {
    const url = `${window.location.origin}/invites/accept?token=${token}`;
    setInviteLink({ url, contact: contactValue });
    setLinkCopied(false);
  };

  const processInviteResponse = (res: { data?: { token?: string; smsSent?: boolean } }, contactValue: string, isResend: boolean) => {
    const token = res.data?.token;
    const smsSent = res.data?.smsSent;
    if (token && !smsSent) showInviteLink(token, contactValue);
    const key = isResend
      ? (smsSent ? 'inviteResentSms' : 'inviteResent')
      : (smsSent ? 'inviteSentSms' : 'inviteSent');
    toast.success(t(key as Parameters<typeof t>[0], { contact: contactValue }));
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
    setSending(true);
    try {
      const res = await workspaceApi.createInvite(trimmed);
      setContact('');
      processInviteResponse(res, trimmed, false);
      await fetchData();
    } catch (error) {
      captureError(error, 'Failed to send invite', { tags: { page: 'settings', action: 'invite' } });
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
      captureError(error, 'Failed to resend invite', { tags: { page: 'settings', action: 'resendInvite' } });
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
      await fetchData();
    } catch (error) {
      captureError(error, 'Failed to revoke invite', { tags: { page: 'settings', action: 'revokeInvite' } });
    }
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    try {
      await workspaceApi.removeMember(removeTarget.userId);
      toast.success(t('memberRemoved', { name: removeTarget.userName || removeTarget.userEmail || '' }));
      setRemoveTarget(null);
      await fetchData();
    } catch (error) {
      captureError(error, 'Failed to remove member', { tags: { page: 'settings', action: 'removeMember' } });
      toast.error(t('removeError'));
    }
  };

  const handleRoleChange = async (userId: string, newRole: WorkspaceRole) => {
    setRoleDropdown(null);
    try {
      await workspaceApi.updateMemberRole(userId, newRole);
      toast.success(t('roleUpdated'));
      await fetchData();
    } catch (error) {
      captureError(error, 'Failed to update role', { tags: { page: 'settings', action: 'updateRole' } });
    }
  };

  if (loading) {
    return (
      <div>
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">{t('sectionTitle')}</p>
        <Card className="border-none p-6 animate-pulse">
          <div className="h-12 bg-muted rounded-xl" />
          <div className="h-16 bg-muted rounded-xl mt-4" />
        </Card>
      </div>
    );
  }

  const isAlone = members.length <= 1 && invites.length === 0;

  return (
    <div>
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">{t('sectionTitle')}</p>

      <Card className="border-none p-4 landscape:p-3">
        {/* Header */}
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center icon-bg-brand landscape:w-10 landscape:h-10 flex-shrink-0">
            <Users className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="text-start flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-lg landscape:text-base text-foreground">{t('sectionTitle')}</h3>
              <span className="text-xs text-muted-foreground font-normal">
                {totalCount} / {MAX_MEMBERS}
              </span>
            </div>
            <p className="text-sm text-muted-foreground landscape:text-xs">{t('sectionDesc')}</p>
          </div>
        </div>

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

        {/* Invite link — shown after sending / resending */}
        {inviteLink && (
          <div className="mb-4 p-3 rounded-xl bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800">
            <div className="flex items-center gap-2 mb-2">
              <Link className="w-4 h-4 text-brand-600 dark:text-brand-400 flex-shrink-0" aria-hidden="true" />
              <p className="text-sm font-bold text-brand-700 dark:text-brand-300">
                {t('shareLinkDesc', { contact: inviteLink.contact })}
              </p>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                dir="ltr"
                value={inviteLink.url}
                className="flex-1 text-xs bg-white dark:bg-surface-900 border border-brand-200 dark:border-brand-700 rounded-lg px-3 py-2 text-foreground font-mono truncate"
                onClick={(e) => (e.target as HTMLInputElement).select()}
                aria-label={t('copyLink')}
              />
              <Button
                size="sm"
                variant={linkCopied ? 'secondary' : 'primary'}
                className="px-3 flex-shrink-0"
                onClick={async () => {
                  await navigator.clipboard.writeText(inviteLink.url);
                  setLinkCopied(true);
                  toast.success(t('linkCopied'));
                  setTimeout(() => setLinkCopied(false), 3000);
                }}
              >
                {linkCopied
                  ? <><Check className="w-4 h-4 me-1" aria-hidden="true" />{t('linkCopied')}</>
                  : <><Copy className="w-4 h-4 me-1" aria-hidden="true" />{t('copyLink')}</>
                }
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
            const canRemove = isAdmin && !isMe && !isMemberOwner;
            const RoleIcon = ROLE_ICONS[member.role];
            const initial = member.userName?.charAt(0) || member.userEmail?.charAt(0) || '?';

            return (
              <div key={member.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                {/* Avatar */}
                {member.userPicture ? (
                  <img
                    src={member.userPicture}
                    alt={member.userName || ''}
                    className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900/30 text-brand-600 flex items-center justify-center font-bold text-sm flex-shrink-0">
                    {initial}
                  </div>
                )}

                {/* Name + email */}
                <div className="flex-1 min-w-0 text-start">
                  <p className="font-bold text-sm text-foreground truncate">
                    {member.userName || member.userEmail}
                    {isMe && <span className="text-muted-foreground font-normal ms-1.5">({t('you')})</span>}
                  </p>
                  {member.userName && member.userEmail && (
                    <p className="text-xs text-muted-foreground truncate">{member.userEmail}</p>
                  )}
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
              <div key={invite.id} className="flex items-center gap-3 py-3 opacity-70">
                {/* Icon avatar */}
                <div className="w-9 h-9 rounded-full bg-surface-100 dark:bg-surface-800 text-icon-muted flex items-center justify-center flex-shrink-0">
                  <ContactIcon className="w-4 h-4" aria-hidden="true" />
                </div>

                {/* Contact + expiry */}
                <div className="flex-1 min-w-0 text-start">
                  <p className="font-bold text-sm text-foreground truncate">{displayContact}</p>
                  <p className="text-xs text-muted-foreground">
                    {isExpired ? t('expired') : t('expiresIn', { hours })}
                  </p>
                </div>

                {/* Pending badge */}
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400 flex-shrink-0">
                  {t('pending')}
                </span>

                {/* Resend */}
                {isAdmin && (
                  <button
                    onClick={() => handleResend(invite)}
                    disabled={resendingId === invite.id}
                    className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors flex-shrink-0 disabled:opacity-50"
                    aria-label={t('resendInvite')}
                  >
                    {resendingId === invite.id
                      ? <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      : t('resendInvite')
                    }
                  </button>
                )}

                {/* Revoke */}
                {isAdmin && (
                  <button
                    onClick={() => handleRevoke(invite.id)}
                    className="text-muted-foreground hover:text-red-500 dark:hover:text-red-400 transition-colors flex-shrink-0"
                    aria-label={t('revokeInvite')}
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
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
    </div>
  );
}
