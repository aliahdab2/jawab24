# 🚀 Jawab24 Deployment Guide

This guide covers deploying Jawab24 to production.

---

## 📋 Prerequisites

- Docker & Docker Compose installed
- Domain name (for production)
- SSL certificate (Let's Encrypt recommended)
- Facebook Developer Account (for OAuth)
- OpenAI API key (for AI replies)

---

## 🏃 Quick Start (Development)

```bash
# 1. Clone the repository
git clone <repo-url>
cd jawab24

# 2. Start database services
./scripts/deploy.sh dev

# 3. Run backend (in new terminal)
cd backend && npm install && npm run dev

# 4. Run frontend (in new terminal)
cd frontend && npm install && npm run dev

# 5. Open http://localhost:3001
```

---

## 🌐 Production Deployment

### Step 1: Prepare Environment Files

```bash
# Copy example files
cp env/backend.env.example env/backend.env
cp env/frontend.env.example env/frontend.env
cp env/ai.env.example env/ai.env
cp env/db.env.example env/db.env

# Edit with your values
nano env/backend.env
```

### Step 2: Configure Environment Variables

**`env/backend.env`** - Required settings:
```env
# Generate a strong secret: openssl rand -base64 32
JWT_SECRET=your_strong_secret_here

# Facebook (get from developers.facebook.com)
FACEBOOK_APP_ID=123456789
FACEBOOK_APP_SECRET=abc123...
FACEBOOK_WEBHOOK_VERIFY_TOKEN=random_string_here

# Database password (change this!)
DB_PASSWORD=strong_password_here
```

**`env/ai.env`** - OpenAI settings:
```env
OPENAI_API_KEY=sk-your-key-here
```

### Step 3: SSL Certificate (Production)

Using Let's Encrypt:
```bash
# Install certbot
sudo apt-get install certbot

# Get certificate (stop nginx first if running)
sudo certbot certonly --standalone -d yourdomain.com

# Copy certificates
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem ./nginx/ssl/
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem ./nginx/ssl/
```

### Step 4: Update Nginx Configuration

Edit `nginx/nginx.conf`:
1. Replace `yourdomain.com` with your actual domain
2. Uncomment the HTTPS server block
3. Update the HTTP server to redirect to HTTPS

### Step 5: Deploy

```bash
# Build and start all services
./scripts/deploy.sh prod

# Check status
./scripts/health-check.sh

# View logs
docker-compose logs -f
```

---

## 🔧 Configuration

### Services & Ports

| Service | Internal Port | External Port | Description |
|---------|---------------|---------------|-------------|
| Nginx | 80, 443 | 80, 443 | Reverse proxy |
| Backend | 3000 | - | API server |
| Frontend | 3001 | - | Next.js app |
| AI Worker | 3002 | - | OpenAI service |
| PostgreSQL | 5432 | - | Database |
| Redis | 6379 | - | Cache |

### URL Routes

| Route | Service | Description |
|-------|---------|-------------|
| `/` | Frontend | Web dashboard |
| `/api/*` | Backend | REST API |
| `/auth/*` | Backend | OAuth endpoints |
| `/webhook` | Backend | Facebook webhooks |
| `/ai/*` | AI Worker | AI generation |

---

## 📊 Monitoring

### Health Checks

```bash
# Run health check script
./scripts/health-check.sh

# Or manually
curl http://localhost/health        # Backend
curl http://localhost/ai/health     # AI Worker
curl http://localhost/nginx-health  # Nginx
```

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f ai-worker
```

### Resource Usage

```bash
docker stats
```

---

## 💾 Database Management

### Backup

```bash
# Create backup
./scripts/backup.sh

# Backups are stored in ./backups/
```

### Restore

```bash
# List backups
ls -la ./backups/

# Restore from backup
./scripts/restore.sh ./backups/autoreply_backup_20240101_120000.sql.gz
```

### Run Migrations

```bash
# Using Docker
docker-compose exec backend node dist/db/migrate.js

# Or directly with psql
docker-compose exec -T postgres psql -U postgres -d autoreply < backend/migrations/001_initial_schema.sql
```

---

## 🔄 Updates

### Update Application

```bash
# Pull latest code
git pull

# Rebuild and restart
docker-compose up -d --build

# Or use the deploy script
./scripts/deploy.sh prod
```

### Update Single Service

```bash
# Rebuild specific service
docker-compose build backend
docker-compose up -d backend
```

---

## 🛡️ Security Checklist

- [ ] Strong JWT secret (32+ characters)
- [ ] Strong database password
- [ ] SSL certificate configured
- [ ] Facebook App in production mode
- [ ] Firewall configured (only 80, 443 open)
- [ ] Environment files not in git
- [ ] Regular backups scheduled

---

## 🐛 Troubleshooting

### Services won't start

```bash
# Check logs
docker-compose logs

# Check if ports are in use
lsof -i :80
lsof -i :443
```

### Database connection issues

```bash
# Check if postgres is running
docker-compose exec postgres pg_isready

# Check connection from backend
docker-compose exec backend node -e "console.log(process.env.DATABASE_URL)"
```

### Facebook webhook not working

1. Verify webhook URL is accessible: `curl https://yourdomain.com/webhook`
2. Check verify token matches in Facebook App settings
3. Ensure SSL certificate is valid

### AI replies not working

1. Check OpenAI API key is set in `env/ai.env`
2. Verify AI Worker is running: `curl http://localhost:3002/health`
3. Check AI Worker logs: `docker-compose logs ai-worker`

---

## 📞 Support

For issues, check:
1. Service logs: `docker-compose logs -f`
2. Health status: `./scripts/health-check.sh`
3. Documentation in this repository

---

## 📁 File Structure

```
AutoReply/
├── backend/           # Fastify API
├── frontend/          # Next.js dashboard
├── ai-worker/         # OpenAI service
├── nginx/             # Reverse proxy config
├── env/               # Environment files
├── scripts/           # Deployment scripts
│   ├── deploy.sh      # Main deployment
│   ├── backup.sh      # Database backup
│   ├── restore.sh     # Database restore
│   └── health-check.sh # Health monitoring
├── docker-compose.yml      # Production
└── docker-compose.dev.yml  # Development
```

