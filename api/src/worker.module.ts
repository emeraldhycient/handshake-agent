/**
 * WorkerModule — CONSUMER side of the BullMQ job-queue capability (BQ-1).
 *
 * Loaded ONLY by worker.ts (the BullMQ worker process).  It must NEVER be
 * imported by AppModule or any module reachable from AppModule — that would
 * re-introduce the producer/consumer merge we are splitting apart.
 *
 * Architecture:
 *   - Imports AppModule so all application services, config, and the queue
 *     registrations from JobsModule are available to the processors.
 *   - Declares @Processor classes (EchoProcessor + future real processors).
 *     @Processor opens real ioredis Worker connections — they must live here,
 *     not in JobsModule/AppModule, so the API process (main.ts) never starts
 *     Workers or attempts a Redis connection when Redis is absent.
 *
 * Adding a new processor (BQ-2 +):
 *   1. Create `YourProcessor` in the appropriate module's `infrastructure/`.
 *   2. Import it here and add it to the `providers` array.
 *   3. Do NOT add it to JobsModule — that is the producer side only.
 *
 * Dependency constraint:
 *   WorkerModule → AppModule is fine (consumer needs app context).
 *   AppModule → WorkerModule is FORBIDDEN (would re-introduce the bug).
 *   dependency-cruiser guards the reverse direction.
 */
import { Module } from '@nestjs/common';

import { AppModule } from './app.module';
import { EchoProcessor } from './core/jobs/infrastructure/echo.processor';

@Module({
  imports: [AppModule],
  providers: [EchoProcessor],
})
export class WorkerModule {}
