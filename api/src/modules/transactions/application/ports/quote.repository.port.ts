/**
 * DI token for the Quote repository. Infrastructure provides the concrete
 * Prisma adapter; application only knows this symbol.
 */
export const QUOTE_REPOSITORY = Symbol('QUOTE_REPOSITORY');

// ---------------------------------------------------------------------------
// Application-level input type for Quote creation — NOT Prisma-generated types.
// Infrastructure maps this to Prisma create args; the application stays DB-agnostic.
// ---------------------------------------------------------------------------

export interface CreateQuoteData {
  userId: string;
  /** 'buy' | 'sell' | 'swap' */
  type: string;
  /** 'USDT' | 'BTC' */
  asset: string;
  /** 'NGN' */
  fiatCurrency: string;
  /** Fiat amount as a string (stored as Decimal in DB). */
  fiatAmount: string;
  /** Byte-stable crypto amount snapshot string. */
  cryptoAmount: string;
  /** FX rate as a string snapshot. */
  fxRate: string;
  /** Base rate (before spread) as a string snapshot. */
  baseRate: string;
  spreadBps: number;
  processingFeeBps: number;
  /** Processing fee amount as a string (stored as Decimal in DB). */
  processingFeeAmount: string;
  quotedAt: Date;
  expiresAt: Date;
}

/**
 * Application-level Quote record for reads — NOT the Prisma-generated type.
 */
export interface QuoteRecord {
  id: string;
  userId: string;
  type: string;
  asset: string;
  fiatCurrency: string;
  fiatAmount: string;
  cryptoAmount: string;
  fxRate: string;
  baseRate: string;
  spreadBps: number;
  processingFeeBps: number;
  processingFeeAmount: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface IQuoteRepository {
  /**
   * Persists a new Quote row in `valid` status.
   * Returns the auto-generated id.
   */
  create(data: CreateQuoteData): Promise<{ id: string }>;

  /**
   * Loads a Quote by id, or null if not found.
   * Used by the execution engine for drift checking (task 4.5a).
   */
  findById(id: string): Promise<QuoteRecord | null>;
}
