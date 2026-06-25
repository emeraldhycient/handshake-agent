/**
 * BullMQ worker entry point (BQ-1).
 *
 * Boots WorkerModule via NestFactory.createApplicationContext (no HTTP server).
 * WorkerModule imports AppModule (full app context: config, services, queues)
 * and additionally declares the @Processor providers (EchoProcessor + future
 * real processors).  This is the clean producer/consumer split:
 *
 *   API process  → main.ts       → AppModule    (NO Workers, no Redis on boot)
 *   Worker process → worker.ts   → WorkerModule (AppModule + @Processor classes)
 *
 * The split means the API process never opens BullMQ Worker ioredis connections,
 * so e2e suites that run without Redis stay clean of ECONNREFUSED errors.
 *
 * Shutdown: SIGTERM closes the Nest application context gracefully, which
 * allows BullMQ workers to drain in-flight jobs before exiting.
 *
 * Start: `pnpm --filter @handshake-agent/api start:worker`
 *        `pnpm --filter @handshake-agent/api start:worker:dev`
 *
 * Architecture note:
 *   This is intentionally a thin bootstrap wrapper — no business logic lives here.
 *   When the worker is extracted to a standalone service, this file moves with it
 *   (a binding swap, no logic rewrite — see root CLAUDE.md §6).
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    // Suppress the default Nest HTTP server banner — this is a worker, not a server.
    logger: ['log', 'warn', 'error', 'debug'],
  });

  const logger = new Logger('Worker');
  logger.log('BullMQ worker started — listening for jobs');

  // Graceful shutdown on SIGTERM (e.g. Docker stop, k8s eviction).
  process.on('SIGTERM', () => {
    logger.log('SIGTERM received — shutting down worker gracefully');
    void app.close().then(() => {
      logger.log('Worker shutdown complete');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    logger.log('SIGINT received — shutting down worker gracefully');
    void app.close().then(() => {
      logger.log('Worker shutdown complete');
      process.exit(0);
    });
  });
}

void bootstrap();
