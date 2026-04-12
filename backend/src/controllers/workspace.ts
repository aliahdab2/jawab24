import { FastifyReply } from 'fastify';
import { workspaceService } from '../services/workspace';
import { workspaceInviteService } from '../services/workspaceInvite';
import { workspaceSettingsService } from '../services/workspaceSettings';
import type { WorkspaceRequest, ResolvedWorkspaceRequest } from '../middleware/workspace';
import type { AuthenticatedRequest } from '../middleware/auth';
import type { WorkspaceRole } from '@jawab24/shared';
import { captureError } from '../utils/sentryHelpers';

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
        await workspaceService.removeMember((request as ResolvedWorkspaceRequest).workspaceId, userId);
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

        const { invite, rawToken, smsSent } = await workspaceInviteService.createInvite(
            (request as ResolvedWorkspaceRequest).workspaceId,
            contact.toLowerCase(),
            body.role || 'member',
            request.user.userId,
        );

        return reply.status(201).send({ invite, token: rawToken, smsSent });
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
        if (message.includes('identity mismatch')) {
            return reply.status(403).send({ error: true, code: 'invite_identity_mismatch', message: 'This invite was sent to a different account' });
        }
        if (message.includes('limit reached')) {
            return reply.status(400).send({ error: true, code: 'member_limit_reached', message });
        }
        captureError(error, 'Failed to accept invite', { tags: { context: 'workspace' } });
        return reply.status(500).send({ error: true, message: 'Failed to accept invite' });
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
    getSettings,
    updateSettings,
};
