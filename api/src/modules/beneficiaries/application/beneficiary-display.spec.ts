/**
 * TDD — maskBeneficiaryDetail (Wave B — beneficiary nicknames).
 *
 * The choose_beneficiary picker shows a HUMAN-SAFE masked destination summary,
 * never a full account number or address:
 *   - bank:   "<bank name> ••1234" (last 4 digits only)
 *   - crypto: head/tail ellipsis — the EXACT convention the send proposal
 *     confirmation already uses (first 6 + '...' + last 4 when length > 10).
 */

import { maskBeneficiaryDetail } from './beneficiary-display';

describe('maskBeneficiaryDetail', () => {
  it('masks a bank account as "<bank name> ••<last4>"', () => {
    expect(
      maskBeneficiaryDetail({
        type: 'bank_account',
        bankCode: '058',
        accountNumber: '0123456789',
        cryptoAddress: null,
      }),
    ).toBe('Guaranty Trust Bank (GTBank) ••6789');
  });

  it('falls back to the raw bank code when the code is not in the directory', () => {
    expect(
      maskBeneficiaryDetail({
        type: 'bank_account',
        bankCode: '000',
        accountNumber: '0123456789',
        cryptoAddress: null,
      }),
    ).toBe('000 ••6789');
  });

  it('never includes more than the last 4 digits of the account number', () => {
    const detail = maskBeneficiaryDetail({
      type: 'bank_account',
      bankCode: '058',
      accountNumber: '0123456789',
      cryptoAddress: null,
    });
    expect(detail).not.toContain('0123456789');
    expect(detail).not.toContain('123456');
  });

  it('omits the account fragment when the account number is missing', () => {
    expect(
      maskBeneficiaryDetail({
        type: 'bank_account',
        bankCode: '058',
        accountNumber: null,
        cryptoAddress: null,
      }),
    ).toBe('Guaranty Trust Bank (GTBank)');
  });

  it('masks a crypto address with the proposal-service head/tail convention', () => {
    // Same shape as proposal.service.ts: slice(0, 6) + '...' + slice(-4).
    expect(
      maskBeneficiaryDetail({
        type: 'crypto_address',
        bankCode: null,
        accountNumber: null,
        cryptoAddress: 'TQn9Y2khDD3VHKZ2GRdmKXD8bNkRuaBP2p',
      }),
    ).toBe('TQn9Y2...BP2p');
  });

  it('returns a short (≤10 char) crypto address unmasked (proposal-service parity)', () => {
    expect(
      maskBeneficiaryDetail({
        type: 'crypto_address',
        bankCode: null,
        accountNumber: null,
        cryptoAddress: 'Tshort',
      }),
    ).toBe('Tshort');
  });

  it('returns an empty string for a crypto row without an address', () => {
    expect(
      maskBeneficiaryDetail({
        type: 'crypto_address',
        bankCode: null,
        accountNumber: null,
        cryptoAddress: null,
      }),
    ).toBe('');
  });
});
