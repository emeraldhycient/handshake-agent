import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import type { Env } from '../env.schema';
import { EffectiveConfigService } from '../application/effective-config.service';

export const CONFIG_INVALIDATE_CHANNEL = 'config:invalidate';

function makeClient(url: string): Redis {
  // lazyConnect + a swallowing error handler so a missing/flaky Redis never
  // crashes the app — config still resolves from the in-memory base snapshot.
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
  });
  client.on('error', () => undefined);
  return client;
}

/** Publishes a cross-instance "config changed" signal after an admin write. */
@Injectable()
export class ConfigInvalidationPublisher implements OnModuleDestroy {
  private readonly logger = new Logger(ConfigInvalidationPublisher.name);
  private readonly client: Redis;

  constructor(config: ConfigService<Env, true>) {
    this.client = makeClient(config.get('REDIS_URL', { infer: true }));
  }

  async publish(): Promise<void> {
    try {
      await this.client.publish(CONFIG_INVALIDATE_CHANNEL, '1');
    } catch (err) {
      // Best-effort: the writer already refreshed in-process; other instances
      // will catch up on their next boot/refresh if this notify failed.
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'config invalidation publish failed (non-fatal)',
      );
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}

/** Subscribes to the invalidation channel and rebuilds the local snapshot. */
@Injectable()
export class ConfigInvalidationSubscriber
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ConfigInvalidationSubscriber.name);
  private readonly client: Redis;

  constructor(
    config: ConfigService<Env, true>,
    private readonly effectiveConfig: EffectiveConfigService,
  ) {
    this.client = makeClient(config.get('REDIS_URL', { infer: true }));
  }

  async onModuleInit(): Promise<void> {
    this.client.on('message', (channel) => {
      if (channel !== CONFIG_INVALIDATE_CHANNEL) return;
      void this.effectiveConfig
        .refresh()
        .catch((err: unknown) =>
          this.logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'config refresh after invalidation failed',
          ),
        );
    });
    try {
      await this.client.subscribe(CONFIG_INVALIDATE_CHANNEL);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'config invalidation subscribe failed — single-instance refresh still applies',
      );
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
