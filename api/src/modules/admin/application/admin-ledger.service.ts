import { Inject, Injectable } from '@nestjs/common';

import type {
  AdminLedgerEntry,
  AdminLedgerIntegrityResult,
} from '@handshake-agent/contracts';

import {
  LEDGER_REPOSITORY,
  type ILedgerRepository,
  type LedgerEntryRecord,
} from '../../transactions/application/ports/ledger.repository.port';

/** Default page size for account ledger history when the caller omits a limit. */
const DEFAULT_HISTORY_LIMIT = 50;

/**
 * Phase 3 (sub-area A) — READ-ONLY ledger oversight for the admin console.
 *
 * Surfaces per-account double-entry history and a per-transaction integrity
 * check. NEVER moves money (§3.1): the verify path only re-sums existing legs
 * and reports whether each currency nets to zero. Holds no Prisma import — it
 * reaches data exclusively through the injected ledger port (§3.2).
 */
@Injectable()
export class AdminLedgerService {
  constructor(
    @Inject(LEDGER_REPOSITORY)
    private readonly ledger: ILedgerRepository,
  ) {}

  async getAccountHistory(
    accountType: string,
    accountId: string,
    currency: string,
    limit?: number,
  ): Promise<AdminLedgerEntry[]> {
    const entries = await this.ledger.getAccountHistory(
      accountType,
      accountId,
      currency,
      limit ?? DEFAULT_HISTORY_LIMIT,
    );
    return entries.map((e) => this.toEntry(e));
  }

  async verifyTransactionIntegrity(
    transactionId: string,
  ): Promise<AdminLedgerIntegrityResult> {
    const result = await this.ledger.verifyTransactionIntegrity(transactionId);
    return {
      transactionId,
      balanced: result.balanced,
      legCount: result.legCount,
      brokenAt: result.brokenAt,
    };
  }

  private toEntry(e: LedgerEntryRecord): AdminLedgerEntry {
    return {
      id: e.id,
      transactionId: e.transactionId,
      accountType: e.accountType,
      accountId: e.accountId,
      currency: e.currency,
      amount: e.amount,
      direction: e.direction as 'debit' | 'credit',
      balanceAfter: e.balanceAfter,
      sequence: e.sequence,
      postedAt: e.postedAt.toISOString(),
    };
  }
}
