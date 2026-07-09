/**
 * Human-safe display masking for saved beneficiaries (Wave B — nicknames).
 *
 * Used by the choose_beneficiary picker so a candidate can be told apart
 * WITHOUT ever exposing the full destination:
 *   - bank:   "<bank display name> ••1234" (last 4 digits only)
 *   - crypto: head/tail ellipsis — the EXACT convention the send-proposal
 *     confirmation uses (first 6 + '...' + last 4 when length > 10,
 *     see transactions/application/proposal.service.ts).
 *
 * Pure function (no Nest, no Prisma) so the WhatsApp surface can reuse it.
 */

import { bankNameForCode } from '@handshake-agent/contracts';

import type { BeneficiaryRecord } from './ports/beneficiary.repository.port';

/** The subset of a BeneficiaryRecord the mask needs (structural, reusable). */
export type BeneficiaryDetailSource = Pick<
  BeneficiaryRecord,
  'type' | 'bankCode' | 'accountNumber' | 'cryptoAddress'
>;

/**
 * Builds the masked destination summary for a beneficiary candidate.
 * NEVER returns a full account number or address.
 */
export function maskBeneficiaryDetail(
  beneficiary: BeneficiaryDetailSource,
): string {
  if (beneficiary.type === 'bank_account') {
    const bankName =
      (beneficiary.bankCode
        ? bankNameForCode(beneficiary.bankCode)
        : undefined) ??
      beneficiary.bankCode ??
      '';
    const accountFragment = beneficiary.accountNumber
      ? `••${beneficiary.accountNumber.slice(-4)}`
      : '';
    return [bankName, accountFragment].filter(Boolean).join(' ');
  }

  const address = beneficiary.cryptoAddress ?? '';
  return address.length > 10
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : address;
}
