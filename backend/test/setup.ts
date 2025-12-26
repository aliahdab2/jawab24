import { vi } from 'vitest';

// Mock the database module BEFORE any services are imported
vi.mock('../src/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
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
    query: {},
  },
  client: {
    end: vi.fn(),
  },
}));

// Set test environment variables
process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/autoreply_test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.NODE_ENV = 'test';








