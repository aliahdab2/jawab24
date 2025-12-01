# Jawab24 AI Worker

AI worker service for generating automated replies - part of the monorepo.

## Structure

```
/src
  /services    - AI generation logic
  /queue       - Redis/BullMQ job processing
  /utils       - Helper functions
```

## Development

```bash
# From project root (recommended)
npm install                                # Install all dependencies
npm run build --workspace=@jawab24/shared  # Build shared types first
npm run dev --workspace=jawab24-ai-worker  # Start dev server

# Or from this directory
npm run dev
```

## How It Works

1. Backend pushes jobs to Redis queue
2. AI Worker picks up jobs
3. Generates reply using OpenAI (GPT-4o-mini)
4. Returns result via Redis

## Production

```bash
npm run build
npm start
```

## Environment Variables

Required in `env/ai.env`:
- `OPENAI_API_KEY` - OpenAI API key
- `REDIS_URL` - Redis connection URL
