# Deployment Guide

## CI/CD Pipeline

Jawab24 uses GitHub Actions for continuous integration and **Blue-Green Deployment** for zero downtime.

### Workflow Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Push to   │ ──► │  CI Tests   │ ──► │   Docker    │ ──► │ Blue-Green  │
│    main     │     │  & Linting  │     │   Build     │     │   Deploy    │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                           │                   │                   │
                           ▼                   ▼                   ▼
                    ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
                    │  Backend    │     │  All Images │     │  Zero       │
                    │  Frontend   │     │  Build OK   │     │  Downtime   │
                    │  AI Worker  │     │             │     │  Instant    │
                    └─────────────┘     └─────────────┘     │  Rollback   │
                                                            └─────────────┘
```

## Blue-Green Deployment

We use **Blue-Green Deployment** for zero-downtime updates:

### How It Works

```
                    ┌─────────────────────────────────────┐
                    │              NGINX                   │
                    │         (Load Balancer)              │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
           ┌────────▼────────┐          ┌────────▼────────┐
           │  BLUE Environment│          │ GREEN Environment│
           │   (Active)       │          │   (Standby)      │
           │                  │          │                  │
           │  - backend-blue  │          │  - backend-green │
           │  - frontend-blue │          │  - frontend-green│
           │  - ai-worker-blue│          │  - ai-worker-green│
           └──────────────────┘          └──────────────────┘
```

### Deployment Steps

1. **Deploy to inactive environment** - If Blue is active, deploy to Green
2. **Health checks pass** - Wait for new containers to be healthy
3. **Switch traffic** - Update Nginx to point to the new environment
4. **Keep old environment** - For instant rollback if needed

### Benefits

| Feature | Benefit |
|---------|---------|
| **Zero Downtime** | Traffic switches instantly via Nginx |
| **Instant Rollback** | Old environment stays running |
| **Safe Testing** | New version is tested before switch |
| **No User Impact** | Users never see errors during deploy |

## CI Pipeline (`ci.yml`)

Runs on every push to `main` or `develop`, and on all PRs to `main`.

**Jobs:**
1. **Backend** - TypeScript check, linting, tests (95 tests), build
2. **AI Worker** - TypeScript check, linting, build
3. **Frontend** - TypeScript check, linting, Next.js build
4. **Docker** - Build all Docker images (only if above jobs pass)

## Deploy Pipeline (`deploy.yml`)

Runs automatically after CI passes on `main` branch.

**Steps:**
1. SSH into production server
2. Create backup of current deployment
3. Pull latest code
4. Build Docker images
5. Start new environment (blue or green)
6. Wait for health checks
7. Switch Nginx traffic
8. Verify deployment
9. (Optional) Stop old environment

## Manual Deployment

### Using the deploy script:

```bash
ssh root@91.99.95.196
cd /var/www/jawab24

# Deploy (auto-detects blue/green)
./scripts/deploy-blue-green.sh deploy

# Check status
./scripts/deploy-blue-green.sh status

# Rollback to previous environment
./scripts/deploy-blue-green.sh rollback
```

### Using docker-compose directly:

```bash
cd /var/www/jawab24

# Check current active environment
cat .active-env  # shows "blue" or "green"

# If blue is active, deploy to green:
docker-compose -f docker-compose.yml -f docker-compose.green.yml up -d \
  backend-green frontend-green ai-worker-green

# Then update nginx/upstream.conf and reload nginx
docker exec jawab24-nginx nginx -s reload
```

## Rollback

### Automatic Rollback
If deployment fails, the GitHub Action automatically rolls back to the previous environment.

### Manual Rollback
```bash
cd /var/www/jawab24

# Quick rollback (just switch traffic)
./scripts/deploy-blue-green.sh rollback

# Or manually:
# If green is active and broken, switch back to blue:
cat > ./nginx/upstream.conf << EOF
upstream backend_active {
    server jawab24-backend-blue:3000;
}
upstream frontend_active {
    server jawab24-frontend-blue:3001;
}
upstream ai_worker_active {
    server jawab24-ai-worker-blue:3002;
}
EOF

docker exec jawab24-nginx nginx -s reload
echo "blue" > .active-env
```

## Monitoring

### Check deployment status:
```bash
# Which environment is active?
cat /var/www/jawab24/.active-env

# Container status
docker-compose ps

# Check specific environment
docker ps | grep blue
docker ps | grep green

# View logs
docker-compose logs -f backend-blue
docker-compose logs -f frontend-green
```

### Health check endpoints:
- **Website:** https://jawab24.com
- **API Health:** https://jawab24.com/api/health
- **Nginx Health:** https://jawab24.com/nginx-health

## Server Requirements

- **OS:** Ubuntu 22.04+ or Debian 11+
- **Docker:** 24.0+
- **Docker Compose:** v2.20+
- **RAM:** 4GB minimum
- **Disk:** 20GB minimum
- **SSL:** Let's Encrypt certificates in `/etc/letsencrypt`

## Troubleshooting

### Deployment stuck
```bash
# Check which containers are running
docker ps

# Check container logs
docker-compose logs --tail 50 backend-blue
docker-compose logs --tail 50 frontend-green

# Restart specific service
docker-compose restart backend-blue
```

### Health checks failing
```bash
# Test health endpoint directly
docker exec jawab24-backend-blue wget -qO- http://127.0.0.1:3000/health
docker exec jawab24-frontend-blue wget -qO- http://127.0.0.1:3001

# Check if ports are listening
docker exec jawab24-backend-blue netstat -tlnp
```

### Nginx not switching
```bash
# Check nginx config
docker exec jawab24-nginx cat /etc/nginx/upstream.conf

# Test nginx config
docker exec jawab24-nginx nginx -t

# Reload nginx
docker exec jawab24-nginx nginx -s reload
```
