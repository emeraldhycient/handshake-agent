// Port for the runtime custom-fiat store (the "Add currency" feature). Backs the
// `custom_fiats` table: an operator adds a currency (created DISABLED), edits its
// metadata, and enables it once pricing exists (fail-closed, re-checked server-side).
// A custom fiat moves NO money — it is a catalog entry published to the money path via
// the AssetRegistry customFiats overlay (CustomFiatSyncService). The application layer
// reaches it only through this port (§3.2); no Prisma import crosses into
// application/domain — only the infrastructure repository imports the generated client.

export const CUSTOM_FIAT_REPOSITORY = Symbol('CUSTOM_FIAT_REPOSITORY');

/** A persisted custom-fiat row, projected to a plain record the application uses. */
export interface CustomFiatRecord {
  code: string;
  displayName: string;
  symbol: string;
  decimals: number;
  enabled: boolean;
  createdAt: Date;
}

/** The fields an operator supplies to add a currency (created DISABLED; actor threaded in). */
export interface CreateCustomFiatInput {
  code: string;
  displayName: string;
  symbol: string;
  decimals: number;
  addedByAdminId: string;
}

/** The mutable subset of a custom fiat — enable/disable and/or edit display metadata. */
export interface UpdateCustomFiatInput {
  enabled?: boolean;
  displayName?: string;
  symbol?: string;
  decimals?: number;
}

export interface ICustomFiatRepository {
  /** All custom fiats, newest-first. */
  listAll(): Promise<CustomFiatRecord[]>;
  /** Load one custom fiat by its (upper-case) code, or null if absent. */
  findByCode(code: string): Promise<CustomFiatRecord | null>;
  /** Append a new custom fiat (created DISABLED) and return the persisted row. */
  create(input: CreateCustomFiatInput): Promise<CustomFiatRecord>;
  /**
   * Apply a metadata/enabled patch to an existing custom fiat and return the
   * updated row. Callers pre-check existence (findByCode) so the code is known
   * to exist when this runs.
   */
  update(code: string, patch: UpdateCustomFiatInput): Promise<CustomFiatRecord>;
}
