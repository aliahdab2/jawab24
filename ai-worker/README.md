# Jawab24 AI Worker

AI worker service for generating automated replies - part of the monorepo.

## Tech Stack

- **Runtime:** Node.js 18
- **Language:** TypeScript
- **AI:** OpenAI GPT-4o-mini
- **Queue:** Redis

## Structure

```
ai-worker/
├── src/
│   ├── index.ts       # Main entry point
│   ├── config.ts      # Configuration
│   └── services/
│       ├── openai.ts  # LLM orchestrator (API call, token counting, buildMessages)
│       └── reply/     # Prompt building, post-reply validation, shared helpers, types
├── test/              # Test files
└── Dockerfile         # Production container
```

## How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Backend   │ ──► │    Redis    │ ──► │  AI Worker  │
│  (Job Push) │     │   (Queue)   │     │  (Process)  │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                                               ▼
                                        ┌─────────────┐
                                        │   OpenAI    │
                                        │  GPT-4o-mini│
                                        └─────────────┘
```

1. Backend receives a comment/message that needs AI reply
2. Backend pushes a job to Redis queue
3. AI Worker picks up the job
4. AI Worker calls OpenAI with:
   - The message content
   - Page knowledge base (business info)
   - Conversation history (for context)
5. AI Worker returns the generated reply via Redis
6. Backend posts the reply to Facebook

## Development

```bash
# From project root (recommended)
npm install                                # Install all dependencies
npm run build --workspace=@jawab24/shared  # Build shared types first
npm run dev --workspace=jawab24-ai-worker  # Start dev server

# Or from this directory
npm run dev
```

## AI Generation

The AI generates replies based on:

1. **Message Content** - The actual comment/message text
2. **Knowledge Base** - Business info set per page (products, prices, policies)
3. **Language Detection** - Replies in the same language as the message
4. **Syrian Dialect** - Special support for Syrian Arabic expressions

Example system prompt:
```
You are a customer service assistant for a Syrian business.
Respond in Syrian Arabic dialect (اللهجة الشامية).
Keep responses short (1-2 sentences) and friendly.

Business Info:
{knowledgeBase}
```

## Production

```bash
npm run build
npm start
```

## Environment Variables

Required in `env/ai.env`:

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENAI_MODEL` | Model to use (default: gpt-4o-mini) |
| `OPENAI_MAX_TOKENS` | Max tokens per response (default: 500) |
| `OPENAI_TEMPERATURE` | Response creativity (default: 0.7) |
| `REDIS_URL` | Redis connection string |
| `PORT` | Service port (default: 3002) |
| `FALLBACK_ENABLED` | Enable fallback responses (default: true) |

## Docker

```bash
# Build image (from project root)
docker build -t jawab24-ai-worker -f ai-worker/Dockerfile .

# Run container
docker run -p 3002:3002 --env-file ../env/ai.env jawab24-ai-worker
```

## Testing

```bash
npm test
```

## Fallback Behavior

If OpenAI is unavailable, the worker returns a fallback message:
- Arabic: "شكراً لتواصلك معنا! سنرد عليك قريباً."
- English: "Thank you for reaching out! We'll respond shortly."
