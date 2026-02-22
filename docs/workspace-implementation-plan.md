# Workspace / Team Support — Implementation Plan

> **Last updated**: 2026-02-22
> **Status**: Infrastructure complete. UI deferred. Feature invisible to users.

---

## Overview

Jawab24 is **multi-tenant from day one**. All business data (pages, templates, rules, settings) is scoped by `workspaceId`. Every user gets a workspace silently on signup. The reply pipeline, middleware, and services are fully workspace-aware.

**No team UI is exposed in v1.** The app looks and feels like a single-user app. Team management (invite page, workspace switcher, role indicators) will be added when customers request it.

---

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Workspace created silently on signup | No migration risk later; infra is battle-tested in production |
| Settings page unchanged | Sync bridge (`syncPipelineFieldsToWorkspace`) keeps user settings and workspace settings in sync |
| `workspace_settings` as JSONB on `workspaces` table | Industry standard — avoids separate table, flexible schema |
| `pages.userId` kept as billing owner | Avoids extra DB lookup on every webhook; subscription checked against owner |
| `X-Workspace-Id` header on every request | Transparent; auto-selected when user has one workspace |
| No feature flag | Would require maintaining two code paths across ~15 services — too costly |

---

## Implementation Status

### Phase 1: Database — DONE

| Item | Status |
|------|--------|
| `workspaces` table (id, ownerId, name, slug, settings JSONB) | Done |
| `workspace_members` table (workspaceId, userId, role, unique index) | Done |
| `workspace_invites` table (tokenHash, role, status, expiry) | Done |
| `pages` — `workspaceId` column | Done |
| `templates` — `workspaceId` column | Done |
| `rules` — `workspaceId` column | Done |
| `ecommerce_stores` — `workspaceId` column | Done |
| `logs`, `ai_usage_log` — `workspaceId` column | Done |
| Shared types (`WorkspaceSummary`, `WorkspaceMember`, etc.) | Done |

**Key files:**
- `backend/src/db/schema.ts` — all table definitions
- `packages/shared/src/index.ts` — shared TypeScript types

### Phase 2: Backend — DONE

| Item | Status |
|------|--------|
| `resolveWorkspace` middleware (auto-select, 409 for multi-workspace) | Done |
| `requireRole` middleware (owner > admin > member) | Done |
| `WorkspaceService` (CRUD, member management, last-owner guards) | Done |
| `WorkspaceInviteService` (create, accept, revoke, hashed tokens) | Done |
| `WorkspaceSettingsService` (Redis-cached, business hours, multilingual messages) | Done |
| Workspace routes + controller (full REST API) | Done |
| Pages, templates, rules services — `workspaceId` scoped | Done |
| Comments, messages services — join through `pages.workspaceId` | Done |
| Reply pipeline (`commentProcessor`, `messageProcessor`, `generator`) — workspace-aware | Done |
| Settings sync bridge (`syncPipelineFieldsToWorkspace`) | Done |
| Auth service — auto-create workspace on signup | Done |
| Pipeline integration test (G4 guardrail) | Done |
| Workspace isolation tests | Done |

**Key files:**
- `backend/src/middleware/workspace.ts`
- `backend/src/services/workspace.ts`
- `backend/src/services/workspaceInvite.ts`
- `backend/src/services/workspaceSettings.ts`
- `backend/src/routes/workspace.ts`
- `backend/src/controllers/workspace.ts`
- `backend/test/integration/pipeline.test.ts`
- `backend/test/integration/workspace.test.ts`
- `backend/test/integration/workspace-regressions.test.ts`

### Phase 3: Frontend Infrastructure — DONE (core)

| Item | Status |
|------|--------|
| `store.ts` — `workspaces`, `activeWorkspaceId`, setters | Done |
| `api.ts` — `X-Workspace-Id` header on every request | Done |
| `api.ts` — `workspaceApi` helper methods | Done |
| `callback.tsx` — stores workspaces from auth response | Done |
| `authManager.ts` — clears workspace on logout | Done |

**Key files:**
- `frontend/src/lib/store.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/pages/auth/callback.tsx`
- `frontend/src/lib/authManager.ts`

### Phase 4: Testing — Backend DONE

| Item | Status |
|------|--------|
| Workspace service integration tests | Done |
| Workspace invite integration tests | Done |
| Workspace settings integration tests | Done |
| Pipeline integration test (webhook -> workspace -> reply) | Done |
| Workspace isolation / IDOR regression tests | Done |
| Workspace middleware unit tests | Done |

---

## Deferred Items — When Team UI Is Activated

These items are **not needed** until you decide to expose team features to users:

| Item | What it does | Effort |
|------|-------------|--------|
| `frontend/src/pages/invite/[token].tsx` | Landing page for invite links | ~1 day |
| Settings page split | Read business settings from workspace API instead of user settings | ~1 day |
| Translation keys (`en.json`, `ar.json`) | ~5-8 keys for invite accept flow | ~1 hour |
| E2E fixture updates | Add `workspaces: []` to mock auth responses | ~half day |
| `frontend/e2e/invite.spec.ts` | E2E test for invite accept flow | ~half day |
| Team management page | List members, invite button, role management | ~2-3 days |
| Workspace switcher | For users with >1 workspace | ~1 day |

**Total to activate team UI: ~5-7 days**

---

## Settings Sync — How It Works

The settings page (`/settings`) writes to the `settings` table (user-scoped). The reply pipeline reads from `workspaces.settings` JSONB (workspace-scoped). They stay in sync via:

```
User saves settings
  → PATCH /settings
  → settingsService.updateSettings(userId, updates)
    → writes to `settings` table
    → invalidates Redis cache `settings:v1:{userId}`
    → calls syncPipelineFieldsToWorkspace(userId, updates)
      → extracts pipeline fields (business hours, away message, AI settings, etc.)
      → looks up user's workspace via workspace_members
      → calls workspaceSettingsService.updateSettings(workspaceId, pipelineUpdates)
        → merges into workspaces.settings JSONB
        → invalidates Redis cache `workspace_settings:v1:{workspaceId}`

Reply pipeline
  → webhook arrives → resolves page.workspaceId
  → workspaceSettingsService.getSettings(workspaceId)
  → reads fresh data (cache miss after invalidation)
```

---

## Guardrails

| ID | Rule | Enforced by |
|----|------|-------------|
| G1 | No workspace header + >1 workspace → 409 | `resolveWorkspace` middleware |
| G2 | Invite accept sets active workspace immediately | Frontend (deferred) |
| G3 | Cannot remove/demote last owner | `workspace.removeMember`, `workspace.updateMemberRole` (transactional check) |
| G4 | Pipeline integration test must pass | `backend/test/integration/pipeline.test.ts` |

---

## API Endpoints (all exist, backend-ready)

```
POST   /workspaces                       — create workspace
GET    /workspaces                       — list user's workspaces
GET    /workspaces/:id                   — get workspace details
PUT    /workspaces/:id                   — update workspace (admin+)
DELETE /workspaces/:id                   — delete workspace (owner only)
GET    /workspaces/:id/members           — list members
DELETE /workspaces/:id/members/:userId   — remove member (admin+)
PATCH  /workspaces/:id/members/:userId   — change role (owner only)
POST   /workspaces/:id/invites           — create invite (admin+)
GET    /workspaces/:id/invites           — list invites (admin+)
DELETE /workspaces/:id/invites/:inviteId — revoke invite (admin+)
POST   /invites/accept                   — accept invite
GET    /workspaces/:id/settings          — get workspace settings
PUT    /workspaces/:id/settings          — update workspace settings (admin+)
```
