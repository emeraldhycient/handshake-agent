import { Inject, Injectable } from '@nestjs/common';

import type {
  AdminLedgerEntry,
  AdminLedgerIntegrityResult,
  AdminLedgerIntegritySummary,
  AdminLedgerListResponse,
} from '@handshake-agent/contracts';

import {
  LEDGER_REPOSITORY,
  type ILedgerRepository,
  type LedgerEntryRecord,
} from '../../transactions/application/ports/ledger.repository.port';

/** Default page size for account ledger history when the caller omits a limit. */
const DEFAULT_HISTORY_LIMIT = 50;

/** Default page size for the global cross-account ledger browse. */
const DEFAULT_GLOBAL_LIMIT = 50;

/** Page size used to DRAIN the full ledger for a CSV export (keyset walk). */
const EXPORT_PAGE_SIZE = 200;

/**
 * Hard safety cap on export pages so a malformed cursor loop can never hang the
 * request. At {@link EXPORT_PAGE_SIZE} legs/page this bounds an export to 200k
 * legs — far beyond any realistic filtered admin export.
 */
const EXPORT_MAX_PAGES = 1000;

/** Filters for the global cross-account ledger browse. */
export interface AdminLedgerListQuery {
  accountType?: string;
  currency?: string;
  cursor?: string;
  limit?: number;
}

/** Filters for a ledger CSV export — the global browse filters, no paging. */
export interface AdminLedgerExportQuery {
  accountType?: string;
  currency?: string;
}

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

  /**
   * Global cross-account ledger browse (READ-ONLY). Filters by optional
   * accountType/currency, newest-first keyset page. Projects each row onto the
   * contract entry shape and passes the repository's `nextCursor` straight
   * through (null when the last page has been reached).
   */
  async listGlobal(
    query: AdminLedgerListQuery,
  ): Promise<AdminLedgerListResponse> {
    const page = await this.ledger.listGlobal(
      { accountType: query.accountType, currency: query.currency },
      { cursor: query.cursor, limit: query.limit ?? DEFAULT_GLOBAL_LIMIT },
    );
    return {
      entries: page.items.map((e) => this.toEntry(e)),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Build the FULL set of ledger legs for a CSV export — the SAME filter
   * pipeline as {@link listGlobal}, but with no caller cursor/limit: every
   * matching leg is drained by walking the keyset pages. READ-ONLY (§3.1) — it
   * only reads the append-only ledger; the controller records the `admin_export`
   * audit event with the resulting rowCount.
   */
  async exportRows(query: AdminLedgerExportQuery): Promise<AdminLedgerEntry[]> {
    const rows: AdminLedgerEntry[] = [];

    let cursor: string | undefined;
    for (let page = 0; page < EXPORT_MAX_PAGES; page += 1) {
      const result = await this.ledger.listGlobal(
        { accountType: query.accountType, currency: query.currency },
        { cursor, limit: EXPORT_PAGE_SIZE },
      );
      for (const entry of result.items) rows.push(this.toEntry(entry));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }

    return rows;
  }

  /**
   * Global sequence-continuity check (READ-ONLY). Delegates to the repository's
   * per-sub-ledger walk and surfaces the summary for the header integrity pill.
   */
  async verifyGlobalSequenceIntegrity(): Promise<AdminLedgerIntegritySummary> {
    const result = await this.ledger.verifyGlobalSequenceIntegrity();
    return {
      ok: result.ok,
      accountsChecked: result.accountsChecked,
      brokenAccount: result.brokenAccount,
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
