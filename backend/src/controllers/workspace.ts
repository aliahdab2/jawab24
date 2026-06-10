import { FastifyReply } from 'fastify';
import { workspaceService, WorkspaceAccessDeniedError } from '../services/workspace';
import { workspaceInviteService } from '../services/workspaceInvite';
import { workspaceSettingsService } from '../services/workspaceSettings';
import type { WorkspaceRequest, ResolvedWorkspaceRequest } from '../middleware/workspace';
import { ROLE_HIERARCHY } from '../utils/roles';
import type { AuthenticatedRequest } from '../middleware/auth';
import type { WorkspaceRole, LeadStagesConfig, LeadSubStage, LeadStageColor, LeadCustomFieldDef } from '@jawab24/shared';
import { LEAD_STAGE_COLORS, MAX_SUB_STAGES_PER_STAGE, MAX_SUB_STAGE_LABEL_LENGTH, MAX_LEAD_CUSTOM_FIELDS, MAX_LEAD_FIELD_LABEL_LENGTH } from '@jawab24/shared';
import { captureError } from '../utils/sentryHelpers';

/**
 * Sanitize a merchant-supplied leadStages config. Labels are intentionally
 * free text (any language, any business type — store, clinic, school, ...);
 * we only enforce shape, limits, and a known color so a malformed payload
 * can't break the Leads UI. Returns undefined when the input is unusable.
 */
function sanitizeLeadStages(input: unknown): LeadStagesConfig | undefined {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
    const out: LeadStagesConfig = {};
    for (const status of ['new', 'contacted', 'converted'] as const) {
        const list = (input as Record<string, unknown>)[status];
        if (!Array.isArray(list)) continue;
        const seen = new Set<string>();
        const clean: LeadSubStage[] = [];
        for (const item of list.slice(0, MAX_SUB_STAGES_PER_STAGE)) {
            if (typeof item !== 'object' || item === null) continue;
            const { id, label, color } = item as Record<string, unknown>;
            if (typeof id !== 'string' || !id || id.length > 64 || seen.has(id)) continue;
            if (typeof label !== 'string' || !label.trim()) continue;
            const safeColor = (LEAD_STAGE_COLORS as readonly string[]).includes(color as string)
                ? (color as LeadStageColor)
                : 'blue';
            seen.add(id);
            clean.push({ id, label: label.trim().slice(0, MAX_SUB_STAGE_LABEL_LENGTH), color: safeColor });
        }
        out[status] = clean;
    }
    return out;
}

/**
 * Sanitize merchant-defined custom field definitions (settings.leadFields).
 * Same philosophy as sanitizeLeadStages: labels are free text, we only
 * enforce shape and limits. Returns undefined when the input is unusable.
 */
function sanitizeLeadFields(input: unknown): LeadCustomFieldDef[] | undefined {
    if (!Array.isArray(input)) return undefined;
    const seen = new Set<string>();
    const clean: LeadCustomFieldDef[] = [];
    for (const item of input.slice(0, MAX_LEAD_CUSTOM_FIELDS)) {
        if (typeof item !== 'object' || item === null) continue;
        const { id, label } = item as Record<string, unknown>;
        if (typeof id !== 'string' || !id || id.length > 64 || seen.has(id)) continue;
        if (typeof label !== 'string' || !label.trim()) continue;
        seen.add(id);
        clean.push({ id, label: label.trim().slice(0, MAX_LEAD_FIELD_LABEL_LENGTH) });
    }
    return clean;
}

// --- Workspace CRUD ---

async function list(request: AuthenticatedRequest, reply: FastifyReply) {
    try {
        if (!request.user) {
            return reply.status(401).send({ error: true, message: 'Unauthorized' });
        }
        const workspaces = await workspaceService.getUserWorkspaces(request.user.userId);
        return reply.send(workspaces);
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
        // Accept `contact` (email or phone). Fall back to `email` for backwards compatibility.
        const body = request.body as { contact?: string; email?: string; role?: WorkspaceRole };
        const contact = (body.contact ?? body.email ?? '').trim();

        if (!contact) {
            return reply.status(400).send({ error: true, message: 'Email or phone number is required' });
        }

        const { invite, rawToken, smsSent, emailSent } = await workspaceInviteService.createInvite(
            (request as ResolvedWorkspaceRequest).workspaceId,
            contact.toLowerCase(),
            body.role || 'member',
            request.user.userId,
        );

        return reply.status(201).send({ invite, token: rawToken, smsSent, emailSent });
    } catch (error) {
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
        const updates = request.body as Record<string, unknown>;
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
