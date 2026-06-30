/** DI token for the statement (PDF) generator. Infra provides the adapter. */
export const STATEMENT_GENERATOR = Symbol('STATEMENT_GENERATOR');

export interface StatementRow {
  date: string; // ISO 8601
  type: string;
  status: string;
  direction: 'in' | 'out';
  amount: string; // signed, formatted display string, e.g. '+29.97 USDT'
  reference: string; // receiptNumber when present, else the tx id
}

export interface StatementModel {
  title: string;
  accountLabel: string;
  windowLabel: string;
  generatedAt: string; // ISO 8601 (drives the deterministic PDF CreationDate)
  rows: StatementRow[];
  totalCount: number;
  truncated: boolean;
  filename: string;
}

export interface StatementFile {
  buffer: Buffer;
  contentType: string;
  filename: string;
}

export interface IStatementGenerator {
  generate(model: StatementModel): Promise<StatementFile>;
}
