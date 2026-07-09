import { Injectable } from '@nestjs/common';

import { NIGERIAN_BANKS, type Bank } from '@handshake-agent/contracts';

import type { IBankListProvider } from '../application/ports/bank-list.port';

/**
 * Mock bank-list adapter — the default binding (gated by NAME_ENQUIRY_MOCK_MODE
 * for parity with the name-enquiry port). Returns the canonical NIGERIAN_BANKS
 * list for NG and an empty list for any other country (dev/test never reaches a
 * real Flutterwave `/banks/{country}` call). Never throws (port contract).
 *
 * A real provider (FlutterwaveBankList) is swapped in by flipping the
 * BANK_LIST_PROVIDER binding in BeneficiariesModule — same isolation pattern as
 * MockNameEnquiry / FlutterwaveNameEnquiry.
 */
@Injectable()
export class MockBankList implements IBankListProvider {
  listBanks(country: string): Promise<Bank[]> {
    if (country.trim().toUpperCase() === 'NG') {
      // Return a mutable copy so callers can safely sort/filter the result.
      return Promise.resolve(NIGERIAN_BANKS.map((b) => ({ ...b })));
    }
    return Promise.resolve([]);
  }
}
