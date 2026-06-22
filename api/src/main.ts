import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true — Express captures req.rawBody (Buffer) before JSON parsing.
  // Required by WhatsAppSignatureGuard to HMAC-verify X-Hub-Signature-256
  // against the exact bytes Meta signed (re-serialised JSON breaks the check).
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  app.useLogger(app.get(Logger)); // structured logging via pino
  app.use(helmet()); // security headers
  app.enableShutdownHooks(); // graceful shutdown (Prisma $disconnect, etc.)
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
