import { Module } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: (raw: Record<string, unknown>) => validateEnv(raw),
    }),
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
    QuotesModule,
    TransactionsModule,
    ConversationsModule,
    WhatsAppModule,
    FlutterwaveWebhookModule,
  ],
  // Global Zod validation: every request DTO is checked against its contract schema.
  providers: [{ provide: APP_PIPE, useClass: ZodValidationPipe }],
})
export class AppModule {}
