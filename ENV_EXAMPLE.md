# Environment Variables — AutoReply.AI

## backend.env
```env
# Server
NODE_ENV=production
PORT=3000
API_URL=https://yourdomain.com/api

# Database
DB_HOST=postgres
DB_PORT=5432
DB_NAME=autoreply
DB_USER=postgres
DB_PASSWORD=your_secure_password

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT
JWT_SECRET=your_jwt_secret_key_here
JWT_EXPIRES_IN=7d

# Facebook
FACEBOOK_APP_ID=your_facebook_app_id
FACEBOOK_APP_SECRET=your_facebook_app_secret
FACEBOOK_REDIRECT_URI=https://yourdomain.com/auth/facebook/callback
FACEBOOK_WEBHOOK_VERIFY_TOKEN=your_webhook_verify_token

# AI Service
AI_SERVICE_URL=http://ai-worker:3002
AI_ENABLED=true
AI_CACHE_ENABLED=true

# Logging
LOG_LEVEL=info
```

---

## frontend.env
```env
# App
NEXT_PUBLIC_API_URL=https://yourdomain.com/api
NEXT_PUBLIC_APP_NAME=AutoReply.AI

# Facebook
NEXT_PUBLIC_FACEBOOK_APP_ID=your_facebook_app_id

# Features
NEXT_PUBLIC_AI_ENABLED=true
NEXT_PUBLIC_DEFAULT_LANGUAGE=ar
```

---

## ai.env
```env
# Service
NODE_ENV=production
PORT=3002

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=

# OpenAI / AI Provider
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4-mini
OPENAI_MAX_TOKENS=150
OPENAI_TEMPERATURE=0.7

# Alternative: Use other AI providers
# AI_PROVIDER=openai|anthropic|cohere
# ANTHROPIC_API_KEY=
# COHERE_API_KEY=

# Queue
QUEUE_NAME=ai:pending
QUEUE_CONCURRENCY=5

# Logging
LOG_LEVEL=info
```

---

## db.env
```env
# PostgreSQL
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=autoreply

# Performance
POSTGRES_MAX_CONNECTIONS=100
POSTGRES_SHARED_BUFFERS=256MB
```

---

## Production Checklist

### Security
- [ ] Change all default passwords
- [ ] Generate strong JWT secret (32+ characters)
- [ ] Use environment-specific secrets
- [ ] Never commit .env files to git
- [ ] Rotate secrets regularly

### Facebook
- [ ] Create Facebook App
- [ ] Get App ID and Secret
- [ ] Configure OAuth redirect URI
- [ ] Set webhook verify token
- [ ] Request required permissions
- [ ] Complete App Review

### AI Service
- [ ] Get OpenAI API key
- [ ] Set usage limits
- [ ] Configure fallback options
- [ ] Test AI responses

### Database
- [ ] Use strong database password
- [ ] Configure backups
- [ ] Set connection limits
- [ ] Enable SSL if needed

### Monitoring
- [ ] Set up logging
- [ ] Configure alerts
- [ ] Monitor API usage
- [ ] Track error rates

---

## Development vs Production

### Development
```env
NODE_ENV=development
API_URL=http://localhost:3000
DB_HOST=localhost
LOG_LEVEL=debug
```

### Production
```env
NODE_ENV=production
API_URL=https://yourdomain.com/api
DB_HOST=postgres
LOG_LEVEL=info
```

---

## Environment File Templates

Create these files in `/env/` directory:
- `backend.env`
- `frontend.env`
- `ai.env`
- `db.env`

Copy from examples and fill in your values.

**Important**: Add `/env/*.env` to `.gitignore`
