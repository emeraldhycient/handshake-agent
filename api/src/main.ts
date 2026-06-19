import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger)); // structured logging via pino
  app.use(helmet()); // security headers
  app.enableShutdownHooks(); // graceful shutdown (Prisma $disconnect, etc.)
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
