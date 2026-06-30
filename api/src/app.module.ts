import { Module } from '@nestjs/common';
import { APP_PIPE, APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';

import configuration from './core/config/configuration';
import { validateEnv } from './core/config/env.schema';
import { PrismaModule } from './core/prisma/prisma.module';
import { CatalogModule } from './core/catalog/catalog.module';
import { AgentModule } from './modules/agent/agent.module';
import { IdentityModule } from './modules/identity/identity.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { FlutterwaveWebhookModule } from './modules/treasury/flutterwave-webhook.module';
import { BlockradarWebhookModule } from './modules/wallets/blockradar-webhook.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { AdminModule } from './modules/admin/admin.module';
import { PublicConfigModule } from './modules/config/config.module';
import { JobsModule } from './core/jobs/jobs.module';
import { WebAuthModule } from './modules/auth/auth.module';
import { ChatModule } from './modules/chat/chat.module';
import { DomainExceptionFilter } from './core/common/domain-exception.filter';
import { NotificationsModule } from './modules/notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: (raw: Record<string, unknown>) => validateEnv(raw),
      // Under test, do NOT load the dev `.env`: it carries live secrets and
      // real provider modes (e.g. NAME_ENQUIRY_MOCK_MODE=false for live testing)
      // that would leak into e2e runs and make non-overridden providers hit real
      // APIs. Tests set their own env explicitly; everything else falls back to
      // the mock-by-default schema values (see env.schema). Dev/prod still load .env.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),
    // ThrottlerModule registered globally so ThrottlerGuard resolves in any module
    // (e.g. KycController in IdentityModule). v6-style: named throttlers, ttl in ms.
    // 'auth' throttler: tighter window for sensitive auth endpoints (signup,
    // verify-email, login/request, login/verify). Limit=30 comfortably exceeds
    // the auth e2e's ~12 auth-route calls per suite run (one IP, one instance).
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 60 },
      { name: 'auth', ttl: 60_000, limit: 30 },
    ]),
    // ScheduleModule enables @Cron / @Interval decorators in provider classes.
    // Registered globally so any module's service can use @Cron without re-importing.
    ScheduleModule.forRoot(),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty' }
            : undefined,
      },
    }),
    PrismaModule,
    CatalogModule,
    AgentModule,
    IdentityModule,
    WebAuthModule,
    QuotesModule,
    TransactionsModule,
    ConversationsModule,
    WhatsAppModule,
    FlutterwaveWebhookModule,
    BlockradarWebhookModule,
    ComplianceModule,
    // JobsModule: BullMQ / Redis capability (BQ-1). Uses lazyConnect so the app
    // boots without a live Redis; existing e2e suites never enqueue, so they pass.
    JobsModule,
    AdminModule,
    PublicConfigModule,
    ChatModule,
    NotificationsModule,
  ],
  providers: [
    // Global Zod validation: every request DTO is checked against its contract schema.
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    // Global error mapping: domain errors → correct HTTP status + clean message,
    // never an opaque 500 or leaked internal detail (I1/I2).
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
  ],
})
export class AppModule {}
