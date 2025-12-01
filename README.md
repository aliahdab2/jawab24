# 🗨️ Jawab24

**ردود ذكية على مدار الساعة | Smart Facebook Auto-Replies 24/7**

Jawab24 is an intelligent auto-reply system for Facebook pages. It automates responses to **comments** and **private messages (DMs)** using AI and customizable templates, helping businesses engage with customers instantly.

**Live App:** [https://jawab24.com](https://jawab24.com)

---

## ✨ Features

- 🤖 **AI-Powered Replies** - Uses GPT-4o-mini to generate context-aware responses based on your business knowledge base.
- 💬 **Message & Comment Support** - Automates replies for both public comments and private messages.
- 📝 **Template System** - Create reusable reply templates with keywords.
- 🧠 **Business Knowledge Base** - Teach the AI about your products, prices, and policies for accurate answers.
- 🔤 **Multi-Language** - Supports unlimited languages (Arabic, English, Swedish, etc.) with auto-detection.
- ⚡ **Smart Automation** - Features like **Business Hours**, **Away Messages**, and **Reply Delays**.
- 🔒 **Secure** - Facebook OAuth integration and JWT authentication.
- 📊 **Dashboard** - Comprehensive analytics and management interface.

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

1. **Frontend**: Next.js (React) dashboard for management.
2. **Backend**: Node.js (Fastify) API handling auth, business logic, and webhooks.
3. **AI Worker**: Dedicated service for OpenAI interactions (decoupled for scalability).
4. **Database**: PostgreSQL (with Drizzle ORM) for structured data.
5. **Cache/Queue**: Redis for AI job queues and caching.
6. **Reverse Proxy**: Nginx handling SSL and routing.

### Data Flow
1. **Webhook**: Facebook sends event (comment/message) to Backend.
2. **Processing**: Backend checks Rules Engine.
3. **AI Fallback**: If no rule matches, job is sent to AI Worker via Redis.
4. **Generation**: AI Worker generates reply using Page Knowledge Base + Conversation History.
5. **Response**: Backend posts reply to Facebook Graph API.

---

## 📁 Project Structure

This project uses an **npm workspaces monorepo** structure:

```
jawab24/
├── backend/           # Node.js/Fastify API Server
├── frontend/          # Next.js Web Dashboard
├── ai-worker/         # AI Processing Service
├── packages/
│   └── shared/        # Shared TypeScript types (@jawab24/shared)
├── nginx/             # Nginx Configuration
├── scripts/           # Deployment & Utility Scripts
├── env/               # Environment Configs
├── .github/           # CI/CD Workflows
└── package.json       # Root workspace config
```

### Shared Types

The `@jawab24/shared` package contains common TypeScript interfaces used across services:
- `Message`, `Comment`, `Page` - Core data types
- `Template`, `Rule` - Configuration types
- `DashboardStats` - Analytics types

```typescript
import { Message, Comment } from '@jawab24/shared';
```

---

## 🔧 Deployment

The project uses **GitHub Actions** for CI/CD:
1. **CI**: Runs tests, linting, and builds on every push.
2. **CD**: Deploys to the production server via SSH if CI passes.

For manual deployment steps, see [DEPLOYMENT.md](./DEPLOYMENT.md).

---

## 📖 Documentation

- [Deployment Guide](./DEPLOYMENT.md) - Server setup and deployment.
- [Facebook Setup](./FACEBOOK_SETUP.md) - Configuring the Meta App.
- [API Specification](./API_SPEC.md) - Backend API endpoints.
- [Database Schema](./DATABASE_SCHEMA.md) - PostgreSQL schema.
- [Language Support](./LANGUAGE_SUPPORT.md) - Multi-language capabilities.

---

## 🧪 Testing

```bash
# Run all tests (from root)
npm test

# Or individual workspaces
npm test --workspace=jawab24-backend
npm test --workspace=jawab24-ai-worker
```

**Current Status:** 95 tests passing ✅

---

## 🌐 Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js, React, TailwindCSS, Zustand |
| **Backend** | Node.js, Fastify, TypeScript |
| **Database** | PostgreSQL, Drizzle ORM |
| **Queue/Cache** | Redis, BullMQ |
| **AI** | OpenAI GPT-4o-mini |
| **Infra** | Docker, Nginx, GitHub Actions |

---

## 📄 License

MIT License.
