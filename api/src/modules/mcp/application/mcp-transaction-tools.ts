/**
 * Read-scope MCP tools over the transaction ledger: history, single-transaction
 * status, and the pending-proposal list (Wave C).
 *
 * All read-only (§3.1). `list_transactions` mirrors the GET
 * /transactions/history query surface exactly (same window/cursor semantics);
 * `get_transaction` mirrors the GET /transactions/:id projection and parses
 * through the shared contract schema; `list_pending_proposals` surfaces only
 * ids + lifecycle fields — confirmation always happens in the web app.
 */

import { z } from 'zod';

import {
  RelativeDurationUnitSchema,
  TransactionPeriodSchema,
  TransactionStatusResponseSchema,
  TransactionTypeFilterSchema,
} from '@handshake-agent/contracts';

import { McpToolError } from '../domain/mcp-tool-error';
import type { TransactionRecord } from '../../transactions/application/ports/transaction.repository.port';
import { defineTool, PROPOSAL_INSTRUCTION } from './mcp-tool-types';
import type { McpToolDefinition, McpToolDeps } from './mcp-tool-types';

/** Mirrors the inflow-type heuristic in chat/presentation/proposal.controller. */
const INFLOW_TYPES = new Set(['buy', 'deposit', 'receive', 'reward', 'refund']);

const TRANSACTION_NOT_FOUND = 'Transaction not found';

const ListTransactionsInputSchema = z.object({
  period: TransactionPeriodSchema.optional(),
  relativeAmount: z.number().int().min(1).max(999).optional(),
  relativeUnit: RelativeDurationUnitSchema.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  txType: TransactionTypeFilterSchema.optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export function buildTransactionTools(deps: McpToolDeps): McpToolDefinition[] {
  return [
    defineTool({
      name: 'list_transactions',
      description:
        "The user's transaction history for a named period ('today', 'this_month', …), a relative window (relativeAmount + relativeUnit), or an explicit from/to range. Pass the returned cursor WITH the frozen from/to to page.",
      scope: 'read',
      inputSchema: ListTransactionsInputSchema,
      handler: async (args, principal) => {
        if (args.cursor) {
          // Continuation page: requires the frozen absolute window — the same
          // contract GET /transactions/history enforces.
          if (!args.from || !args.to) {
            throw new McpToolError('A cursor page requires from and to');
          }
          const from = new Date(args.from);
          const to = new Date(args.to);
          if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
            throw new McpToolError('Invalid from/to for a cursor page');
          }
          return deps.history.queryPage({
            userId: principal.userId,
            from,
            to,
            txType: args.txType ?? 'all',
            cursor: args.cursor,
            limit: args.limit,
          });
        }
        return deps.history.query(principal.userId, {
          period: args.period,
          from: args.from,
          to: args.to,
          relativeAmount: args.relativeAmount,
          relativeUnit: args.relativeUnit,
          txType: args.txType,
          limit: args.limit,
        });
      },
    }),

    defineTool({
      name: 'get_transaction',
      description:
        'Full status detail for one of the user’s transactions (settlement state, on-chain fields, receipt number).',
      scope: 'read',
      inputSchema: z.object({ transactionId: z.string().uuid() }),
      handler: async (args, principal) => {
        const transaction = await deps.transactionRepo.findById(
          args.transactionId,
        );
        // "Not found" and "wrong user" are the same answer (no ownership
        // disclosure) — mirrors GET /transactions/:id.
        if (transaction === null || transaction.userId !== principal.userId) {
          throw new McpToolError(TRANSACTION_NOT_FOUND);
        }
        const receiptNumber =
          transaction.status === 'completed'
            ? await deps.settlementRepo.findReceiptNumber(transaction.id)
            : null;
        return buildTransactionStatusPayload(transaction, receiptNumber);
      },
    }),

    defineTool({
      name: 'list_pending_proposals',
      description:
        'The user’s still-actionable transaction proposals (awaiting confirmation). Proposals can ONLY be confirmed and executed in the Handshake web app.',
      scope: 'read',
      inputSchema: z.object({}),
      handler: async (_args, principal) => {
        const proposals = await deps.proposalRepo.listPendingForUser(
          principal.userId,
          new Date(),
        );
        return {
          proposals: proposals.map((proposal) => ({
            proposalId: proposal.id,
            type: proposal.type,
            status: proposal.status,
            createdAt: proposal.createdAt.toISOString(),
            expiresAt: proposal.expiresAt.toISOString(),
          })),
          instruction: PROPOSAL_INSTRUCTION,
        };
      },
    }),
  ];
}

/**
 * Metadata → status projection, mirroring TransactionStatusController.getStatus
 * (chat/presentation) field-for-field, then parsed through the shared contract
 * schema so the two surfaces can never drift apart silently in shape.
 */
function buildTransactionStatusPayload(
  transaction: TransactionRecord,
  receiptNumber: string | null,
): unknown {
  const meta = transaction.metadata;
  const str = (key: string): string | undefined =>
    typeof meta[key] === 'string' ? meta[key] : undefined;
  const num = (key: string): number | undefined =>
    typeof meta[key] === 'number' ? meta[key] : undefined;

  const payment =
    str('accountNumber') !== undefined
      ? {
          accountNumber: str('accountNumber'),
          bankName: str('bankName'),
          providerRef: str('providerRef'),
          amount: str('fiatAmount'),
          currency: str('fiatCurrency'),
        }
      : undefined;
  // destination (send) → senderAddress (deposit) → recipientHandle (internal
  // transfer, which has no address/destination). Kept in lockstep with the chat
  // TransactionStatusController projection (proposal.controller.ts).
  const counterparty =
    str('destination') ?? str('senderAddress') ?? str('recipientHandle');
  const cryptoAmount = str('cryptoAmount') ?? str('amount');

  return TransactionStatusResponseSchema.parse({
    id: transaction.id,
    type: transaction.type,
    status: transaction.status,
    direction: INFLOW_TYPES.has(transaction.type) ? 'in' : 'out',
    ...(receiptNumber !== null ? { receiptNumber } : {}),
    ...(payment !== undefined ? { payment } : {}),
    ...(str('asset') !== undefined ? { asset: str('asset') } : {}),
    ...(str('network') !== undefined ? { network: str('network') } : {}),
    ...(cryptoAmount !== undefined ? { cryptoAmount } : {}),
    ...(str('fiatAmount') !== undefined
      ? { fiatAmount: str('fiatAmount') }
      : {}),
    ...(str('fiatCurrency') !== undefined
      ? { fiatCurrency: str('fiatCurrency') }
      : {}),
    ...(str('txHash') !== undefined ? { txHash: str('txHash') } : {}),
    ...(num('blockNumber') !== undefined
      ? { blockNumber: num('blockNumber') }
      : {}),
    ...(num('confirmations') !== undefined
      ? { confirmations: num('confirmations') }
      : {}),
    ...(counterparty !== undefined ? { counterparty } : {}),
    ...(str('fees') !== undefined ? { fees: str('fees') } : {}),
    createdAt: transaction.createdAt.toISOString(),
  });
}
