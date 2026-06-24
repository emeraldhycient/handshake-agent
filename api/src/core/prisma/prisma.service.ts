import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

// The generated client is the ONLY sanctioned door to the database (CLAUDE.md
// §3.2). It is imported here (core) and in infrastructure repositories only —
// never from application / domain / presentation / agent (dependency-cruiser).
// Prisma 7 uses a driver adapter (no Rust query engine); pass @prisma/adapter-pg.
import { PrismaClient } from '../../../generated/prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
