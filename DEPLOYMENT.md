# Deployment Guide

## CI/CD Pipeline

Jawab24 uses GitHub Actions for continuous integration and deployment.

### Workflow Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Push to   │ ──► │  CI Tests   │ ──► │   Docker    │ ──► │   Deploy    │
│    main     │     │  & Linting  │     │   Build     │     │   to Prod   │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                           │                   │                   │
                           ▼                   ▼                   ▼
                    ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
                    │  Backend    │     │  All Images │     │  Health     │
                    │  Frontend   │     │  Build OK   │     │  Checks     │
                    │  AI Worker  │     │             │     │             │
                    └─────────────┘     └─────────────┘     └─────────────┘
```

### CI Pipeline (`ci.yml`)

Runs on every push to `main` or `develop`, and on all PRs to `main`.

**Jobs:**
1. **Backend** - TypeScript check, linting, tests, build
2. **AI Worker** - TypeScript check, linting, build
3. **Frontend** - TypeScript check, linting, Next.js build
4. **Docker** - Build all Docker images (only if above jobs pass)

### Deploy Pipeline (`deploy.yml`)

Runs automatically after CI passes on `main` branch.

**Steps:**
1. SSH into production server
2. Create backup of current deployment
3. Pull latest code
4. Build and restart containers
5. **Run database migrations automatically**
6. Run health checks (with retry logic)
7. Auto-rollback if health checks fail
8. Report success/failure

### Database Migrations

Migrations run automatically on container startup:
- The backend Dockerfile runs `node dist/migrate.js` before starting the app
- Uses Drizzle ORM migrations from `backend/drizzle/` folder
- Migrations are generated during Docker build

To run migrations manually:
```bash
# Generate new migration after schema changes
npm run generate --workspace=jawab24-backend

# Apply migrations
npm run deploy:migrate --workspace=jawab24-backend
```

## Required GitHub Secrets

Set these in your repository settings (Settings → Secrets → Actions):

| Secret | Description |
|--------|-------------|
| `SERVER_SSH_KEY` | Private SSH key for server access |
| `FACEBOOK_APP_ID` | Facebook App ID for frontend build |

### Setting Up SSH Key

1. Generate a deploy key (if you haven't already):
   ```bash
   ssh-keygen -t ed25519 -C "github-actions-deploy" -f deploy_key
   ```

2. Add the public key to your server:
   ```bash
   cat deploy_key.pub >> ~/.ssh/authorized_keys
   ```

3. Add the private key to GitHub Secrets as `SERVER_SSH_KEY`

## Local Development

### Pre-commit Checks

Always run before pushing:

```bash
./scripts/pre-deploy.sh
```

This runs:
- TypeScript checks for all projects
- Backend tests
- Build verification
- Docker build test

### Manual Deployment

If you need to deploy manually (not recommended):

```bash
ssh root@91.99.95.196 "cd /var/www/jawab24 && git pull && docker-compose up -d --build"
```

## Branch Protection (Recommended)

Set up branch protection for `main`:

1. Go to Settings → Branches → Add rule
2. Branch name pattern: `main`
3. Enable:
   - ✅ Require a pull request before merging
   - ✅ Require status checks to pass before merging
   - ✅ Require branches to be up to date before merging
   - ✅ Select required checks: `backend`, `frontend`, `ai-worker`, `docker`

## Rollback

The deployment pipeline includes **automatic rollback** if health checks fail. It restores from `.last_successful_deploy` backup.

For manual rollback:

```bash
# SSH into server
ssh root@91.99.95.196

# Go to project
cd /var/www/jawab24

# Rollback to previous commit
git reset --hard HEAD~1

# Rebuild
docker-compose up -d --build
```

**Note:** Database migrations are forward-only. If you need to rollback a migration, create a new migration that reverses the changes.

## Monitoring

### Check Container Status
```bash
docker-compose ps
```

### View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
```

### Health Endpoints
- Backend: `https://jawab24.com/api/health`
- Frontend: `https://jawab24.com`

## Troubleshooting

### CI Fails

1. Check the GitHub Actions logs
2. Run `./scripts/pre-deploy.sh` locally to reproduce
3. Fix the issue and push again

### Deploy Fails

1. Check the deploy workflow logs
2. SSH into server and check:
   ```bash
   docker-compose logs --tail=100
   ```
3. Check if disk space is full:
   ```bash
   df -h
   ```

### Container Won't Start

1. Check logs:
   ```bash
   docker-compose logs backend
   ```
2. Check if ports are in use:
   ```bash
   netstat -tlnp | grep 3000
   ```
3. Restart with fresh build:
   ```bash
   docker-compose down
   docker-compose up -d --build --force-recreate
   ```
# Deployment triggered at Sat Nov 29 22:02:17 CET 2025
