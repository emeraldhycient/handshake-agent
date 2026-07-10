/**
 * DI token and port contract for the bank-list provider (Wave G).
 *
 * Backs `GET /beneficiaries/banks?country=` — the dropdown of banks a user can
 * pick when adding a bank beneficiary. Infrastructure provides the concrete
 * adapter (FlutterwaveBankList in production; MockBankList in tests), selected by
 * the same flag as the name-enquiry port for parity. Application code depends only
 * on this token and the types below — never on infrastructure (clean-arch §4.1).
 */

import type { Bank } from '@handshake-agent/contracts';

export const BANK_LIST_PROVIDER = Symbol('BANK_LIST_PROVIDER');

export interface IBankListProvider {
  /**
   * Lists the banks the payout rail supports for the given ISO 3166-1 alpha-2
   * country. Implementations SHOULD cache per-country (banks are near-static).
   *
   * Resilience: this backs a dropdown, not the money path — an implementation
   * MUST NOT throw on a provider failure; it returns `[]` so the endpoint
   * degrades to the client's offline fallback rather than breaking the add flow.
   */
  listBanks(country: string): Promise<Bank[]>;
}
