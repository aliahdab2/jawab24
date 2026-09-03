import { FastifyReply } from 'fastify';
import { workspaceService, WorkspaceAccessDeniedError } from '../services/workspace';
import { workspaceInviteService, InvalidInviteContactError } from '../services/workspaceInvite';
import { workspaceSettingsService } from '../services/workspaceSettings';
import type { WorkspaceRequest, ResolvedWorkspaceRequest } from '../middleware/workspace';
import { ROLE_HIERARCHY } from '../utils/roles';
import type { AuthenticatedRequest } from '../middleware/auth';
import type { WorkspaceRole } from '@jawab24/shared';
import { isWorkspaceSettingsKey, UpdateSettingsSchema } from '@jawab24/shared';
import { validateSchema } from '../utils/validation';
import { captureError } from '../utils/sentryHelpers';
// Lead-config sanitizers are shared with the per-page override path
// (PATCH /pages/:id/lead-config) so validation stays identical on both.
import { sanitizeLeadStages, sanitizeLeadFields } from './leadConfigSanitizers';

// --- Workspace CRUD ---

async function list(request: AuthenticatedRequest, reply: FastifyReply) {
    try {
        if (!request.user) {
            return reply.status(401).send({ error: true, message: 'Unauthorized' });
        }
        const workspaces = await workspaceService.getUserWorkspaces(request.user.userId);
        // A PINNED session sees only the workspace it is pinned to. resolveWorkspace
        // already refuses to ACT on the others, but listing them here still names the
        // owner's other stores and pages to a credential that only ever proved one
        // store — and the client renders them as a workspace switcher whose every
        // entry 403s. D-066 says the rest are unreachable; enumerable is not that.
        const scopedWorkspaceId = request.user.scopedWorkspaceId;
        return reply.send(
            scopedWorkspaceId ? workspaces.filter((w) => w.id === scopedWorkspaceId) : workspaces,
        );
    } catch (error) {
        captureError(error, 'Failed to list workspaces', { tags: { context: 'workspace' } });
        return reply.status(500).send({ error: true, message: 'Failed to list workspaces' });
    }
}

async function create(request: AuthenticatedRequest, reply: FastifyReply) {
    try {
        if (!request.user) {
            return reply.status(401).send({ error: true, message: 'Unauthorized' });
        }
        const { name } = request.body as { name: string };

        if (!name?.trim()) {
            return reply.status(400).send({ error: true, message: 'Workspace name is required' });
        }

        const workspace = await workspaceService.createWorkspace(request.user.userId, name.trim());
        return reply.status(201).send(workspace);
    } catch (error) {
        captureError(error, 'Failed to create workspace', { tags: { context: 'workspace' } });
        return reply.status(500).send({ error: true, message: 'Failed to create workspace' });
    }
}

async function getOne(request: WorkspaceRequest, reply: FastifyReply) {
    try {
        const workspace = await workspaceService.getWorkspace((request as ResolvedWorkspaceRequest).workspaceId);
        if (!workspace) {
            return reply.status(404).send({ error: true, message: 'Workspace not found' });
        }
        return reply.send(workspace);
    } catch (error) {
        captureError(error, 'Failed to get workspace', { tags: { context: 'workspace' } });
        return reply.status(500).send({ error: true, message: 'Failed to get workspace' });
    }
}

async function update(request: WorkspaceRequest, reply: FastifyReply) {
    try {
        const { name, logoUrl } = request.body as { name?: string; logoUrl?: string };
        const updated = await workspaceService.updateWorkspace((request as ResolvedWorkspaceRequest).workspaceId, { name, logoUrl });
        return reply.send(updated);
    } catch (error) {
        captureError(error, 'Failed to update workspace', { tags: { context: 'workspace' } });
        return reply.status(500).send({ error: true, message: 'Failed to update workspace' });
    }
}

async function remove(request: WorkspaceRequest, reply: FastifyReply) {
    try {
        await workspaceService.deleteWorkspace((request as ResolvedWorkspaceRequest).workspaceId);
        return reply.status(204).send();
    } catch (error) {
        captureError(error, 'Failed to delete workspace', { tags: { context: 'workspace' } });
        return reply.status(500).send({ error: true, message: 'Failed to delete workspace' });
    }
}

// --- Members ---

async function getMembers(request: WorkspaceRequest, reply: FastifyReply) {
    try {
        const members = await workspaceService.getMembers((request as ResolvedWorkspaceRequest).workspaceId);
        return reply.send(members);
    } catch (error) {
        captureError(error, 'Failed to list members', { tags: { context: 'workspace' } });
        return reply.status(500).send({ error: true, message: 'Failed to list members' });
    }
}

async function removeMember(request: WorkspaceRequest, reply: FastifyReply) {
    try {
        const { userId } = request.params as { userId: string };
        const req = request as ResolvedWorkspaceRequest;

        // Fetch the target member's role before removing
        const targetMember = await workspaceService.getMemberRole(req.workspaceId, userId);
        if (!targetMember) {
            return reply.status(404).send({ error: true, message: 'Member not found' });
        }

        // Admins can only remove members — not other admins or owners
        const requesterLevel = ROLE_HIERARCHY[req.workspaceRole] ?? 0;
        const targetLevel = ROLE_HIERARCHY[targetMember.role] ?? 0;
        if (requesterLevel <= targetLevel) {
            return reply.status(403).send({
                error: true,
                message: 'You can only remove members with a lower role than your own',
                code: 'INSUFFICIENT_ROLE',
            });
        }

        await workspaceService.removeMember(req.workspaceId, userId);
        return reply.status(204).send();
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to remove member';
        if (message.includes('last owner') || message.includes('not found')) {
            return reply.status(400).send({ error: true, message });
        }
        captureError(error, 'Failed to remove member', { tags: { context: 'workspace' } });
        return reply.status(500).send({ error: true, message: 'Failed to remove member' });
    }
}

async function updateMemberRole(request: WorkspaceRequest, reply: FastifyReply) {
    try {
        const { userId } = request.params as { userId: string };
        const { role } = request.body as { role: WorkspaceRole };

        if (!['owner', 'admin', 'member'].includes(role)) {
            return reply.status(400).send({ error: true, message: 'Invalid role' });
        }

        await workspaceService.updateMemberRole((request as ResolvedWorkspaceRequest).workspaceId, userId, role);
        return reply.status(204).send();
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to update role';
        if (message.includes('last owner') || message.includes('not found')) {
            return reply.status(400).send({ error: true, message });
        }
        captureError(error, 'Failed to update member role', { tags: { context: 'workspace' } });
        return reply.status(500).send({ error: true, message: 'Failed to update role' });
    }
}

// --- Invites ---

async function createInvite(request: WorkspaceRequest, reply: FastifyReply) {
    try {
        if (!(request as ResolvedWorkspaceRequest).workspaceId || !request.user) {
            return reply.status(400).send({ error: true, message: 'Workspace not resolved' });
        }
        // Accept `contact`; fall back to `email` for backwards compatibility.
        const body = request.body as { contact?: string; email?: string; role?: WorkspaceRole };
        const contact = (body.contact ?? body.email ?? '').trim();

        if (!contact) {
            return reply.status(400).send({ error: true, message: 'Email address is required' });
        }

        const { invite, rawToken, emailSent } = await workspaceInviteService.createInvite(
            (request as ResolvedWorkspaceRequest).workspaceId,
            contact.toLowerCase(),
            body.role || 'member',
            request.user.userId,
        );

        return reply.status(201).send({ invite, token: rawToken, emailSent });
    } catch (error) {
        // A phone contact is a client mistake, not a server fault — the invite
        // has no transport (D-123). 400 with a code the UI already translates,
        // and no Sentry noise for an input the dashboard itself rejects.
        if (error instanceof InvalidInviteContactError) {
            return reply.status(400).send({ error: true, code: 'email_required', message: 'Team invites require an email address' });
        }
        captureError(error, 'Failed to create invite', { tags: { context: 'workspace' } });
        return reply.status(500).send({ error: true, message: 'Failed to create invite' });
    }
}

async function listInvites(request: WorkspaceRequest, reply: FastifyReply) {
    try {
        const invites = await workspaceInviteService.getActiveInvites((request as ResolvedWorkspaceRequest).workspaceId);
        return reply.send(invites);
    } catch (error) {
        captureError(error, 'Failed to list invites', { tags: { context: 'workspace' } });
        return reply.status(500).send({ error: true, message: 'Failed to list invites' });
    }
}

async function revokeInvite(request: WorkspaceRequest, reply: FastifyReply) {
    try {
        const { inviteId } = request.params as { inviteId: string };
        await workspaceInviteService.revokeInvite(inviteId, (request as ResolvedWorkspaceRequest).workspaceId);
        return reply.status(204).send();
    } catch (error) {
        captureError(error, 'Failed to revoke invite', { tags: { context: 'workspace' } });
        return reply.status(500).send({ error: true, message: 'Failed to revoke invite' });
    }
}

async function acceptInvite(request: AuthenticatedRequest, reply: FastifyReply) {
    try {
        if (!request.user) {
            return reply.status(401).send({ error: true, message: 'Unauthorized' });
        }
        const { token } = request.body as { token: string };

        if (!token?.trim()) {
            return reply.status(400).send({ error: true, message: 'Invite token is required' });
        }

        const result = await workspaceInviteService.acceptInvite(token.trim(), request.user.userId);
        return reply.send(result);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to accept invite';
        if (message.includes('Invalid')) {
            return reply.status(400).send({ error: true, code: 'invite_not_found', message });
        }
        if (message.includes('expired')) {
            return reply.status(400).send({ error: true, code: 'invite_expired', message });
        }
        if (message.includes('already been')) {
            return reply.status(400).send({ error: true, code: 'already_member', message });
        }
        if (message.includes('User account not found')) {
            return reply.status(400).send({ error: true, code: 'user_not_found', message });
        }
        if (message.includes('limit reached')) {
            return reply.status(400).send({ error: true, code: 'member_limit_reached', message });
        }
        captureError(error, 'Failed to accept invite', { tags: { context: 'workspace' } });
        return reply.status(500).send({ error: true, message: 'Failed to accept invite' });
    }
}

// --- Last-active workspace ---

async function setLastActive(request: AuthenticatedRequest, reply: FastifyReply) {
    try {
        if (!request.user) {
            return reply.status(401).send({ error: true, message: 'Unauthorized' });
        }
        const { workspaceId } = request.body as { workspaceId?: string };
        if (!workspaceId?.trim()) {
            return reply.status(400).send({ error: true, message: 'workspaceId is required' });
        }

        await workspaceService.setLastActiveWorkspace(request.user.userId, workspaceId.trim());
        return reply.status(204).send();
    } catch (error) {
        if (error instanceof WorkspaceAccessDeniedError) {
            return reply.status(403).send({
                error: true,
                message: 'You are not a member of this workspace',
                code: 'WORKSPACE_ACCESS_DENIED',
            });
        }
        captureError(error, 'Failed to set last-active workspace', { tags: { context: 'workspace' } });
        return reply.status(500).send({ error: true, message: 'Failed to set last-active workspace' });
    }
}

// --- Settings ---

async function getSettings(request: WorkspaceRequest, reply: FastifyReply) {
    try {
        const settings = await workspaceSettingsService.getSettings((request as ResolvedWorkspaceRequest).workspaceId);
        return reply.send(settings);
    } catch (error) {
        captureError(error, 'Failed to get workspace settings', { tags: { context: 'workspace' } });
        return reply.status(500).send({ error: true, message: 'Failed to get settings' });
    }
}

async function updateSettings(request: WorkspaceRequest, reply: FastifyReply) {
    try {
        // Key allowlist — this route has no body schema and merges straight into
        // the workspaces.settings JSONB, so without the filter any admin-role
        // member could plant arbitrary keys there (including future field names,
        // pre-seeding a feature that has not shipped). isWorkspaceSettingsKey is
        // compile-checked against the WorkspaceSettings interface, so schema and
        // filter cannot drift. Unknown keys are dropped, not 400ed: stale clients
        // sending a since-removed field must not lose the whole save.
        const updates = Object.fromEntries(
            Object.entries(request.body as Record<string, unknown>)
                .filter(([key]) => isWorkspaceSettingsKey(key)),
        );
        if ('leadStages' in updates) {
            const sanitized = sanitizeLeadStages(updates.leadStages);
            if (sanitized === undefined) {
                return reply.status(400).send({ error: true, message: 'Invalid leadStages config' });
            }
            updates.leadStages = sanitized;
        }
        if ('leadFields' in updates) {
            const sanitized = sanitizeLeadFields(updates.leadFields);
            if (sanitized === undefined) {
                return reply.status(400).send({ error: true, message: 'Invalid leadFields config' });
            }
            updates.leadFields = sanitized;
        }
        // VALUES, not just key names. This route writes the JSONB the reply
        // pipeline actually reads (messageProcessor / commentProcessor load
        // workspace settings, not the per-user `settings` row), and the filter
        // above only checks that a key is spellable — so an enum could arrive as
        // any string, a number as a string, a 10 000-character persona. Nothing
        // downstream crashed (resolveEffectiveReplyMode degrades an unknown mode
        // to 'sales', the prompt stringifies whatever it gets), which is the
        // problem: the merchant sets something, no error comes back, and the
        // pipeline quietly ignores it.
        //
        // Validated with the SAME schema `PUT /settings` uses, so the two write
        // paths into one store cannot drift. Only the keys the schema declares
        // are handed to it — `leadStages` / `leadFields` are absent from it and
        // keep the dedicated sanitizers above (which do more than shape-check),
        // and the schema is `.strict()`, so passing them would reject the save.
        const schemaKeys = new Set(Object.keys(UpdateSettingsSchema.shape));
        const schemaSubset = Object.fromEntries(
            Object.entries(updates).filter(([key]) => schemaKeys.has(key)),
        );
        if (Object.keys(schemaSubset).length > 0) {
            // Zod treats an explicit `undefined` as "absent" on an .optional()
            // field, so it would pass — and then `{ ...current, replyMode:
            // undefined }` CLEARS a stored value on the way into the JSONB
            // (JSON.stringify drops undefined keys). No JSON body can express
            // undefined, so a key carrying it is a client bug, not an intent to
            // clear; say so rather than silently wiping the setting.
            const undefinedKey = Object.keys(schemaSubset)
                .find((key) => schemaSubset[key] === undefined);
            if (undefinedKey) {
                return reply.status(400).send({
                    error: true,
                    message: `${undefinedKey} was sent with no value — omit the key to leave it unchanged`,
                });
            }
            const validation = validateSchema(UpdateSettingsSchema, schemaSubset);
            if (!validation.success) {
                return reply.status(400).send({
                    error: true,
                    message: 'Invalid settings value',
                    details: validation.errors,
                });
            }
        }
        const settings = await workspaceSettingsService.updateSettings((request as ResolvedWorkspaceRequest).workspaceId, updates);
        return reply.send(settings);
    } catch (error) {
        captureError(error, 'Failed to update workspace settings', { tags: { context: 'workspace' } });
        return reply.status(500).send({ error: true, message: 'Failed to update settings' });
    }
}

export const workspaceController = {
    list,
    create,
    getOne,
    update,
    remove,
    getMembers,
    removeMember,
    updateMemberRole,
    createInvite,
    listInvites,
    revokeInvite,
    acceptInvite,
    setLastActive,
    getSettings,
    updateSettings,
};
