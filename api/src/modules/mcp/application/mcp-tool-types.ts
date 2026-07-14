/**
 * Shared types for the MCP tool surface (Wave C — go-live program).
 *
 * The MCP server exposes READ + PROPOSE tools only (§3.1/§3.5): no tool on
 * this surface may execute or authorize a transaction, and a PIN is NEVER
 * accepted here — execution stays on the web/WhatsApp surfaces behind
 * PIN + step-up.
 *
 * Application layer: depends only on other modules' application services,
 * ports, and the core catalog — never infrastructure or Prisma (§3.2/§4.1).
 */

import type { z, ZodTypeAny } from 'zod';

import type { PatScope } from '@handshake-agent/contracts';

import type { AssetRegistry } from '../../../core/catalog/asset-registry';
import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { ProfileService } from '../../identity/application/profile.service';
import type { IIdentityRepository } from '../../identity/application/ports/identity.repository.port';
import type { BalanceService } from '../../balances/application/balance.service';
import type { WalletService } from '../../wallets/application/wallet.service';
import type { BeneficiaryService } from '../../beneficiaries/application/beneficiary.service';
import type { TransactionHistoryService } from '../../transactions/application/transaction-history.service';
import type { QuotesService } from '../../quotes/application/quotes.service';
import type { RatesService } from '../../quotes/application/rates.service';
import type { WebChatService } from '../../chat/application/web-chat.service';
import type { ITransactionRepository } from '../../transactions/application/ports/transaction.repository.port';
import type { ISettlementRepository } from '../../transactions/application/ports/settlement.repository.port';
import type { IProposalRepository } from '../../transactions/application/ports/proposal.repository.port';

/** The authenticated PAT identity every tool handler closes over. */
export interface McpPrincipal {
  userId: string;
  scopes: string[];
}

/**
 * One registered MCP tool. `scope` gates BOTH visibility (tools/list) and
 * invocation (tools/call) — enforced centrally in the dispatch layer.
 */
export interface McpToolDefinition {
  name: string;
  description: string;
  scope: PatScope;
  /** Zod schema parsed at the trust boundary before the handler runs. */
  inputSchema: ZodTypeAny;
  handler: (args: unknown, principal: McpPrincipal) => Promise<unknown>;
}

/**
 * Narrowed views of the cross-module application services the tools call.
 * `Pick` keeps the dependency surface explicit and the unit-test fakes small.
 */
export interface McpToolDeps {
  profile: Pick<ProfileService, 'getProfile'>;
  balances: Pick<BalanceService, 'getBalances'>;
  wallets: Pick<WalletService, 'getOrProvisionNetworkWallet'>;
  beneficiaries: Pick<BeneficiaryService, 'listForUser'>;
  history: Pick<TransactionHistoryService, 'query' | 'queryPage'>;
  quotes: Pick<QuotesService, 'quoteBuy' | 'quoteSell'>;
  rates: Pick<RatesService, 'getEffectiveRate' | 'listEffectiveRates'>;
  chat: Pick<WebChatService, 'handleMessage'>;
  identityRepo: Pick<IIdentityRepository, 'loadUser'>;
  transactionRepo: Pick<ITransactionRepository, 'findById'>;
  settlementRepo: Pick<ISettlementRepository, 'findReceiptNumber'>;
  proposalRepo: Pick<IProposalRepository, 'listPendingForUser'>;
  registry: Pick<
    AssetRegistry,
    'asset' | 'network' | 'defaultNetworkFor' | 'publicView'
  >;
  /** Layered config — capability→min-tier gating for KYC-gated read tools. */
  config: Pick<EffectiveConfigService, 'get'>;
}

/**
 * Returned alongside every proposal this surface produces or lists: the MCP
 * client must route the user to the web app — execution is impossible here.
 */
export const PROPOSAL_INSTRUCTION =
  'Review and confirm this in the Handshake web app — it cannot be executed from this integration.';

/**
 * Typed tool builder: infers the handler's argument type from the zod schema
 * so each tool body stays fully typed without inline casts.
 */
export function defineTool<S extends ZodTypeAny>(definition: {
  name: string;
  description: string;
  scope: PatScope;
  inputSchema: S;
  handler: (args: z.output<S>, principal: McpPrincipal) => Promise<unknown>;
}): McpToolDefinition {
  // The dispatch layer always passes `inputSchema.parse` output to `handler`,
  // so the schema-typed parameter matches at runtime.
  return definition;
}
