import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { AxiosError } from 'axios';

import { NameEnquiryFailedError } from '../domain/beneficiary-errors';
import type {
  INameEnquiry,
  NameEnquiryInput,
  NameEnquiryResult,
} from '../application/ports/name-enquiry.port';

// ---------------------------------------------------------------------------
// Flutterwave v3 resolve-account response shapes
// ---------------------------------------------------------------------------

interface FlutterwaveErrorBody {
  status: string;
  message: string;
}

interface ResolveAccountResponse {
  status: string;
  message: string;
  data: {
    account_number: string;
    account_name: string;
  } | null;
}

// ---------------------------------------------------------------------------
// FlutterwaveNameEnquiry
// ---------------------------------------------------------------------------

/**
 * Real bank name-enquiry adapter using the Flutterwave v3 accounts/resolve
 * endpoint (POST /accounts/resolve).
 *
 * Implements `INameEnquiry` — the same interface as MockNameEnquiry — and is
 * activated when `NAME_ENQUIRY_MOCK_MODE=false` in the environment (the module
 * factory in BeneficiariesModule selects this or MockNameEnquiry at boot).
 *
 * Auth: `Authorization: Bearer <FLUTTERWAVE_SECRET_KEY>` (v3 standard).
 * Config keys: `FLUTTERWAVE_BASE_URL`, `FLUTTERWAVE_SECRET_KEY` — the same
 * keys used by FlutterwaveProvider in TreasuryModule; no new env vars needed.
 *
 * Error handling:
 *   - Flutterwave returns status:'error' in the 200 body when the account
 *     cannot be resolved → NameEnquiryFailedError.
 *   - HTTP-level failures (4xx/5xx / network) → NameEnquiryFailedError.
 *   - Callers must NOT persist a beneficiary on any rejection (port contract).
 */
@Injectable()
export class FlutterwaveNameEnquiry implements INameEnquiry {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.baseUrl =
      this.config.get<string>('FLUTTERWAVE_BASE_URL') ??
      'https://api.flutterwave.com/v3';
    const secretKey = this.config.get<string>('FLUTTERWAVE_SECRET_KEY') ?? '';
    this.authHeader = `Bearer ${secretKey}`;
  }

  async resolve(input: NameEnquiryInput): Promise<NameEnquiryResult> {
    const url = `${this.baseUrl}/accounts/resolve`;
    const body = {
      account_number: input.accountNumber,
      account_bank: input.bankCode,
    };

    try {
      const response = await firstValueFrom(
        this.http.post<ResolveAccountResponse>(url, body, {
          headers: this.headers(),
        }),
      );

      const resp = response.data;

      // Flutterwave returns status:'error' in the 200 body when the account is
      // not resolvable (e.g. invalid number, bank unreachable). Treat this the
      // same as an HTTP error — no beneficiary should be persisted.
      if (resp.status !== 'success' || !resp.data?.account_name) {
        throw new NameEnquiryFailedError(
          input.bankCode,
          input.accountNumber,
          resp.message ?? 'account not found',
        );
      }

      return {
        accountName: resp.data.account_name,
        provider: 'flutterwave',
        // Flutterwave's resolve endpoint does not return a provider-side
        // reference, so we synthesize one from the resolved account number to
        // remain traceable in logs without an extra roundtrip.
        reference: `flw-resolve-${input.bankCode}-${resp.data.account_number}`,
      };
    } catch (err: unknown) {
      // Re-throw domain errors unchanged (already a NameEnquiryFailedError).
      if (err instanceof NameEnquiryFailedError) throw err;

      // Wrap HTTP / network errors into the domain error so callers have a
      // single typed error to handle (mirror FlutterwaveProvider.wrapError).
      const axiosErr = err as AxiosError<FlutterwaveErrorBody>;
      const providerMessage =
        axiosErr?.response?.data?.message ??
        (err instanceof Error ? err.message : String(err));

      throw new NameEnquiryFailedError(
        input.bankCode,
        input.accountNumber,
        providerMessage,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private headers(): Record<string, string> {
    return {
      Authorization: this.authHeader,
      'Content-Type': 'application/json',
    };
  }
}
