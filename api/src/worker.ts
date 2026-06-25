/**
 * BullMQ worker entry point (BQ-1).
 *
 * Boots AppModule via NestFactory.createApplicationContext (no HTTP server).
 * All @Processor() providers (including EchoProcessor) register their worker
 * listeners during module initialisation.
 *
 * Shutdown: SIGTERM closes the Nest application context gracefully, which
 * allows BullMQ workers to drain in-flight jobs before exiting.
 *
 * Start: `pnpm --filter @handshake-agent/api start:worker`
 *        `pnpm --filter @handshake-agent/api start:worker:dev`
 *
 * Architecture note:
 *   This is intentionally a thin bootstrap wrapper — no business logic lives here.
 *   The same AppModule is used so all Nest providers, the typed config, and the
 *   BullMQ adapter resolve normally. When the worker is extracted to a standalone
 *   service, this file moves with it and AppModule is slimmed to worker-only
 *   modules (a binding swap, no logic rewrite — see root CLAUDE.md §6).
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
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
