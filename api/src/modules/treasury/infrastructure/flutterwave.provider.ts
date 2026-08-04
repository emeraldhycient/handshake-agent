import * as crypto from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { AxiosError } from 'axios';

import type {
  IPaymentProvider,
  CreateCollectionInput,
  CreateCollectionOutput,
  VerifyOutput,
  CreatePayoutInput,
  CreatePayoutOutput,
  VerifyPayoutOutput,
} from '../application/ports/payment-provider.port';

// ---------------------------------------------------------------------------
// Flutterwave v3 response shapes
// ---------------------------------------------------------------------------

interface FlutterwaveErrorBody {
  status: string;
  message: string;
}

/**
 * Flutterwave v3 virtual-account creation response.
 *
 * NOTE: Some account types return the account fields inside `data`; others
 * return them at the top level. We are defensive and read from `data` first,
 * falling back to the top-level keys.
 */
interface CreateVirtualAccountResponse {
  status: string;
  message: string;
  data?: {
    response_code?: string;
    flw_ref?: string;
    account_number?: string;
    bank_name?: string;
    expiry_date?: string;
    [key: string]: unknown;
  } | null;
  // Top-level fallback fields (some Flutterwave account types).
  flw_ref?: string;
  account_number?: string;
  bank_name?: string;
  expiry_date?: string;
}

interface VerifyByReferenceResponse {
  status: string;
  message: string;
  data: {
    id: number;
    tx_ref: string;
    flw_ref: string;
    amount: number;
    currency: string;
    status: string;
    [key: string]: unknown;
  };
}

/**
 * Flutterwave v3 Transfers API — create payout response.
 *
 * POST /transfers returns `data.status` as uppercase: NEW | PENDING | SUCCESSFUL | FAILED.
 * `data.id` is the Flutterwave transfer id used to poll status via GET /transfers/{id}.
 */
interface CreateTransferResponse {
  status: string;
  message: string;
  data: {
    id: number;
    account_number: string;
    bank_code: string;
    full_name: string;
    created_at: string;
    currency: string;
    debit_currency: string;
    amount: number;
    fee: number;
    /** Uppercase: NEW | PENDING | SUCCESSFUL | FAILED */
    status: string;
    reference: string;
    narration: string;
    [key: string]: unknown;
  };
}

/**
 * A single Flutterwave v3 transfer, as returned by both transfer read endpoints.
 * `reference` is OUR merchant reference; `id` is Flutterwave's own transfer id.
 */
interface TransferRecord {
  id: number;
  amount: number;
  currency: string;
  /** Uppercase: NEW | PENDING | SUCCESSFUL | FAILED */
  status: string;
  reference: string;
  [key: string]: unknown;
}

/**
 * Flutterwave v3 Transfers API — get transfer by id response.
 * GET /transfers/{id} — same shape as create, potentially with updated status.
 */
interface GetTransferResponse {
  status: string;
  message: string;
  data: TransferRecord;
}

/**
 * Flutterwave v3 Transfers API — list transfers response.
 * GET /transfers?reference=<ref> — `data` is an ARRAY (unlike GET /transfers/{id}).
 */
interface ListTransfersResponse {
  status: string;
  message: string;
  data?: TransferRecord[];
}

/**
 * Transfer statuses we RECOGNISE as terminal failure — the only ones allowed to
 * trigger a refund of the user's crypto. Deliberately an allow-list: anything
 * absent from it is treated as pending, not failed (see normalisePayoutStatus).
 * Extend it only for a status Flutterwave documents as terminally unpaid.
 */
const FLUTTERWAVE_TERMINAL_FAILURE_STATUSES = new Set(['FAILED']);

// ---------------------------------------------------------------------------
// FlutterwaveProvider
// ---------------------------------------------------------------------------

/**
 * Flutterwave v3 NGN collection adapter — implements `IPaymentProvider`.
 *
 * Mirrors the `BlockradarProvider` / `CloudApiSender` pattern: builds the
 * base URL + bearer header once in the constructor, delegates HTTP to the
 * injected `HttpService`, and wraps errors into descriptive messages.
 *
 * Auth: `Authorization: Bearer <FLUTTERWAVE_SECRET_KEY>` (v3 standard).
 *
 * Webhook verification: plain constant-time equality of the `verif-hash`
 * header to `FLUTTERWAVE_WEBHOOK_SECRET` (v3 spec — NOT HMAC).
 */
@Injectable()
export class FlutterwaveProvider implements IPaymentProvider {
  private readonly logger = new Logger(FlutterwaveProvider.name);
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly webhookSecret: string;
  /** Optional sandbox scenario key; sent as X-Scenario-Key on collections when set. */
  private readonly scenarioKey: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.baseUrl =
      this.config.get<string>('FLUTTERWAVE_BASE_URL') ??
      'https://api.flutterwave.com/v3';
    const secretKey = this.config.get<string>('FLUTTERWAVE_SECRET_KEY') ?? '';
    this.authHeader = `Bearer ${secretKey}`;
    this.webhookSecret =
      this.config.get<string>('FLUTTERWAVE_WEBHOOK_SECRET') ?? '';
    this.scenarioKey =
      this.config.get<string>('FLUTTERWAVE_SCENARIO_KEY') ?? '';
  }

  // ---------------------------------------------------------------------------
  // IPaymentProvider
  // ---------------------------------------------------------------------------

  async createCollection(
    input: CreateCollectionInput,
  ): Promise<CreateCollectionOutput> {
    const url = `${this.baseUrl}/virtual-account-numbers`;
    const body = {
      email: input.customer.email,
      amount: input.amount,
      tx_ref: input.reference,
      firstname: input.customer.firstname,
      lastname: input.customer.lastname,
      narration: `Buy crypto ref ${input.reference}`,
      is_permanent: false,
    };

    // In sandbox, X-Scenario-Key tells Flutterwave which scenario to simulate
    // (e.g. "scenario:successful" → simulate the pay-in and fire the webhook).
    // Only sent when configured; production leaves FLUTTERWAVE_SCENARIO_KEY empty.
    const headers = this.headers();
    if (this.scenarioKey) {
      headers['X-Scenario-Key'] = this.scenarioKey;
    }

    try {
      const response = await firstValueFrom(
        this.http.post<CreateVirtualAccountResponse>(url, body, {
          headers,
        }),
      );

      const resp = response.data;
      // Be defensive: read from data if present and non-null, else top level.
      const src =
        resp.data != null && typeof resp.data === 'object' ? resp.data : resp;

      return {
        accountNumber: (src.account_number as string) ?? '',
        bankName: (src.bank_name as string) ?? '',
        providerRef: (src.flw_ref as string) ?? '',
        expiresAt: src.expiry_date ?? undefined,
      };
    } catch (err: unknown) {
      throw this.wrapError('createCollection', err);
    }
  }

  async verify(reference: string): Promise<VerifyOutput> {
    const url = `${this.baseUrl}/transactions/verify_by_reference`;

    try {
      const response = await firstValueFrom(
        this.http.get<VerifyByReferenceResponse>(url, {
          headers: this.headers(),
          params: { tx_ref: reference },
        }),
      );

      const data = response.data.data;

      // Normalise status: Flutterwave v3 returns 'successful' | 'pending' | 'failed'.
      const status = this.normaliseStatus(data.status);

      return {
        status,
        amount: String(data.amount),
        currency: data.currency,
        providerRef: data.flw_ref,
      };
    } catch (err: unknown) {
      throw this.wrapError('verify', err);
    }
  }

  async createPayout(input: CreatePayoutInput): Promise<CreatePayoutOutput> {
    const url = `${this.baseUrl}/transfers`;
    const body = this.buildTransferBody(input);

    try {
      const response = await firstValueFrom(
        this.http.post<CreateTransferResponse>(url, body, {
          headers: this.headers(),
        }),
      );

      const data = response.data.data;
      return {
        providerRef: String(data.id),
        status: this.normalisePayoutStatus(data.status),
      };
    } catch (err: unknown) {
      throw this.wrapError('createPayout', err);
    }
  }

  async verifyPayout(providerRef: string): Promise<VerifyPayoutOutput> {
    const url = `${this.baseUrl}/transfers/${providerRef}`;

    try {
      const response = await firstValueFrom(
        this.http.get<GetTransferResponse>(url, {
          headers: this.headers(),
        }),
      );

      return this.toVerifyPayoutOutput(response.data.data);
    } catch (err: unknown) {
      throw this.wrapError('verifyPayout', err);
    }
  }

  /**
   * Resolves a payout by OUR merchant reference — GET /transfers?reference=…
   * (Flutterwave v3 documents `reference` as a supported filter on the list
   * endpoint: "The merchant's unique reference for the transfer.")
   *
   * Used only when the transfer's provider id was never persisted (the
   * executeSell crash window). Returns null when no transfer carries that
   * reference; 404 is mapped to null because absence is a normal answer here.
   */
  async findPayoutByReference(
    reference: string,
  ): Promise<VerifyPayoutOutput | null> {
    const url = `${this.baseUrl}/transfers`;

    try {
      const response = await firstValueFrom(
        this.http.get<ListTransfersResponse>(url, {
          headers: this.headers(),
          params: { reference },
        }),
      );

      const rows = response.data?.data;
      if (!Array.isArray(rows)) return null;

      // FUNDS-SAFETY: match the reference EXACTLY rather than trusting the
      // filter. If the provider ever ignored the query param it would return
      // the full transfer list, and taking rows[0] would settle this sell
      // against an unrelated payout.
      const match = rows.find((row) => row?.reference === reference);
      return match ? this.toVerifyPayoutOutput(match) : null;
    } catch (err: unknown) {
      // 404 = no such transfer. Every other failure is ambiguous and must
      // propagate so the caller retries instead of reading it as "not found".
      const status = (err as AxiosError)?.response?.status;
      if (status === 404) return null;
      throw this.wrapError('findPayoutByReference', err);
    }
  }

  /**
   * Verifies the Flutterwave webhook `verif-hash` header (v3 constant-time
   * equality — NOT HMAC per ADR-0006).
   *
   * Returns `false` for any of:
   * - `undefined` header (webhook without signature)
   * - array of strings (multi-value header — reject; must be a single string)
   * - empty string header
   * - mismatched secret
   * - empty configured secret (not yet set in env)
   */
  verifyWebhookSignature(headerValue: string | string[] | undefined): boolean {
    // Reject non-string or empty values immediately.
    if (typeof headerValue !== 'string' || headerValue.length === 0) {
      return false;
    }
    // Never accept if the secret is not configured.
    if (this.webhookSecret.length === 0) {
      return false;
    }

    // Constant-time comparison to prevent timing side-channels.
    const expected = Buffer.from(this.webhookSecret, 'utf8');
    const received = Buffer.from(headerValue, 'utf8');

    if (expected.length !== received.length) return false;

    return crypto.timingSafeEqual(expected, received);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Builds the Flutterwave v3 Transfers API request body per payout corridor.
   *
   * Flutterwave transfers are per-(country, rail):
   * - **NG bank** (the launch corridor): `account_bank` + `account_number` +
   *   amount/currency/narration/reference only. This branch is BYTE-IDENTICAL to
   *   the original NG-only body — nothing regresses for Nigeria.
   * - **Every other corridor** (non-NG bank OR any `mobile_money` rail):
   *   Flutterwave requires the recipient name outside NG, so we thread
   *   `beneficiary_name`. For a `mobile_money` rail the caller supplies the
   *   mobile network/scheme code as `bankCode` (→ `account_bank`) and the
   *   wallet/phone as `accountNumber` (→ `account_number`).
   *
   * TODO(NG-LIVE): the per-network mobile-money scheme-code catalogue (e.g. the
   * exact `account_bank` code for MTN GH / M-Pesa KE / Airtel UG) is a
   * provider-data question that must be resolved from Flutterwave's live
   * transfer-bank list before enabling a mobile_money corridor — the caller must
   * pass the correct scheme code as the beneficiary's `bankCode`; this builder
   * threads it verbatim and never guesses a code.
   */
  private buildTransferBody(input: CreatePayoutInput): Record<string, unknown> {
    const country = (input.country ?? 'NG').toUpperCase();
    const rail = input.rail ?? 'bank';

    const base = {
      account_bank: input.bankAccount.bankCode,
      account_number: input.bankAccount.accountNumber,
      // Coerce string → number at the provider boundary (Transfers API expects a number).
      amount: Number(input.amount),
      currency: input.currency,
      narration: `Sell crypto ref ${input.reference}`,
      reference: input.reference,
    };

    // NG bank transfer — the launch corridor. Return the base shape unchanged.
    if (country === 'NG' && rail === 'bank') {
      return base;
    }

    // Non-NG bank OR mobile_money (any country): carry the beneficiary name.
    return {
      ...base,
      beneficiary_name: input.bankAccount.accountName,
    };
  }

  /** Common Flutterwave v3 auth headers. */
  private headers(): Record<string, string> {
    return {
      Authorization: this.authHeader,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Normalises the Flutterwave collection status string (lowercase) to our port's union type.
   * Any unknown status is coerced to 'failed' to fail closed.
   */
  private normaliseStatus(raw: string): 'successful' | 'pending' | 'failed' {
    if (raw === 'successful') return 'successful';
    if (raw === 'pending') return 'pending';
    return 'failed';
  }

  /** Maps a Flutterwave transfer record onto the port's VerifyPayoutOutput. */
  private toVerifyPayoutOutput(data: TransferRecord): VerifyPayoutOutput {
    return {
      status: this.normalisePayoutStatus(data.status),
      amount: String(data.amount),
      currency: data.currency,
      providerRef: String(data.id),
    };
  }

  /**
   * Normalises a Flutterwave transfer status onto the port's three-state union.
   * Transfers report uppercase: NEW | PENDING | SUCCESSFUL | FAILED. NEW and
   * PENDING are intermediate; only SUCCESSFUL is the paid terminal state.
   *
   * FUNDS-SAFETY: `'failed'` is the REFUND trigger in
   * `ExecutionService.settleSellPayout` — it returns the user's crypto from
   * clearing. So only a status we RECOGNISE as terminal-failure may map to it.
   * An unmodelled value (a new provider state, a casing/format change, an empty
   * string) is reported as `'pending'`: the transfer may well have been paid,
   * and refunding it would leave the user holding both the fiat and the crypto.
   * Pending keeps the funds in clearing and the settlement outbox row open for
   * an operator, which is the recoverable failure mode — a wrong refund is not.
   */
  private normalisePayoutStatus(
    raw: string,
  ): 'successful' | 'pending' | 'failed' {
    const upper = String(raw ?? '').toUpperCase();
    if (upper === 'SUCCESSFUL') return 'successful';
    if (upper === 'NEW' || upper === 'PENDING') return 'pending';
    if (FLUTTERWAVE_TERMINAL_FAILURE_STATUSES.has(upper)) return 'failed';

    this.logger.warn(
      `[flutterwave] unrecognised transfer status '${raw}' — treating as pending (never auto-refunding on an unknown status)`,
    );
    return 'pending';
  }

  /**
   * Translates an Axios rejection into a descriptive Error. Flutterwave v3
   * returns error bodies with a `message` field on non-2xx responses.
   *
   * The HTTP status is preserved STRUCTURALLY (as an `httpStatus` property), not
   * only in the message, so the execution engine can distinguish a DEFINITIVE
   * client rejection (4xx — collection/payout NOT created) from an ambiguous
   * 5xx/network failure and refund the reserve safely (no double-spend). Mirrors
   * BlockradarProvider.wrapError; consumed by ExecutionService.extractHttpStatus.
   * Network errors (no axios `response`) leave httpStatus undefined → ambiguous.
   */
  private wrapError(operation: string, err: unknown): Error {
    const axiosErr = err as AxiosError<FlutterwaveErrorBody>;
    const body = axiosErr?.response?.data;
    const httpStatus = axiosErr?.response?.status;
    if (body?.message) {
      const wrapped = new Error(
        `Flutterwave ${operation} error (HTTP ${httpStatus ?? 'unknown'}): ${body.message}`,
      );
      if (httpStatus !== undefined) {
        Object.assign(wrapped, { httpStatus });
      }
      return wrapped;
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
