import { Global, Module } from '@nestjs/common';

import { AuditService } from './application/audit.service';
import { AUDIT_LOG_REPOSITORY } from './application/ports/audit-log.repository.port';
import { AuditLogPrismaRepository } from './infrastructure/audit-log.prisma.repository';

// Global: the immutable audit log is cross-cutting — admin command services and
// the engine alike record through AuditService without re-importing this module.
@Global()
@Module({
  providers: [
    AuditService,
    { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogPrismaRepository },
  ],
  exports: [AuditService, AUDIT_LOG_REPOSITORY],
})
export class AuditModule {}
