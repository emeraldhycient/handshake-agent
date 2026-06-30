import * as crypto from 'crypto';
import { Injectable } from '@nestjs/common';
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
 * Flutterwave v3 Transfers API — get transfer by id response.
 * GET /transfers/{id} — same shape as create, potentially with updated status.
 */
interface GetTransferResponse {
  status: string;
  message: string;
  data: {
    id: number;
    amount: number;
    currency: string;
    /** Uppercase: NEW | PENDING | SUCCESSFUL | FAILED */
    status: string;
    reference: string;
    [key: string]: unknown;
  };
}

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
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly webhookSecret: string;

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

    try {
      const response = await firstValueFrom(
        this.http.post<CreateVirtualAccountResponse>(url, body, {
          headers: this.headers(),
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
    const body = {
      account_bank: input.bankAccount.bankCode,
      account_number: input.bankAccount.accountNumber,
      // Coerce string → number at the provider boundary (Transfers API expects a number).
      amount: Number(input.amount),
      currency: input.currency,
      narration: `Sell crypto ref ${input.reference}`,
      reference: input.reference,
    };

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

      const data = response.data.data;
      return {
        status: this.normalisePayoutStatus(data.status),
        amount: String(data.amount),
        currency: data.currency,
        providerRef: String(data.id),
      };
    } catch (err: unknown) {
      throw this.wrapError('verifyPayout', err);
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

  /**
   * Normalises the Flutterwave Transfers API status string (uppercase) to our port's union type.
   * Transfers use uppercase: NEW | PENDING | SUCCESSFUL | FAILED.
   * NEW and PENDING are intermediate — treated as 'pending'.
   * Only SUCCESSFUL is the paid terminal state.
   * Any unknown status is coerced to 'failed' to fail closed.
   */
  private normalisePayoutStatus(
    raw: string,
  ): 'successful' | 'pending' | 'failed' {
    const upper = raw.toUpperCase();
    if (upper === 'SUCCESSFUL') return 'successful';
    if (upper === 'NEW' || upper === 'PENDING') return 'pending';
    return 'failed';
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
