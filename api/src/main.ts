import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
// cookie-parser is a CommonJS `export =` module; the api tsconfig has no
// esModuleInterop, so a default import compiles to `.default` (undefined at
// runtime). Import it as a namespace (same pattern as `qrcode`).
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { buildAllowedOrigins } from './core/common/cors-options';

async function bootstrap() {
  // rawBody: true — Express captures req.rawBody (Buffer) before JSON parsing.
  // Required by WhatsAppSignatureGuard to HMAC-verify X-Hub-Signature-256
  // against the exact bytes Meta signed (re-serialised JSON breaks the check).
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  app.useLogger(app.get(Logger)); // structured logging via pino
  const config = app.get(ConfigService);
  // Parse the Cookie header so req.cookies is populated (Wave H): the web refresh
  // token (ha_refresh) and admin session JWT (ha_admin_session) ride in HttpOnly
  // cookies. The access token / PAT Bearer flows are unaffected.
  app.use(cookieParser());
  // The browser must send the HttpOnly auth cookies, so credentials:true — which
  // forbids a wildcard origin. Reflect only the exact web + web-admin origins.
  // Authorization stays allowed for the access token + PAT bearer flows.
  app.enableCors({
    origin: buildAllowedOrigins(config),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  });
  app.use(helmet()); // security headers
  app.enableShutdownHooks(); // graceful shutdown (Prisma $disconnect, etc.)
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
