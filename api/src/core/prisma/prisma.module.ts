import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

/**
 * Global so any infrastructure repository can inject PrismaService without
 * re-importing this module. PrismaService is the single DB access point
 * (CLAUDE.md §3.2); only infrastructure-layer repositories may inject it.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
