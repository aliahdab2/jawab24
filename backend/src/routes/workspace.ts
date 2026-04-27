import { FastifyInstance } from 'fastify';
import { workspaceController } from '../controllers/workspace';
import { authenticate } from '../middleware/auth';
import { resolveWorkspace, requireRole } from '../middleware/workspace';
import { auth } from '../utils/swagger';

export default async function workspaceRoutes(fastify: FastifyInstance) {
    // --- Authenticated (no workspace context needed) ---
    fastify.register(async (authOnly) => {
        authOnly.addHook('preHandler', authenticate);

        // List user's workspaces
        authOnly.get('/workspaces', {
            schema: { tags: ['Workspaces'], summary: 'List user workspaces', security: auth },
        }, workspaceController.list);

        // Create a new workspace
        authOnly.post('/workspaces', {
            schema: { tags: ['Workspaces'], summary: 'Create workspace', security: auth },
        }, workspaceController.create);

        // Accept invite (no workspace context — user is joining a new one)
        authOnly.post('/invites/accept', {
            schema: { tags: ['Workspaces'], summary: 'Accept workspace invite', security: auth },
        }, workspaceController.acceptInvite);

        // Persist the user's last-active workspace. Picks where the next login lands.
        // No resolveWorkspace hook — this endpoint chooses the workspace, so running
        // the resolver would be circular. Membership is enforced inside the service.
        authOnly.patch('/me/last-workspace', {
            schema: { tags: ['Workspaces'], summary: 'Set user\'s last-active workspace', security: auth },
        }, workspaceController.setLastActive);
    });

    // --- Workspace-scoped (member+) ---
    fastify.register(async (wsRoutes) => {
        wsRoutes.addHook('preHandler', authenticate);
        wsRoutes.addHook('preHandler', resolveWorkspace);

        // Workspace details
        wsRoutes.get('/workspaces/current', {
            schema: { tags: ['Workspaces'], summary: 'Get current workspace', security: auth },
        }, workspaceController.getOne);

        // Members (member+ can view)
        wsRoutes.get('/workspaces/current/members', {
            schema: { tags: ['Workspaces'], summary: 'List workspace members', security: auth },
        }, workspaceController.getMembers);

        // Settings (member+ can read)
        wsRoutes.get('/workspaces/current/settings', {
            schema: { tags: ['Workspaces'], summary: 'Get workspace settings', security: auth },
        }, workspaceController.getSettings);
    });

    // --- Workspace-scoped (admin+) ---
    fastify.register(async (adminRoutes) => {
        adminRoutes.addHook('preHandler', authenticate);
        adminRoutes.addHook('preHandler', resolveWorkspace);
        adminRoutes.addHook('preHandler', requireRole('admin'));

        // Update workspace
        adminRoutes.put('/workspaces/current', {
            schema: { tags: ['Workspaces'], summary: 'Update workspace', security: auth },
        }, workspaceController.update);

        // Update settings
        adminRoutes.put('/workspaces/current/settings', {
            schema: { tags: ['Workspaces'], summary: 'Update workspace settings', security: auth },
        }, workspaceController.updateSettings);

        // Remove member
        adminRoutes.delete('/workspaces/current/members/:userId', {
            schema: { tags: ['Workspaces'], summary: 'Remove member', security: auth },
        }, workspaceController.removeMember);

        // Invites
        adminRoutes.post('/workspaces/current/invites', {
            schema: { tags: ['Workspaces'], summary: 'Create invite', security: auth },
        }, workspaceController.createInvite);

        adminRoutes.get('/workspaces/current/invites', {
            schema: { tags: ['Workspaces'], summary: 'List active invites', security: auth },
        }, workspaceController.listInvites);

        adminRoutes.delete('/workspaces/current/invites/:inviteId', {
            schema: { tags: ['Workspaces'], summary: 'Revoke invite', security: auth },
        }, workspaceController.revokeInvite);
    });

    // --- Workspace-scoped (owner only) ---
    fastify.register(async (ownerRoutes) => {
        ownerRoutes.addHook('preHandler', authenticate);
        ownerRoutes.addHook('preHandler', resolveWorkspace);
        ownerRoutes.addHook('preHandler', requireRole('owner'));

        // Change member role
        ownerRoutes.patch('/workspaces/current/members/:userId', {
            schema: { tags: ['Workspaces'], summary: 'Change member role', security: auth },
        }, workspaceController.updateMemberRole);

        // Delete workspace
        ownerRoutes.delete('/workspaces/current', {
            schema: { tags: ['Workspaces'], summary: 'Delete workspace', security: auth },
        }, workspaceController.remove);
    });
}
