import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

import { CLOCK, SystemClock } from '../../core/common/clock';
import { WALLET_PROVIDER } from './application/ports/wallet-provider.port';
import { WALLET_REPOSITORY } from './application/ports/wallet.repository.port';
import { WalletService } from './application/wallet.service';
import { BlockradarProvider } from './infrastructure/blockradar.provider';
import { WalletPrismaRepository } from './infrastructure/wallet.prisma.repository';

/**
 * Wallets feature module. Wires the Blockradar WaaS adapter, the Prisma
 * repository, and the WalletService (get-or-provision + balance read).
 *
 * - PrismaModule is global — PrismaService is already in the DI container.
 * - ConfigModule is global — ConfigService is already available.
 * - HttpModule is imported here for the Blockradar HTTP client.
 */
@Module({
  imports: [HttpModule],
  providers: [
    WalletService,
    { provide: WALLET_PROVIDER, useClass: BlockradarProvider },
    { provide: WALLET_REPOSITORY, useClass: WalletPrismaRepository },
    { provide: CLOCK, useClass: SystemClock },
  ],
  exports: [WalletService, WALLET_PROVIDER, WALLET_REPOSITORY],
})
export class WalletsModule {}
