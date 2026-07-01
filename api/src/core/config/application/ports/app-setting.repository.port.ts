// Port for the DB-admin config layer (CLAUDE.md §7). AppSetting rows overlay the
// env/JSON base in EffectiveConfigService; the admin console writes them. Only
// infrastructure imports the generated Prisma client — this port is pure.

export const APP_SETTING_REPOSITORY = Symbol('APP_SETTING_REPOSITORY');

export type AppSettingScope = 'global' | 'tier' | 'provider';

export interface AppSettingRow {
  key: string;
  /** JSON value (string | number | boolean | object | array). */
  value: unknown;
  scope: AppSettingScope;
  scopeValue: string | null;
  isSecret: boolean;
  isEditable: boolean;
}

export interface UpsertAppSettingInput {
  key: string;
  value: unknown;
  scope: AppSettingScope;
  scopeValue: string | null;
  isSecret: boolean;
  isEditable: boolean;
  updatedByAdminId: string;
}

export interface IAppSettingRepository {
  /** All rows the admin layer may apply as overrides (isEditable = true). */
  findAllEditable(): Promise<AppSettingRow[]>;
  /** Every row (incl. non-editable) — for admin reads that show provenance. */
  findAll(): Promise<AppSettingRow[]>;
  findByKey(
    key: string,
    scope: AppSettingScope,
    scopeValue: string | null,
  ): Promise<AppSettingRow | null>;
  upsert(input: UpsertAppSettingInput): Promise<AppSettingRow>;
}
