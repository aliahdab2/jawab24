import { vi } from 'vitest';

// Mock the database module BEFORE any services are imported
vi.mock('../src/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
        limit: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'mock-id' }]),
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'mock-id' }]),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'mock-id' }]),
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
    transaction: vi.fn(async (fn: Function) => fn({
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'mock-id' }]),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'mock-id' }]),
        }),
      }),
    })),
    query: {},
  },
  client: {
    end: vi.fn(),
  },
}));

// Mock BullMQ customer notification queue to avoid Redis config dependency in unit tests
vi.mock('../src/lib/customerNotificationQueue', () => ({
  CUSTOMER_NOTIFICATION_QUEUE: 'customer-notifications',
  customerNotificationQueue: {
    add: vi.fn().mockResolvedValue({ id: 'mock-job-id' }),
    close: vi.fn().mockResolvedValue(undefined),
  },
}));

// Set test environment variables.
// Unit tests never open a connection — every DB access is mocked — so this only
// has to satisfy the modules that read DATABASE_URL at import time. It is
// deliberately NOT a real database: it used to read
// `postgres://…@localhost:5432/autoreply_test`, which named the integration-test
// database on the *dev* Postgres port, so a unit test that accidentally connected
// would have reached a real server. Anything that tries to connect now fails loudly.
process.env.DATABASE_URL = 'postgres://unit-tests:unit-tests@127.0.0.1:1/unit_tests_never_connect';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.NODE_ENV = 'test';

// Demo mode is a PRODUCTION code path, not a test one: `pages.sync`,
// `ai.*` and `subscriptions` all branch on `config.demo.enabled` into
// `authService.getUserById()`, which no route test mocks. Left to the ambient
// environment this makes unit tests depend on whether the checkout happens to
// have a `backend/.env` with `DEMO_MODE_ENABLED=true` — a worktree (no .env)
// went green while the main checkout went red on the same commit, which reads
// as a flake and is not one. Pin it off so the flag can never leak in.
process.env.DEMO_MODE_ENABLED = 'false';








