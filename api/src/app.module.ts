import { Module } from '@nestjs/common';
import { APP_PIPE, APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';

import configuration from './core/config/configuration';
import { validateEnv } from './core/config/env.schema';
import { buildPinoHttpOptions } from './core/logging/pino-options';
import { PrismaModule } from './core/prisma/prisma.module';
import { AuditModule } from './core/audit/audit.module';
import { EffectiveConfigModule } from './core/config/effective-config.module';
import { CatalogModule } from './core/catalog/catalog.module';
import { AgentModule } from './modules/agent/agent.module';
import { IdentityModule } from './modules/identity/identity.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { FlutterwaveWebhookModule } from './modules/treasury/flutterwave-webhook.module';
import { BlockradarWebhookModule } from './modules/wallets/blockradar-webhook.module';
import { SumsubWebhookModule } from './modules/identity/sumsub-webhook.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { WebhookProcessingModule } from './modules/webhooks/webhook-processing.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { AdminModule } from './modules/admin/admin.module';
import { PublicConfigModule } from './modules/config/config.module';
import { JobsModule } from './core/jobs/jobs.module';
import { WebAuthModule } from './modules/auth/auth.module';
import { ChatModule } from './modules/chat/chat.module';
import { McpModule } from './modules/mcp/mcp.module';
import { DomainExceptionFilter } from './core/common/domain-exception.filter';
import { EnvAwareThrottlerGuard } from './core/common/env-aware-throttler.guard';
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
    // pinoHttp options (incl. `redact` for sensitive headers, H1) live in a pure
    // builder so the redaction contract is unit-testable independent of DI.
    LoggerModule.forRoot({
      pinoHttp: buildPinoHttpOptions(process.env.NODE_ENV),
    }),
    PrismaModule,
    AuditModule,
    EffectiveConfigModule,
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
    SumsubWebhookModule,
    // Durable inbound-webhook queue (Track A): WebhooksModule = producer
    // (ingestion + persistence + metrics + sweeper); WebhookProcessingModule =
    // the handler registry + lifecycle service (NO @Processor here — the BullMQ
    // consumer lives in the worker so the API never opens a Worker connection).
    WebhooksModule,
    WebhookProcessingModule,
    ComplianceModule,
    // JobsModule: BullMQ / Redis capability (BQ-1). Uses lazyConnect so the app
    // boots without a live Redis; existing e2e suites never enqueue, so they pass.
    JobsModule,
    AdminModule,
    PublicConfigModule,
    ChatModule,
    // MCP surface (Wave C): PAT-authenticated read+propose tools at POST /mcp.
    McpModule,
    NotificationsModule,
  ],
  providers: [
    // Global Zod validation: every request DTO is checked against its contract schema.
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    // Global error mapping: domain errors → correct HTTP status + clean message,
    // never an opaque 500 or leaked internal detail (I1/I2).
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    // Global rate limiting (M1): EVERY endpoint is throttled by the configured
    // named throttlers — no longer only the 3 controllers that opted in. The
    // subclass no-ops under NODE_ENV=test so e2e (single-IP supertest) isn't
    // 429ed; prod/dev stay strict.
    { provide: APP_GUARD, useClass: EnvAwareThrottlerGuard },
  ],
})
export class AppModule {}
