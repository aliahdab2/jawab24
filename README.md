# 🗨️ Jawab24

**ردود ذكية على مدار الساعة | Smart Facebook Auto-Replies 24/7**

Jawab24 is an intelligent auto-reply system for Facebook page comments. It uses AI and customizable templates to respond to customer inquiries automatically, saving hours of manual work.

---

## ✨ Features

- 🤖 **AI-Powered Replies** - GPT-4o-mini for intelligent, context-aware responses
- 📝 **Template System** - Create reusable reply templates with variables
- 🔤 **Multi-Language** - Arabic, English, Swedish support with auto-detection
- ⚡ **Instant Responses** - Reply to comments in under 1 second
- 📊 **Dashboard** - Beautiful web interface to manage everything
- 🔒 **Secure** - Facebook OAuth, JWT authentication

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- Facebook Developer Account
- OpenAI API Key

### Development

```bash
# Start database services
./scripts/deploy.sh dev

# Run backend
cd backend && npm install && npm run dev

# Run frontend (new terminal)
cd frontend && npm install && npm run dev

# Open http://localhost:3001
```

### Production

```bash
# Configure environment
cp env/backend.env.example env/backend.env
# Edit env files with your credentials

# Deploy
./scripts/deploy.sh prod
```

---

## 📁 Project Structure

```
jawab24/
├── backend/         # Fastify API server
├── frontend/        # Next.js dashboard
├── ai-worker/       # OpenAI integration service
├── nginx/           # Reverse proxy config
├── scripts/         # Deployment scripts
└── env/             # Environment templates
```

---

## 🔧 Configuration

### Required Credentials

1. **Facebook App** - [developers.facebook.com](https://developers.facebook.com)
   - App ID & Secret
   - Webhook verify token
   - Page permissions

2. **OpenAI API** - [platform.openai.com](https://platform.openai.com)
   - API Key

### Environment Variables

See `env/*.env.example` files for all configuration options.

---

## 📖 Documentation

- [Deployment Guide](./DEPLOYMENT.md)
- [API Specification](./API_SPEC.md)
- [Database Schema](./DATABASE_SCHEMA.md)
- [Architecture](./ARCHITECTURE.md)

---

## 🧪 Testing

```bash
# Backend tests
cd backend && npm test

# AI Worker tests
cd ai-worker && npm test
```

**86 tests passing** ✅

---

## 📊 Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js, Fastify, TypeScript |
| Frontend | Next.js, React, TailwindCSS |
| Database | PostgreSQL, Drizzle ORM |
| Cache | Redis |
| AI | OpenAI GPT-4o-mini |
| Deployment | Docker, Nginx |

---

## 🌐 Languages

- 🇸🇦 Arabic (العربية)
- 🇬🇧 English
- 🇸🇪 Swedish (Svenska)

---

## 📄 License

MIT License - See [LICENSE](./LICENSE) for details.

---

## 🤝 Support

For issues or questions, please open a GitHub issue.

---

**Built with ❤️ for Arabic-speaking businesses**
