/**
 * AuthModule (task 4.3, CLAUDE.md §4.1).
 *
 * Provides PinService bound to PinPrismaRepository via the PIN_REPOSITORY
 * injection token, SessionService bound to SessionPrismaRepository via the
 * SESSION_REPOSITORY injection token, and the SystemClock via CLOCK.
 *
 * Export PinService and SessionService so the engine module can import
 * AuthModule and inject both.
 *
 * Not global — the engine module (task 4.5) imports AuthModule explicitly.
 */

import { Module } from '@nestjs/common';

import { SystemClock, CLOCK } from '../common/clock';
import { PinPrismaRepository } from './infrastructure/pin.prisma.repository';
import { SessionPrismaRepository } from './infrastructure/session.prisma.repository';
import { PIN_REPOSITORY } from './ports/pin.repository.port';
import { SESSION_REPOSITORY } from './ports/session.repository.port';
import { PinService } from './pin.service';
import { SessionService } from './session.service';

@Module({
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: PIN_REPOSITORY, useClass: PinPrismaRepository },
    PinService,
    { provide: SESSION_REPOSITORY, useClass: SessionPrismaRepository },
    SessionService,
  ],
  exports: [PinService, SessionService],
})
export class AuthModule {}
