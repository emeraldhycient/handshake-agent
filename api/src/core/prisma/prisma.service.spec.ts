import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  const original = process.env.DATABASE_URL;

  beforeAll(() => {
    // The pg driver adapter reads the connection string at construction; it does
    // not connect until $connect(), so a dummy URL is enough for this unit test.
    process.env.DATABASE_URL =
      'postgresql://postgres:postgres@localhost:5544/handshake_agent?schema=public';
  });

  afterAll(() => {
    process.env.DATABASE_URL = original;
  });

  it('wraps a Prisma client and exposes connect/disconnect lifecycle hooks', () => {
    const service = new PrismaService();

    // Inherited Prisma client surface (proves it extends the generated client).
    expect(typeof service.$connect).toBe('function');
    expect(typeof service.$disconnect).toBe('function');
    expect(typeof service.$transaction).toBe('function');
    // A model delegate exists without connecting (driver-adapter client).
    expect(service.user).toBeDefined();
    // Nest lifecycle hooks.
    expect(typeof service.onModuleInit).toBe('function');
    expect(typeof service.onModuleDestroy).toBe('function');
  });
});
