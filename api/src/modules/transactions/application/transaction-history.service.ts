import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  TransactionHistoryItem,
  TransactionHistoryResponse,
} from '@handshake-agent/contracts';

import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { CLOCK, type Clock } from '../../../core/common/clock';
import type { StatementConfig } from '../../../core/config/configuration';

import {
  TRANSACTION_REPOSITORY,
  type ITransactionRepository,
  type TransactionRecord,
} from './ports/transaction.repository.port';
import {
  SETTLEMENT_REPOSITORY,
  type ISettlementRepository,
} from './ports/settlement.repository.port';
import { StatementTokenService } from './statement-token.service';
import {
  resolveWindow,
  type QueryWindowSpec,
} from '../domain/statement-window';

export interface QueryTransactionsSpec extends QueryWindowSpec {
  txType?: 'buy' | 'sell' | 'send' | 'receive' | 'all';
}

const TYPE_FILTER_MAP: Record<string, string[]> = {
  buy: ['buy'],
  sell: ['sell'],
  send: ['send'],
  receive: ['deposit'],
};
const ALL_MONEY_TYPES = ['buy', 'sell', 'send', 'deposit'];
const INFLOW_TYPES = new Set(['buy', 'deposit', 'reward', 'refund']);

@Injectable()
export class TransactionHistoryService {
  constructor(
    @Inject(TRANSACTION_REPOSITORY)
    private readonly txRepo: ITransactionRepository,
    @Inject(SETTLEMENT_REPOSITORY)
    private readonly settlementRepo: ISettlementRepository,
    private readonly assets: AssetRegistry,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly config: ConfigService,
    private readonly tokens: StatementTokenService,
  ) {}

  /** Resolve the window from a spec, then read + map. Used by web + WhatsApp. */
  async query(
    userId: string,
    spec: QueryTransactionsSpec,
  ): Promise<TransactionHistoryResponse> {
    const cfg = this.config.get<StatementConfig>('statement')!;
    const window = resolveWindow(spec, this.clock.now(), {
      maxWindowDays: cfg.maxWindowDays,
      timezoneOffsetMinutes: cfg.timezoneOffsetMinutes,
    });
    const txType = spec.txType ?? 'all';
    const inner = await this.queryResolved({
      userId,
      from: window.from,
      to: window.to,
      txType,
    });

    const token = this.tokens.sign({
      userId,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      txType,
    });

    return {
      window: {
        from: window.from.toISOString(),
        to: window.to.toISOString(),
        label: window.label,
      },
      items: inner.items,
      totalCount: inner.totalCount,
      truncated: inner.truncated,
      downloadUrl: this.tokens.buildDownloadUrl(token),
    };
  }

  /** Read + map for an already-resolved window (used by the signed download path). */
  async queryResolved(input: {
    userId: string;
    from: Date;
    to: Date;
    txType: string;
  }): Promise<{
    items: TransactionHistoryItem[];
    totalCount: number;
    truncated: boolean;
  }> {
    const cfg = this.config.get<StatementConfig>('statement')!;
    const types = TYPE_FILTER_MAP[input.txType] ?? ALL_MONEY_TYPES;

    const { rows, total } = await this.txRepo.listByUserInRange({
      userId: input.userId,
      from: input.from,
      to: input.to,
      types,
      limit: cfg.rowCap,
    });

    const items = await Promise.all(rows.map((r) => this.toItem(r)));
    return { items, totalCount: total, truncated: total > rows.length };
  }

  private async toItem(
    row: TransactionRecord,
  ): Promise<TransactionHistoryItem> {
    const meta = row.metadata;
    const asset = typeof meta.asset === 'string' ? meta.asset : undefined;
    const cryptoRaw =
      typeof meta.cryptoAmount === 'string' ? meta.cryptoAmount : undefined;
    const fiatRaw =
      typeof meta.fiatAmount === 'string' ? meta.fiatAmount : undefined;
    const fiatCurrency =
      typeof meta.fiatCurrency === 'string' ? meta.fiatCurrency : undefined;

    let receiptNumber: string | undefined;
    if (row.status === 'completed') {
      receiptNumber =
        (await this.settlementRepo.findReceiptNumber(row.id)) ?? undefined;
    }

    // Format via the registry, but FALL BACK to the raw value when the asset/fiat
    // is unregistered or disabled — the catalog is admin-tunable, and a legacy or
    // since-disabled row must not throw (UnsupportedAsset/FiatError) and 500 the
    // user's entire history. A read-only own-data view must be resilient.
    const cryptoDisplay =
      asset && cryptoRaw
        ? this.assets.isAssetEnabled(asset)
          ? this.assets.formatCrypto(asset, cryptoRaw)
          : `${cryptoRaw} ${asset}`
        : undefined;
    const fiatDisplay =
      fiatCurrency && fiatRaw
        ? this.assets.isFiatEnabled(fiatCurrency)
          ? this.assets.formatFiat(fiatCurrency, fiatRaw)
          : `${fiatCurrency} ${fiatRaw}`
        : undefined;

    return {
      id: row.id,
      type: row.type,
      status: row.status,
      direction: INFLOW_TYPES.has(row.type) ? 'in' : 'out',
      ...(asset ? { asset } : {}),
      ...(cryptoDisplay ? { cryptoAmount: cryptoDisplay } : {}),
      ...(fiatDisplay ? { fiatAmount: fiatDisplay } : {}),
      ...(fiatCurrency ? { fiatCurrency } : {}),
      createdAt: row.createdAt.toISOString(),
      ...(receiptNumber ? { receiptNumber } : {}),
    };
  }
}
