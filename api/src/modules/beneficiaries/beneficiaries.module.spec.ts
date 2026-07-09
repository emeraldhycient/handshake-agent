/**
 * TDD — beneficiaries.module.spec.ts
 *
 * Tests the selectNameEnquiryProvider factory function (mirror of
 * selectPaymentProvider in treasury.module.ts).
 *
 * Verifies:
 *   - NAME_ENQUIRY_MOCK_MODE !== 'false' → MockNameEnquiry returned
 *   - NAME_ENQUIRY_MOCK_MODE === 'false' → FlutterwaveNameEnquiry returned
 */

import { ConfigService } from '@nestjs/config';

import {
  selectNameEnquiryProvider,
  selectBankListProvider,
} from './beneficiaries.module';
import { MockNameEnquiry } from './infrastructure/mock-name-enquiry';
import { FlutterwaveNameEnquiry } from './infrastructure/flutterwave-name-enquiry';
import { MockBankList } from './infrastructure/mock-bank-list';
import { FlutterwaveBankList } from './infrastructure/flutterwave-bank-list';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stubConfig(value: string | undefined): ConfigService {
  return {
    get: () => value,
  } as unknown as ConfigService;
}

// Minimal stubs — we only test the selection logic, not the adapter behaviour.
const mockAdapter = {} as unknown as MockNameEnquiry;
const realAdapter = {} as unknown as FlutterwaveNameEnquiry;
const mockBankList = {} as unknown as MockBankList;
const realBankList = {} as unknown as FlutterwaveBankList;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('selectNameEnquiryProvider', () => {
  it("returns MockNameEnquiry when NAME_ENQUIRY_MOCK_MODE is 'true' (the default)", () => {
    const result = selectNameEnquiryProvider(
      mockAdapter,
      realAdapter,
      stubConfig('true'),
    );
    expect(result).toBe(mockAdapter);
  });

  it('returns MockNameEnquiry when NAME_ENQUIRY_MOCK_MODE is undefined (not set)', () => {
    const result = selectNameEnquiryProvider(
      mockAdapter,
      realAdapter,
      stubConfig(undefined),
    );
    expect(result).toBe(mockAdapter);
  });

  it('returns MockNameEnquiry when NAME_ENQUIRY_MOCK_MODE is any unexpected string', () => {
    const result = selectNameEnquiryProvider(
      mockAdapter,
      realAdapter,
      stubConfig('yes'),
    );
    expect(result).toBe(mockAdapter);
  });

  it("returns FlutterwaveNameEnquiry when NAME_ENQUIRY_MOCK_MODE is exactly 'false'", () => {
    const result = selectNameEnquiryProvider(
      mockAdapter,
      realAdapter,
      stubConfig('false'),
    );
    expect(result).toBe(realAdapter);
  });
});

describe('selectBankListProvider', () => {
  it('returns MockBankList by default (mode true / unset), same flag as name-enquiry', () => {
    expect(
      selectBankListProvider(mockBankList, realBankList, stubConfig('true')),
    ).toBe(mockBankList);
    expect(
      selectBankListProvider(mockBankList, realBankList, stubConfig(undefined)),
    ).toBe(mockBankList);
  });

  it("returns FlutterwaveBankList when NAME_ENQUIRY_MOCK_MODE is exactly 'false'", () => {
    expect(
      selectBankListProvider(mockBankList, realBankList, stubConfig('false')),
    ).toBe(realBankList);
  });
});
