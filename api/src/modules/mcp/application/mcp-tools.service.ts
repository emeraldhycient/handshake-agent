/**
 * McpToolsService — builds a per-request MCP Server for one authenticated PAT
 * principal (Wave C).
 *
 * The tool list is assembled ONCE from the injected application services of
 * the other feature modules (cross-module application→application, the
 * established pattern); each request gets a fresh low-level `Server` whose
 * list/call handlers close over the request's principal, so scope filtering
 * and per-user data isolation are structural.
 *
 * §3.1/§3.5: the registry contains READ tools + one propose tool. No tool
 * executes or authorizes a transaction; ExecutionService/DirectiveService are
 * not injected here at all — this service CANNOT move money by construction.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { ProfileService } from '../../identity/application/profile.service';
import {
  IDENTITY_REPOSITORY,
  type IIdentityRepository,
} from '../../identity/application/ports/identity.repository.port';
import { BalanceService } from '../../balances/application/balance.service';
import { WalletService } from '../../wallets/application/wallet.service';
import { BeneficiaryService } from '../../beneficiaries/application/beneficiary.service';
import { TransactionHistoryService } from '../../transactions/application/transaction-history.service';
import { QuotesService } from '../../quotes/application/quotes.service';
import { RatesService } from '../../quotes/application/rates.service';
import { WebChatService } from '../../chat/application/web-chat.service';
import {
  TRANSACTION_REPOSITORY,
  type ITransactionRepository,
} from '../../transactions/application/ports/transaction.repository.port';
import {
  SETTLEMENT_REPOSITORY,
  type ISettlementRepository,
} from '../../transactions/application/ports/settlement.repository.port';
import {
  PROPOSAL_REPOSITORY,
  type IProposalRepository,
} from '../../transactions/application/ports/proposal.repository.port';

import { buildReadTools } from './mcp-read-tools';
import { buildTransactionTools } from './mcp-transaction-tools';
import { buildChatTools } from './mcp-chat-tools';
import { dispatchToolCall, listToolsFor } from './mcp-tool-dispatch';
import type {
  McpPrincipal,
  McpToolDefinition,
  McpToolDeps,
} from './mcp-tool-types';

const MCP_SERVER_INFO = { name: 'handshake-agent', version: '1.0.0' };

const MCP_SERVER_INSTRUCTIONS =
  'Handshake Agent account access: read balances, transactions, quotes, and ' +
  'saved beneficiaries, and send chat messages that can end at a transaction ' +
  'PROPOSAL. Proposals are confirmed and executed ONLY in the Handshake web ' +
  'app (PIN + step-up) — never through this server.';

@Injectable()
export class McpToolsService {
  private readonly logger = new Logger(McpToolsService.name);
  private readonly tools: McpToolDefinition[];

  constructor(
    profileService: ProfileService,
    balanceService: BalanceService,
    walletService: WalletService,
    beneficiaryService: BeneficiaryService,
    historyService: TransactionHistoryService,
    quotesService: QuotesService,
    ratesService: RatesService,
    webChatService: WebChatService,
    assetRegistry: AssetRegistry,
    @Inject(IDENTITY_REPOSITORY) identityRepo: IIdentityRepository,
    @Inject(TRANSACTION_REPOSITORY) transactionRepo: ITransactionRepository,
    @Inject(SETTLEMENT_REPOSITORY) settlementRepo: ISettlementRepository,
    @Inject(PROPOSAL_REPOSITORY) proposalRepo: IProposalRepository,
  ) {
    const deps: McpToolDeps = {
      profile: profileService,
      balances: balanceService,
      wallets: walletService,
      beneficiaries: beneficiaryService,
      history: historyService,
      quotes: quotesService,
      rates: ratesService,
      chat: webChatService,
      identityRepo,
      transactionRepo,
      settlementRepo,
      proposalRepo,
      registry: assetRegistry,
    };
    this.tools = [
      ...buildReadTools(deps),
      ...buildTransactionTools(deps),
      ...buildChatTools(deps),
    ];
  }

  /**
   * A fresh MCP Server scoped to one principal (stateless streamable-HTTP:
   * one server per request). Both handlers enforce the PAT scopes.
   */
  buildServer(principal: McpPrincipal): Server {
    const server = new Server(MCP_SERVER_INFO, {
      capabilities: { tools: {} },
      instructions: MCP_SERVER_INSTRUCTIONS,
    });

    server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: listToolsFor(this.tools, principal),
    }));

    server.setRequestHandler(CallToolRequestSchema, (request) =>
      dispatchToolCall(
        this.tools,
        principal,
        request.params.name,
        request.params.arguments,
        (err, toolName) =>
          this.logger.error(
            `MCP tool '${toolName}' failed for user ${principal.userId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
      ),
    );

    return server;
  }
}
