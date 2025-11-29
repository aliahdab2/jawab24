# Docker Deployment Plan — AutoReply.AI

## Overview
All services run in Docker containers orchestrated by docker-compose.

---

## Services

### 1. Backend
- **Image**: Node.js 18 or Python 3.11
- **Port**: 3000 (internal)
- **Dependencies**: PostgreSQL, Redis
- **Environment**: backend.env

### 2. Frontend
- **Image**: Node.js 18 (Next.js)
- **Port**: 3001 (internal)
- **Dependencies**: Backend API
- **Environment**: frontend.env

### 3. AI Worker
- **Image**: Node.js 18 or Python 3.11
- **Dependencies**: Redis, Backend
- **Environment**: ai.env

### 4. PostgreSQL
- **Image**: postgres:15-alpine
- **Port**: 5432 (internal)
- **Volume**: ./data/postgres
- **Environment**: db.env

### 5. Redis
- **Image**: redis:7-alpine
- **Port**: 6379 (internal)
- **Volume**: ./data/redis

### 6. Nginx
- **Image**: nginx:alpine
- **Port**: 80, 443 (external)
- **Config**: nginx.conf
- **SSL**: Let's Encrypt certificates

---

## docker-compose.yml

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    container_name: autoreply-db
    restart: unless-stopped
    env_file:
      - ./env/db.env
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
    networks:
      - autoreply-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: autoreply-redis
    restart: unless-stopped
    volumes:
      - ./data/redis:/data
    networks:
      - autoreply-network
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: autoreply-backend
    restart: unless-stopped
    env_file:
      - ./env/backend.env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - autoreply-network
    volumes:
      - ./backend/src:/app/src

  ai-worker:
    build:
      context: ./ai-worker
      dockerfile: Dockerfile
    container_name: autoreply-ai-worker
    restart: unless-stopped
    env_file:
      - ./env/ai.env
    depends_on:
      - redis
      - backend
    networks:
      - autoreply-network

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: autoreply-frontend
    restart: unless-stopped
    env_file:
      - ./env/frontend.env
    depends_on:
      - backend
    networks:
      - autoreply-network

  nginx:
    image: nginx:alpine
    container_name: autoreply-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
    depends_on:
      - backend
      - frontend
    networks:
      - autoreply-network

networks:
  autoreply-network:
    driver: bridge

volumes:
  postgres-data:
  redis-data:
```

---

## Dockerfiles

### Backend Dockerfile
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["node", "src/index.js"]
```

### Frontend Dockerfile
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3001

CMD ["npm", "start"]
```

### AI Worker Dockerfile
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

CMD ["node", "worker.js"]
```

---

## Nginx Configuration

```nginx
events {
    worker_connections 1024;
}

http {
    upstream backend {
        server backend:3000;
    }

    upstream frontend {
        server frontend:3001;
    }

    server {
        listen 80;
        server_name yourdomain.com;

        # Redirect to HTTPS
        return 301 https://$server_name$request_uri;
    }

    server {
        listen 443 ssl http2;
        server_name yourdomain.com;

        ssl_certificate /etc/nginx/ssl/fullchain.pem;
        ssl_certificate_key /etc/nginx/ssl/privkey.pem;

        # API
        location /api/ {
            proxy_pass http://backend/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Webhooks
        location /webhook/ {
            proxy_pass http://backend/webhook/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        # Frontend
        location / {
            proxy_pass http://frontend/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_cache_bypass $http_upgrade;
        }
    }
}
```

---

## Deployment Steps

### 1. Initial Setup
```bash
# Clone repository
git clone <repo-url>
cd autoreply-ai

# Create environment files
cp env/backend.env.example env/backend.env
cp env/frontend.env.example env/frontend.env
cp env/ai.env.example env/ai.env
cp env/db.env.example env/db.env

# Edit environment files with your values
nano env/backend.env
```

### 2. SSL Certificates
```bash
# Install certbot
sudo apt-get install certbot

# Get certificates
sudo certbot certonly --standalone -d yourdomain.com

# Copy to nginx directory
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem ./nginx/ssl/
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem ./nginx/ssl/
```

### 3. Start Services
```bash
# Build and start all services
docker-compose up -d

# Check logs
docker-compose logs -f

# Check status
docker-compose ps
```

### 4. Database Migration
```bash
# Run migrations
docker-compose exec backend npm run migrate

# Or manually
docker-compose exec postgres psql -U postgres -d autoreply < schema.sql
```

### 5. Verify
```bash
# Test backend
curl https://yourdomain.com/api/health

# Test webhook
curl https://yourdomain.com/webhook/facebook
```

---

## Maintenance

### Update Services
```bash
# Pull latest changes
git pull

# Rebuild and restart
docker-compose up -d --build
```

### View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
```

### Backup Database
```bash
# Backup
docker-compose exec postgres pg_dump -U postgres autoreply > backup.sql

# Restore
docker-compose exec -T postgres psql -U postgres autoreply < backup.sql
```

### Scale Services
```bash
# Scale AI workers
docker-compose up -d --scale ai-worker=3

# Scale backend
docker-compose up -d --scale backend=2
```

---

## Monitoring

### Health Checks
- Backend: `https://yourdomain.com/api/health`
- Database: `docker-compose exec postgres pg_isready`
- Redis: `docker-compose exec redis redis-cli ping`

### Resource Usage
```bash
docker stats
```

### Logs Rotation
Configure in docker-compose.yml:
```yaml
logging:
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "3"
```

---

## Security

### Environment Variables
- Never commit .env files
- Use strong passwords
- Rotate secrets regularly

### Network
- All services in private network
- Only Nginx exposed to public
- Use firewall rules

### SSL
- Auto-renew certificates
- Use strong ciphers
- Enable HSTS
