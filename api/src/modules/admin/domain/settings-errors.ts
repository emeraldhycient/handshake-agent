/**
 * Admin config-settings domain errors (Phase 1, layered config / AppSetting
 * console — root CLAUDE.md §7). Pure — no Nest, no Prisma. Each carries a stable
 * `code` so the global DomainExceptionFilter maps it to the right HTTP status
 * without importing these classes. Mirrors the AdminError base in admin-errors.ts.
 */

export type SettingsErrorCode =
  | 'ADMIN_SETTING_NOT_EDITABLE'
  | 'ADMIN_SETTING_INVALID'
  | 'ADMIN_MULTI_CURRENCY_INVARIANT';

export abstract class SettingsError extends Error {
  abstract readonly code: SettingsErrorCode;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A registered key exists but is marked non-editable — env/JSON only. */
export class SettingNotEditableError extends SettingsError {
  readonly code = 'ADMIN_SETTING_NOT_EDITABLE' as const;
  constructor(key: string) {
    super(`Config setting "${key}" is not editable.`);
  }
}

/** Unknown key, or a proposed value that fails the registered value schema. */
export class SettingValidationError extends SettingsError {
  readonly code = 'ADMIN_SETTING_INVALID' as const;
  constructor(message: string) {
    super(message);
  }
}

/**
 * A catalog change would leave an enabled fiat without limits or a base rate,
 * breaking the multi-currency invariant (every enabled fiat must be transactable).
 */
export class MultiCurrencyInvariantError extends SettingsError {
  readonly code = 'ADMIN_MULTI_CURRENCY_INVARIANT' as const;
  constructor(message: string) {
    super(message);
  }
}
