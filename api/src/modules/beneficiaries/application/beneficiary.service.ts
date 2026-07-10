/**
 * BeneficiaryService — application-layer use-case service (S3 + Fix E).
 *
 * Manages saved payout destinations: bank accounts (sell) and crypto addresses
 * (send, Task N2). Clean-architecture invariants:
 *
 *   - No Prisma import, no @prisma/client, no direct DB access.
 *   - Injects IBeneficiaryRepository, INameEnquiry, and AssetRegistry via DI
 *     tokens / class ref.
 *   - Domain errors (InvalidAddressError, BeneficiaryNotFoundError,
 *     NameEnquiryFailedError) are pure.
 *   - Bank-account adds call the name-enquiry port and persist the RESOLVED
 *     name + verifiedAt. On enquiry failure no beneficiary is saved (Fix E).
 *   - Crypto adds carry first-use cooling-off (IDN-08) and address validation;
 *     name-enquiry is NOT called for crypto (unaffected, Fix E).
 *   - Unverified bank adds (name-enquiry unavailable for the market) ALSO carry a
 *     first-use cooling-off (B3) so an unverified name cannot go straight onto a
 *     real transfer.
 *   - Adding a withdrawal destination is step-up gated at the controller (R2):
 *     PIN verify + device-bound step-up run BEFORE this service persists.
 *
 * CLAUDE.md §3.2: no @prisma/client here. dependency-cruiser enforces this.
 */

import { Injectable, Inject } from '@nestjs/common';

import type { Bank } from '@handshake-agent/contracts';

import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import {
  BENEFICIARY_REPOSITORY,
  type IBeneficiaryRepository,
  type BeneficiaryRecord,
} from './ports/beneficiary.repository.port';
import {
  BANK_NAME_ENQUIRY,
  type INameEnquiry,
} from './ports/name-enquiry.port';
import {
  BANK_LIST_PROVIDER,
  type IBankListProvider,
} from './ports/bank-list.port';
import {
  InvalidAddressError,
  BeneficiaryInvalidAccountNumberError,
  BeneficiaryNotFoundError,
  UnknownBankCountryError,
} from '../domain/beneficiary-errors';
import { isValidAccountNumberForCountry } from './account-number-formats';

/** Payout rail for a bank beneficiary (mirrors the contracts BeneficiaryRail). */
export type BeneficiaryRail = 'bank' | 'mobile_money';

// ---------------------------------------------------------------------------
// Input types (application layer — no Prisma shapes)
// ---------------------------------------------------------------------------

export interface AddBankAccountInput {
  userId: string;
  accountNumber: string;
  bankCode: string;
  /**
   * Caller-supplied account holder name. IGNORED where the country's rail can
   * resolve the true name (NG — the name-enquiry result is persisted); used as
   * the persisted `unverified` name where the rail cannot resolve it (non-NG).
   * Kept for call sites (e.g. the WhatsApp Flow) that already pass it.
   */
  accountName?: string;
  /** User-supplied display label. */
  label: string;
  /**
   * Payout currency (ISO 4217). Optional — the service defaults it to the
   * catalog default fiat (NGN today) when a caller (e.g. the WhatsApp NGN Flow)
   * omits it. The bank COUNTRY is derived from this via
   * `AssetRegistry.countryForFiat`; a client-supplied country is never trusted.
   */
  currency?: string;
  /**
   * Payout rail ('bank' default | 'mobile_money'). Carried through to the record
   * so the engine (treasury) builds the correct provider payout body. NG stays
   * 'bank'; defaults to 'bank' when omitted.
   */
  rail?: BeneficiaryRail;
  /**
   * When true, SKIP name-enquiry and persist as `unverified` + cooling-off
   * regardless of country (A2). Used by the media-extraction path: an
   * image-extracted destination carries no PIN/step-up, so it must be treated as
   * a fresh unverified destination the user reviews before its first payout —
   * never an immediately-usable, name-enquiry-verified target on session
   * identity alone.
   */
  forceUnverified?: boolean;
}

export interface AddCryptoAddressInput {
  userId: string;
  address: string;
  network: string;
  asset: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class BeneficiaryService {
  /**
   * Default crypto cooling-off period in seconds (IDN-08).
   * Overridden by `beneficiary.cryptoCoolingOffSeconds` in config.
   */
  private static readonly DEFAULT_COOLING_OFF_SECONDS = 24 * 60 * 60; // 24 h

  constructor(
    @Inject(BENEFICIARY_REPOSITORY)
    private readonly repo: IBeneficiaryRepository,
    @Inject(BANK_NAME_ENQUIRY)
    private readonly nameEnquiry: INameEnquiry,
    private readonly assetRegistry: AssetRegistry,
    private readonly configService: EffectiveConfigService,
    @Inject(BANK_LIST_PROVIDER)
    private readonly bankListProvider: IBankListProvider,
  ) {}

  // ── listBanks ──────────────────────────────────────────────────────────────

  /**
   * Lists the banks available for the given ISO 3166-1 alpha-2 country, backing
   * the `GET /beneficiaries/banks?country=` dropdown. Validates the country is a
   * known catalog country BEFORE any provider call (§3.3), then delegates to the
   * bank-list port (real Flutterwave in prod; per-country cached). The provider
   * degrades to `[]` on failure rather than throwing.
   *
   * @throws {UnknownBankCountryError} when no catalog fiat maps to the country.
   */
  async listBanks(country: string): Promise<Bank[]> {
    const code = country.trim().toUpperCase();
    if (!this.assetRegistry.knownCountries().includes(code)) {
      throw new UnknownBankCountryError(code);
    }
    return this.bankListProvider.listBanks(code);
  }

  // ── listForUser ────────────────────────────────────────────────────────────

  /**
   * Lists all active (non-deleted) beneficiaries of the given type for a user.
   */
  async listForUser(
    userId: string,
    type: 'bank_account' | 'crypto_address',
  ): Promise<BeneficiaryRecord[]> {
    return this.repo.listForUser(userId, type);
  }

  // ── addBankAccount ─────────────────────────────────────────────────────────

  /**
   * Persists a new bank-account beneficiary after resolving the account-holder
   * name via the name-enquiry port (Fix E).
   *
   * Flow:
   *   1. Derive the payout currency + bank COUNTRY server-side (§3.3).
   *   2. Validate the account number against the country's precise format (B1) —
   *      the wire DTO is permissive, this is the security gate.
   *   3. Dedupe on (accountNumber, bankCode).
   *   4. If name-enquiry is resolvable for the country AND the add is not forced
   *      unverified: call INameEnquiry.resolve, persist the RESOLVED name +
   *      verifiedAt, verificationStatus='verified', NO cooling-off.
   *   5. Otherwise persist the user-entered name as 'unverified' WITH a first-use
   *      cooling-off (B3) so an unverified name can't go straight onto a transfer.
   *
   * Sets `isDefault` automatically if the user has no existing bank accounts.
   * Crypto-address beneficiaries are unaffected — name-enquiry is not called.
   *
   * @throws {BeneficiaryInvalidAccountNumberError} when the account number does
   *         not match the resolved country's format (422). No beneficiary saved.
   * @throws {NameEnquiryFailedError} when the name-enquiry provider cannot
   *         resolve the account. No beneficiary is persisted in that case.
   *
   * Dedupe: if an active bank account with the same (accountNumber, bankCode)
   * already exists, the existing row is returned and no insert (or redundant
   * name-enquiry) happens — re-adding the same account must not create a junk
   * duplicate the picker can never distinguish.
   */
  async addBankAccount(input: AddBankAccountInput): Promise<BeneficiaryRecord> {
    // Derive the payout currency + bank country SERVER-SIDE (§3.3): the country
    // comes from the currency's catalog entry, never from the client. Default to
    // the catalog base fiat (NGN) when a caller (e.g. the NGN WhatsApp Flow)
    // omits the currency.
    const currency = input.currency ?? this.assetRegistry.defaultFiat();
    const country = this.assetRegistry.countryForFiat(currency);

    // B1: enforce the precise per-country account-number format server-side. The
    // wire DTO is deliberately permissive (validates before the country is known)
    // — this is the real gate (§3.3). NG = 10-digit NUBAN; other markets use a
    // permissive length band so a valid GHS/KES/etc number is not rejected.
    if (!isValidAccountNumberForCountry(country, input.accountNumber)) {
      throw new BeneficiaryInvalidAccountNumberError(
        country,
        input.accountNumber,
      );
    }

    const duplicate = await this.repo.findActiveDuplicate(input.userId, {
      type: 'bank_account',
      accountNumber: input.accountNumber,
      bankCode: input.bankCode,
    });
    if (duplicate) {
      return duplicate;
    }

    // Country-gated name-enquiry: resolve the true account name where the rail
    // supports it (NG); otherwise SKIP the enquiry and keep the user-entered
    // name as `unverified` — do NOT fail closed on an unsupported market. A2:
    // `forceUnverified` also skips it (an image-extracted destination has no PIN).
    if (!input.forceUnverified && this.isNameEnquiryResolvable(country)) {
      const enquiryResult = await this.nameEnquiry.resolve({
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
      });

      return this.repo.addBankAccount({
        userId: input.userId,
        accountNumber: input.accountNumber,
        bankCode: input.bankCode,
        // Use the bank-resolved name, not the caller-supplied name (Fix E).
        accountName: enquiryResult.accountName,
        label: input.label,
        payoutCurrency: currency,
        bankCountry: country,
        rail: input.rail ?? 'bank',
        verificationStatus: 'verified',
        verifiedAt: new Date(),
        // A name-enquiry-verified account is immediately usable — no cooling-off.
        firstUseLockedUntil: null,
      });
    }

    // Unverified add (name-enquiry unavailable, or forced) → carry a first-use
    // cooling-off (B3) so an unverified name cannot go straight onto a transfer.
    const coolingOffSeconds = this.getCoolingOffSeconds();
    const firstUseLockedUntil = new Date(Date.now() + coolingOffSeconds * 1000);

    return this.repo.addBankAccount({
      userId: input.userId,
      accountNumber: input.accountNumber,
      bankCode: input.bankCode,
      // No rail to resolve the name — persist what the user entered (label is the
      // best-available fallback when no explicit account-holder name was supplied).
      accountName: input.accountName ?? input.label,
      label: input.label,
      payoutCurrency: currency,
      bankCountry: country,
      rail: input.rail ?? 'bank',
      verificationStatus: 'unverified',
      verifiedAt: null,
      firstUseLockedUntil,
    });
  }

  // ── addCryptoAddress ───────────────────────────────────────────────────────

  /**
   * Validates the address against the network's pattern (via AssetRegistry),
   * then persists the beneficiary with a first-use cooling-off expiry (IDN-08).
   *
   * @throws {InvalidAddressError} when the address fails network validation.
   *
   * Step-up-on-add is enforced at the controller (R2): PIN verify + a device-bound
   * step-up run BEFORE this service persists. The first-use cooling-off here is an
   * ADDITIONAL layer (a fresh destination cannot receive its first transfer until
   * the window elapses), not the sole protection.
   */
  async addCryptoAddress(
    input: AddCryptoAddressInput,
  ): Promise<BeneficiaryRecord> {
    const valid = this.assetRegistry.validateAddress(
      input.network,
      input.address,
    );
    if (!valid) {
      throw new InvalidAddressError(input.network, input.address);
    }

    // Dedupe: re-adding the same address reuses the existing active row rather
    // than inserting a duplicate — a fresh insert would reset the first-use
    // cooling-off clock (IDN-08), so a typo-then-fix could silently re-arm it.
    const duplicate = await this.repo.findActiveDuplicate(input.userId, {
      type: 'crypto_address',
      cryptoAddress: input.address,
    });
    if (duplicate) {
      return duplicate;
    }

    const coolingOffSeconds = this.getCoolingOffSeconds();
    const firstUseLockedUntil = new Date(Date.now() + coolingOffSeconds * 1000);

    return this.repo.addCryptoAddress({
      userId: input.userId,
      address: input.address,
      network: input.network,
      asset: input.asset,
      label: input.label,
      firstUseLockedUntil,
    });
  }

  // ── getById ────────────────────────────────────────────────────────────────

  /**
   * Returns the beneficiary for the user, or null when not found.
   * Soft-deleted rows are excluded.
   */
  async getById(
    userId: string,
    beneficiaryId: string,
  ): Promise<BeneficiaryRecord | null> {
    return this.repo.getById(userId, beneficiaryId);
  }

  // ── getDefault ─────────────────────────────────────────────────────────────

  /**
   * Returns the user's default beneficiary of the given type, or null.
   */
  async getDefault(
    userId: string,
    type: 'bank_account' | 'crypto_address',
  ): Promise<BeneficiaryRecord | null> {
    return this.repo.getDefault(userId, type);
  }

  // ── resolveByNickname (Wave B — beneficiary nicknames) ────────────────────

  /**
   * Resolves a spoken nickname ("mum") against the user's OWN saved
   * beneficiaries of the given type: case-insensitive exact label match,
   * soft-deleted rows excluded, ordered isDefault desc then createdAt asc.
   *
   * Returns ALL matches — the caller decides: exactly one → use it; several →
   * ask the user to choose; none → prompt to add/select a beneficiary.
   *
   * SECURITY (CLAUDE.md §3.1): the nickname is a lookup key, never a
   * destination. Resolution yields only a beneficiaryId; the proposal service
   * and engine re-validate ownership, type, cooling-off, and sanctions before
   * any money moves.
   */
  async resolveByNickname(
    userId: string,
    type: 'bank_account' | 'crypto_address',
    nickname: string,
  ): Promise<BeneficiaryRecord[]> {
    const trimmed = nickname.trim();
    if (trimmed === '') {
      return [];
    }
    return this.repo.findByLabel(userId, trimmed, type);
  }

  // ── requireById ───────────────────────────────────────────────────────────

  /**
   * Like getById but throws BeneficiaryNotFoundError when not found.
   * Useful in the Flow controller where absence should return an error screen.
   */
  async requireById(
    userId: string,
    beneficiaryId: string,
  ): Promise<BeneficiaryRecord> {
    const ben = await this.repo.getById(userId, beneficiaryId);
    if (!ben) {
      throw new BeneficiaryNotFoundError(beneficiaryId);
    }
    return ben;
  }

  // ── delete (soft-delete) ─────────────────────────────────────────────────────

  /**
   * Soft-deletes the beneficiary (sets `deletedAt`) so it disappears from the
   * picker while funds-safety history is preserved. Ownership is enforced in the
   * repository (the soft-delete is scoped by userId).
   *
   * @throws {BeneficiaryNotFoundError} when no active row matched (already
   *         deleted, or not owned by the user) — the controller maps this to 404.
   */
  async delete(
    userId: string,
    beneficiaryId: string,
  ): Promise<{ id: string; deleted: true }> {
    const deleted = await this.repo.softDelete(userId, beneficiaryId);
    if (!deleted) {
      throw new BeneficiaryNotFoundError(beneficiaryId);
    }
    return { id: beneficiaryId, deleted: true };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * True when the country's bank rail supports account name-enquiry (NG today).
   * Config-driven (`beneficiary.nameEnquiryResolvableCountries`, §7) and read at
   * call time so a DB-admin override takes effect without a deploy. Falls back
   * to `['NG']` when the config value is missing/malformed (fail-safe default).
   */
  private isNameEnquiryResolvable(country: string): boolean {
    const fromConfig: unknown = this.configService.get(
      'beneficiary.nameEnquiryResolvableCountries',
    );
    const countries: string[] =
      Array.isArray(fromConfig) &&
      fromConfig.every((c) => typeof c === 'string')
        ? fromConfig
        : ['NG'];
    const target = country.toUpperCase();
    return countries.some((c) => c.toUpperCase() === target);
  }

  private getCoolingOffSeconds(): number {
    // Config is read at call time (not constructor) so DB-admin AppSetting
    // overrides take effect at runtime via EffectiveConfigService (root §7).
    const fromConfig: unknown = this.configService.get(
      'beneficiary.cryptoCoolingOffSeconds',
    );
    if (typeof fromConfig === 'number' && fromConfig > 0) {
      return fromConfig;
    }
    return BeneficiaryService.DEFAULT_COOLING_OFF_SECONDS;
  }
}
