import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type {
  WalletBalancesResponse,
  DepositAddressResponse,
} from '@handshake-agent/contracts';
import {
  WalletBalancesResponseSchema,
  DepositAddressResponseSchema,
} from '@handshake-agent/contracts';
import {
  JwtAuthGuard,
  type AuthenticatedUser,
} from '../../auth/presentation/jwt-auth.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import { WalletBalanceService } from '../application/wallet-balance.service';

@Controller('wallets')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly balances: WalletBalanceService) {}

  @Get('balances')
  async getBalances(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WalletBalancesResponse> {
    return WalletBalancesResponseSchema.parse(
      await this.balances.getBalances(user.userId),
    );
  }

  @Get('deposit-address')
  async getDepositAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Query('network') network?: string,
  ): Promise<DepositAddressResponse> {
    return DepositAddressResponseSchema.parse(
      await this.balances.getDepositAddress(user.userId, network),
    );
  }
}
