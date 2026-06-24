import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

import type { AppConfig } from '../../../core/config/configuration';
import { NameEnquiryFailedError } from '../domain/beneficiary-errors';
import type {
  INameEnquiry,
  NameEnquiryInput,
  NameEnquiryResult,
} from '../application/ports/name-enquiry.port';

/**
 * Mock bank name-enquiry adapter — the only adapter wired at launch (Fix E).
 *
 * Returns a deterministic resolved name (not the caller-supplied name) so
 * BeneficiaryService always persists the resolved name rather than trusting
 * the caller input. The resolved name is configurable via
 * `beneficiary.nameEnquiryResolvedName` in the config layer (defaults to
 * "MOCK ACCOUNT HOLDER").
 *
 * A configured bad account number (`beneficiary.nameEnquiryBadAccount`) throws
 * NameEnquiryFailedError so the negative path is fully testable without a
 * real bank integration.
 *
 * A real NIBSS / bank-clearing provider implements `INameEnquiry` and is
 * swapped in by changing the `BANK_NAME_ENQUIRY` binding in
 * `BeneficiariesModule` — same isolation pattern as MockKycProvider /
 * MockSanctionsScreener.
 *
 * `NAME_ENQUIRY_MOCK_MODE` is read from env as an operational documentation
 * guard only — the module binding selects the adapter; the flag signals to
 * operators that the real provider is not yet active.
 */
@Injectable()
export class MockNameEnquiry implements INameEnquiry {
  private static readonly DEFAULT_RESOLVED_NAME = 'MOCK ACCOUNT HOLDER';

  private readonly badAccountNumber: string;
  private readonly resolvedName: string;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    const beneficiaryConfig =
      this.config.get<AppConfig['beneficiary']>('beneficiary');
    this.badAccountNumber = beneficiaryConfig?.nameEnquiryBadAccount ?? '';
    this.resolvedName =
      beneficiaryConfig?.nameEnquiryResolvedName ||
      MockNameEnquiry.DEFAULT_RESOLVED_NAME;
  }

  resolve(input: NameEnquiryInput): Promise<NameEnquiryResult> {
    const reference = `mock-name-enquiry-${randomUUID().slice(0, 8)}`;

    if (
      this.badAccountNumber.length > 0 &&
      input.accountNumber === this.badAccountNumber
    ) {
      return Promise.reject(
        new NameEnquiryFailedError(
          input.bankCode,
          input.accountNumber,
          'account not found',
        ),
      );
    }

    return Promise.resolve({
      accountName: this.resolvedName,
      provider: 'mock',
      reference,
    });
  }
}
