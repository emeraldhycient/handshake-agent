/**
 * AuthModule (task 4.3, CLAUDE.md §4.1).
 *
 * Provides PinService bound to PinPrismaRepository via the PIN_REPOSITORY
 * injection token, SessionService bound to SessionPrismaRepository via the
 * SESSION_REPOSITORY injection token, and the SystemClock via CLOCK.
 *
 * Also provides StepUpService — the shared step-up-on-sensitive-action chain
 * (A1) that composes PinService + SessionService — so the web + WhatsApp
 * beneficiary surfaces run one canonical implementation instead of duplicating it.
 *
 * Export PinService, SessionService, and StepUpService so the engine + the
 * beneficiary surfaces can import AuthModule and inject them.
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
import { StepUpService } from './step-up.service';

@Module({
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: PIN_REPOSITORY, useClass: PinPrismaRepository },
    PinService,
    { provide: SESSION_REPOSITORY, useClass: SessionPrismaRepository },
    SessionService,
    StepUpService,
  ],
  exports: [PinService, SessionService, StepUpService],
})
export class AuthModule {}
