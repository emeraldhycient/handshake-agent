import type { TransactionHistoryItem } from '@handshake-agent/contracts';
import type {
  StatementModel,
  StatementRow,
} from './ports/statement-generator.port';

export interface BuildStatementModelInput {
  items: TransactionHistoryItem[];
  totalCount: number;
  truncated: boolean;
  windowLabel: string;
  accountLabel: string;
  generatedAt: string;
  filename: string;
}

/** Pure: shape history items into a printable statement model. No I/O. */
export function buildStatementModel(
  input: BuildStatementModelInput,
): StatementModel {
  const rows: StatementRow[] = input.items.map((it) => ({
    date: it.createdAt,
    type: it.type,
    status: it.status,
    direction: it.direction,
    amount: signedAmount(it),
    reference: it.receiptNumber ?? it.id,
  }));

  return {
    title: 'Transaction Statement',
    accountLabel: input.accountLabel,
    windowLabel: input.windowLabel,
    generatedAt: input.generatedAt,
    rows,
    totalCount: input.totalCount,
    truncated: input.truncated,
    filename: input.filename,
  };
}

function signedAmount(it: TransactionHistoryItem): string {
  const sign = it.direction === 'in' ? '+' : '-';
  const value = it.cryptoAmount ?? it.fiatAmount ?? '';
  return value ? `${sign}${value}` : '';
}
