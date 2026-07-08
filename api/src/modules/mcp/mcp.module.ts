/**
 * McpModule — composition root for the machine/MCP surface (Wave C).
 *
 * Pure consumer module: it binds NOTHING of its own beyond the tools service
 * and controller — every capability is an exported application service (or
 * port token) of an existing feature module, reached in-process. There is no
 * infrastructure layer here and no Prisma anywhere under modules/mcp (§3.2).
 *
 * Auth: WebAuthModule exports PatAuthGuard + PAT_REPOSITORY — the ONLY
 * credential accepted on /mcp is a personal access token (§3.5). CatalogModule
 * is @Global, so AssetRegistry resolves without an explicit import.
 */

import { Module } from '@nestjs/common';

import { WebAuthModule } from '../auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { BalancesModule } from '../balances/balances.module';
import { WalletsModule } from '../wallets/wallets.module';
import { BeneficiariesModule } from '../beneficiaries/beneficiaries.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { QuotesModule } from '../quotes/quotes.module';
import { ChatModule } from '../chat/chat.module';

import { McpToolsService } from './application/mcp-tools.service';
import { McpController } from './presentation/mcp.controller';

@Module({
  imports: [
    WebAuthModule, // PatAuthGuard + PAT_REPOSITORY (PAT-only auth, §3.5)
    IdentityModule, // ProfileService + IDENTITY_REPOSITORY (KYC gate reads)
    BalancesModule, // BalanceService
    WalletsModule, // WalletService (deposit-address get-or-provision)
    BeneficiariesModule, // BeneficiaryService (masked list)
    TransactionsModule, // history service + transaction/settlement/proposal ports
    QuotesModule, // QuotesService (read-only quoting)
    ChatModule, // WebChatService (the propose-only agent turn)
  ],
  controllers: [McpController],
  providers: [McpToolsService],
})
export class McpModule {}
