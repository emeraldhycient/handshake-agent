/**
 * AuthModule (task 4.3, CLAUDE.md §4.1).
 *
 * Provides PinService bound to PinPrismaRepository via the PIN_REPOSITORY
 * injection token, and the SystemClock via CLOCK. Export PinService so the
 * engine module can import AuthModule and inject PinService.
 *
 * Not global — the engine module (task 4.5) imports AuthModule explicitly.
 */

import { Module } from '@nestjs/common';

import { SystemClock, CLOCK } from '../common/clock';
import { PinPrismaRepository } from './infrastructure/pin.prisma.repository';
import { PIN_REPOSITORY } from './ports/pin.repository.port';
import { PinService } from './pin.service';

@Module({
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: PIN_REPOSITORY, useClass: PinPrismaRepository },
    PinService,
  ],
  exports: [PinService],
})
export class AuthModule {}
