# 🗨️ Jawab24

**ردود ذكية على مدار الساعة | Smart Facebook Auto-Replies 24/7**

Jawab24 is an intelligent auto-reply system for Facebook pages. It automates responses to **comments** and **private messages (DMs)** using AI and customizable templates, helping businesses engage with customers instantly.

**Live App:** [https://jawab24.com](https://jawab24.com)

---

## ✨ Features

### Core
- 🤖 **Smart Auto-Replies** - Intelligent responses powered by GPT-4o-mini, based on your business info.
- 💬 **Comments & Messages** - Automates replies for both public comments and private messages (DMs).
- 📝 **Template System** - Create reusable reply templates with keyword triggers.
- 🧠 **Business Info** - Add your products, prices, and policies for accurate, personalized answers.
- 🔤 **Multi-Language** - Supports Arabic, English, Swedish, and more with auto-detection.

### Automation
- ⚡ **Business Hours** - Auto-reply only during your working hours.
- 💤 **Away Messages** - Custom messages when you're unavailable.
- ⏱️ **Reply Delays** - Natural delays to avoid instant bot-like responses.

### Management
- 📊 **Dashboard** - Analytics and performance overview.
- 📜 **Conversation History** - View full message threads with customers.
- 🤝 **Human Handoff** - Get notified when smart replies can't help (negative sentiment, complex questions).
- 📥 **Export Data** - Download comments and messages as CSV.

### Technical
- 🔒 **Secure** - Facebook OAuth + JWT authentication.
- 📱 **Mobile Responsive** - Works great on all devices.
- 🛡️ **Error Handling** - Graceful error boundaries prevent crashes.
- 🚀 **Zero-Downtime Deploys** - Blue-green deployment strategy.

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- Facebook Developer Account (Business App)
- OpenAI API Key

### Local Development

```bash
# 1. Clone the repo
git clone https://github.com/aliahdab2/jawab24.git
cd jawab24

# 2. Install dependencies (monorepo - installs all workspaces)
npm install

# 3. Setup Environment Variables
cp env/backend.env.example env/backend.env
cp env/frontend.env.example env/frontend.env
cp env/ai.env.example env/ai.env
cp env/db.env.example env/db.env
# Edit files with your credentials

# 4. Run with Docker
docker-compose up -d

# App will be available at http://localhost:3001
```

### Development Without Docker

```bash
# Build shared types first (required by other packages)
npm run build --workspace=@jawab24/shared

# Run individual services
npm run dev --workspace=jawab24-backend
npm run dev --workspace=jawab24-frontend
npm run dev --workspace=jawab24-ai-worker
```

---

## 🏗️ Architecture

The system is built with a microservices-ready architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                         NGINX                                │
│                   (Reverse Proxy + SSL)                      │
└──────────────────────────┬──────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼───────┐  ┌───────▼───────┐  ┌───────▼───────┐
│   Frontend    │  │    Backend    │  │   AI Worker   │
│   (Next.js)   │  │   (Fastify)   │  │   (OpenAI)    │
└───────────────┘  └───────┬───────┘  └───────┬───────┘
                           │                  │
                    ┌──────┴──────┐    ┌──────┴──────┐
                    │  PostgreSQL │    │    Redis    │
                    │  (Database) │    │   (Queue)   │
                    └─────────────┘    └─────────────┘
```

### Components

1. **Frontend**: Next.js (React) dashboard for management
2. **Backend**: Node.js (Fastify) API handling auth, business logic, and webhooks
3. **AI Worker**: Dedicated service for OpenAI interactions (decoupled for scalability)
4. **Database**: PostgreSQL (with Drizzle ORM) for structured data
5. **Cache/Queue**: Redis for AI job queues and caching
6. **Reverse Proxy**: Nginx handling SSL, routing, and load balancing

### Data Flow
1. **Webhook**: Facebook sends event (comment/message) to Backend
2. **Processing**: Backend checks Rules Engine
3. **AI Fallback**: If no rule matches, job is sent to AI Worker via Redis
4. **Generation**: AI Worker generates reply using Page Knowledge Base + Conversation History
5. **Response**: Backend posts reply to Facebook Graph API

---

## 📁 Project Structure

This project uses an **npm workspaces monorepo** structure:

```
jawab24/
├── backend/              # Node.js/Fastify API Server
│   ├── src/
│   │   ├── controllers/  # Route handlers
│   │   ├── services/     # Business logic
│   │   ├── db/           # Database schema & connection
│   │   └── routes/       # API routes
│   └── test/             # 95 tests
├── frontend/             # Next.js Web Dashboard
│   └── src/
│       ├── components/   # React components
│       ├── pages/        # Next.js pages
│       └── i18n/         # Internationalization
├── ai-worker/            # AI Processing Service
├── packages/
│   └── shared/           # Shared TypeScript types (@jawab24/shared)
├── nginx/                # Nginx Configuration
│   ├── nginx.conf        # Main config
│   └── upstream.conf     # Blue-green routing
├── scripts/              # Deployment & Utility Scripts
├── env/                  # Environment Configs (gitignored)
├── .github/              # CI/CD Workflows
├── docker-compose.yml    # Main Docker config
├── docker-compose.blue.yml   # Blue environment
├── docker-compose.green.yml  # Green environment
└── package.json          # Root workspace config
```

### Shared Types

The `@jawab24/shared` package contains common TypeScript interfaces used across services:
- `Message`, `Comment`, `Page` - Core data types
- `Template`, `Rule` - Configuration types
- `DashboardStats` - Analytics types

```typescript
import type { Message, Comment, Page } from '@jawab24/shared';
```

---

## 🔒 Security: Environment Setup

**Important:** Never commit actual credentials to the repository. The `env/*.env` files are gitignored.

### Required Environment Files

1. **Copy example files:**
   ```bash
   cp env/backend.env.example env/backend.env
   cp env/frontend.env.example env/frontend.env
   cp env/ai.env.example env/ai.env
   cp env/db.env.example env/db.env
   ```

2. **Set secure values in each file:**
   - `db.env`: Set a strong `POSTGRES_PASSWORD`
   - `backend.env`: Match `DATABASE_URL` password, set `JWT_SECRET`, add Facebook credentials
   - `ai.env`: Add your `OPENAI_API_KEY`
   - `frontend.env`: Add your `NEXT_PUBLIC_FB_APP_ID`

3. **For production servers:** Copy the same env files to the server's `env/` directory.

### GitHub Actions Secrets

For CI/CD deployment, set these secrets in your GitHub repository:
- `SERVER_SSH_KEY`: Private SSH key for server access

---

## 🔧 Deployment

The project uses **GitHub Actions** for CI/CD with **Blue-Green Deployment** for zero downtime:

### How Blue-Green Works

```
┌─────────────────────────────────────┐
│              NGINX                   │
│         (Load Balancer)              │
└──────────────┬──────────────────────┘
               │ (switches instantly)
┌──────────────┴──────────────┐
│                             │
│  BLUE (active)    GREEN (standby)
│  - backend-blue   - backend-green
│  - frontend-blue  - frontend-green
```

1. **CI**: Runs tests (95 tests), linting, and builds on every push
2. **CD**: Deploys to inactive environment, health checks, then switches traffic

### Manual Commands

```bash
# Check deployment status
./scripts/deploy-blue-green.sh status

# Manual deploy
./scripts/deploy-blue-green.sh deploy

# Instant rollback
./scripts/deploy-blue-green.sh rollback
```

For detailed deployment instructions, see [DEPLOYMENT.md](./DEPLOYMENT.md).

---

## 📖 Documentation

- [Deployment Guide](./DEPLOYMENT.md) - Blue-green deployment, server setup
- [Facebook Setup](./FACEBOOK_SETUP.md) - Configuring the Meta App
- [API Specification](./API_SPEC.md) - Backend API endpoints
- [Database Schema](./DATABASE_SCHEMA.md) - PostgreSQL schema
- [Language Support](./LANGUAGE_SUPPORT.md) - Multi-language capabilities

---

## 🧪 Testing

```bash
# Run all tests (from root)
npm test

# Or individual workspaces
npm test --workspace=jawab24-backend
npm test --workspace=jawab24-ai-worker
```

**Current Status:** 95 backend tests passing ✅

---

## 🌐 Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 13, React, TailwindCSS, Zustand |
| **Backend** | Node.js 18, Fastify, TypeScript |
| **Database** | PostgreSQL 15, Drizzle ORM |
| **Queue/Cache** | Redis 7 |
| **AI** | OpenAI GPT-4o-mini |
| **Infra** | Docker, Nginx, GitHub Actions |
| **Monitoring** | UptimeRobot |

---

## 📊 Monitoring

- **Uptime Monitoring**: UptimeRobot (external)
- **Status Check**: `./scripts/check-status.sh`
- **Health Endpoints**:
  - Website: https://jawab24.com
  - API: https://jawab24.com/api/health
  - Nginx: https://jawab24.com/nginx-health

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

MIT License - see [LICENSE](./LICENSE) for details.
