/**
 * Contract schema tests for quote-send and execute-send tools (task N1).
 *
 * Runs under the api Jest config so the moduleNameMapper resolves
 * `@handshake-agent/contracts` to the source package.  These tests confirm
 * that the Zod schemas correctly accept valid payloads and reject invalid ones.
 *
 * TDD: written before QuotesService.quoteSend to pin the output shape.
 */

import {
  QuoteSendInputSchema,
  QuoteSendOutputSchema,
  SendProposalConfirmationSchema,
} from '@handshake-agent/contracts';

/** Drop a key from a plain object, returning a new object without the key. */
function omitKey<T extends Record<string, unknown>>(
  obj: T,
  key: keyof T,
): Omit<T, typeof key> {
  const { [key]: _, ...rest } = obj;
  // _ is intentionally unused — the variable is declared to suppress TS
  // "object literal may only specify known properties" but we don't need its value.
  void _;
  return rest;
}

// ---------------------------------------------------------------------------
// QuoteSendInputSchema
// ---------------------------------------------------------------------------

describe('QuoteSendInputSchema', () => {
  it('accepts a valid send-quote input', () => {
    const result = QuoteSendInputSchema.safeParse({
      asset: 'USDT',
      cryptoAmount: '10.5',
      network: 'TRON',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unsupported asset', () => {
    const result = QuoteSendInputSchema.safeParse({
      asset: 'DOGE',
      cryptoAmount: '10.5',
      network: 'TRON',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unsupported network', () => {
    const result = QuoteSendInputSchema.safeParse({
      asset: 'USDT',
      cryptoAmount: '10.5',
      network: 'ETHEREUM',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-numeric cryptoAmount', () => {
    const result = QuoteSendInputSchema.safeParse({
      asset: 'USDT',
      cryptoAmount: 'abc',
      network: 'TRON',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a whole-number cryptoAmount', () => {
    const result = QuoteSendInputSchema.safeParse({
      asset: 'USDT',
      cryptoAmount: '100',
      network: 'TRON',
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// QuoteSendOutputSchema
// ---------------------------------------------------------------------------

describe('QuoteSendOutputSchema', () => {
  const VALID_OUTPUT = {
    asset: 'USDT',
    cryptoAmount: '10.5',
    network: 'TRON',
    networkFeeCrypto: '1',
    totalDebit: '11.5',
    quotedAt: '2026-06-23T00:00:00.000Z',
    expiresInSec: 30,
  };

  it('accepts a valid send-quote output', () => {
    const result = QuoteSendOutputSchema.safeParse(VALID_OUTPUT);
    expect(result.success).toBe(true);
  });

  it('rejects a missing networkFeeCrypto field', () => {
    const result = QuoteSendOutputSchema.safeParse(
      omitKey(VALID_OUTPUT, 'networkFeeCrypto'),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a missing totalDebit field', () => {
    const result = QuoteSendOutputSchema.safeParse(
      omitKey(VALID_OUTPUT, 'totalDebit'),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a non-positive expiresInSec', () => {
    const result = QuoteSendOutputSchema.safeParse({
      ...VALID_OUTPUT,
      expiresInSec: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-datetime quotedAt', () => {
    const result = QuoteSendOutputSchema.safeParse({
      ...VALID_OUTPUT,
      quotedAt: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SendProposalConfirmationSchema
// ---------------------------------------------------------------------------

describe('SendProposalConfirmationSchema', () => {
  const VALID_CONFIRMATION = {
    proposalId: '550e8400-e29b-41d4-a716-446655440000',
    asset: 'USDT',
    cryptoAmount: '10.5',
    network: 'TRON',
    networkFeeCrypto: '1',
    totalDebit: '11.5',
    toAddressMasked: 'TRX123...abcd',
    expiresAt: '2026-06-23T00:00:30.000Z',
  };

  it('accepts a valid send confirmation without beneficiaryLabel', () => {
    const result = SendProposalConfirmationSchema.safeParse(VALID_CONFIRMATION);
    expect(result.success).toBe(true);
  });

  it('accepts a valid send confirmation with beneficiaryLabel', () => {
    const result = SendProposalConfirmationSchema.safeParse({
      ...VALID_CONFIRMATION,
      beneficiaryLabel: 'Alice',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-UUID proposalId', () => {
    const result = SendProposalConfirmationSchema.safeParse({
      ...VALID_CONFIRMATION,
      proposalId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a confirmation without toAddressMasked (internal transfer has no address)', () => {
    // toAddressMasked is now optional: an on-chain send sets it, an internal
    // (PayID) transfer omits it and is legible via recipientHandle instead (Task 6).
    const result = SendProposalConfirmationSchema.safeParse(
      omitKey(VALID_CONFIRMATION, 'toAddressMasked'),
    );
    expect(result.success).toBe(true);
  });

  it('accepts an internal-transfer shape (no toAddressMasked, instant:true)', () => {
    const result = SendProposalConfirmationSchema.safeParse({
      ...omitKey(VALID_CONFIRMATION, 'toAddressMasked'),
      networkFeeCrypto: '0',
      recipientDisplayName: 'Alice A.',
      recipientHandle: 'alice',
      instant: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-datetime expiresAt', () => {
    const result = SendProposalConfirmationSchema.safeParse({
      ...VALID_CONFIRMATION,
      expiresAt: '2026-06-23',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing networkFeeCrypto', () => {
    const result = SendProposalConfirmationSchema.safeParse(
      omitKey(VALID_CONFIRMATION, 'networkFeeCrypto'),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a missing totalDebit', () => {
    const result = SendProposalConfirmationSchema.safeParse(
      omitKey(VALID_CONFIRMATION, 'totalDebit'),
    );
    expect(result.success).toBe(false);
  });
});
