import { execSync } from 'node:child_process';
import { join } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

import { PrismaClient } from '../../generated/prisma/client';

const API_ROOT = join(__dirname, '../..');

/**
 * Starts a fresh PostgreSQL container (postgres:16-alpine), applies the
 * committed migrations via `prisma migrate deploy`, and returns a connected
 * PrismaClient along with a `stop()` teardown function.
 *
 * Usage:
 *   const { prisma, stop } = await startTestPostgres();
 *   afterAll(stop);
 */
export async function startTestPostgres(): Promise<{
  prisma: PrismaClient;
  stop: () => Promise<void>;
}> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const url = container.getConnectionUri();

  // Apply migrations against the test container. The DATABASE_URL env var
  // overrides any value that prisma.config.ts might load from .env.
  execSync('node_modules/.bin/prisma migrate deploy', {
    cwd: API_ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
  await prisma.$connect();

  const stop = async (): Promise<void> => {
    await prisma.$disconnect();
    await container.stop();
  };

  return { prisma, stop };
}
