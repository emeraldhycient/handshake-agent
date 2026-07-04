/**
 * TDD — flow-token.spec.ts (Task 6.2)
 *
 * Tests sign → verify round-trip, tampered token, expired token.
 * flow-token.ts is a pure module (no Nest deps) — tested directly.
 */

import { FlowTokenError } from '../domain/flow-errors';
import { signFlowToken, verifyFlowToken } from './flow-token';

const TEST_KEY = 'test-directive-signing-key-32chars-min';

describe('signFlowToken / verifyFlowToken', () => {
  it('round-trip: verify returns the original payload', () => {
    const payload = {
      proposalId: 'prop-123',
      directiveId: 'dir-456',
      userId: 'user-789',
    };
    const token = signFlowToken(payload, TEST_KEY);
    const result = verifyFlowToken(token, TEST_KEY);

    expect(result.proposalId).toBe(payload.proposalId);
    expect(result.directiveId).toBe(payload.directiveId);
    expect(result.userId).toBe(payload.userId);
  });

  it('round-trip preserves exp field', () => {
    const token = signFlowToken(
      { proposalId: 'p', directiveId: 'd', userId: 'u' },
      TEST_KEY,
    );
    const result = verifyFlowToken(token, TEST_KEY);
    expect(result.exp).toBeGreaterThan(Date.now() / 1000);
  });

  it('throws FlowTokenError when token is tampered (signature mismatch)', () => {
    const token = signFlowToken(
      { proposalId: 'p', directiveId: 'd', userId: 'u' },
      TEST_KEY,
    );
    // Flip the last char of the HMAC suffix to tamper the signature.
    const parts = token.split('.');
    const sig = parts[1];
    const lastChar = sig[sig.length - 1];
    const tamperedSig = sig.slice(0, -1) + (lastChar === 'a' ? 'b' : 'a');
    const tampered = `${parts[0]}.${tamperedSig}`;

    expect(() => verifyFlowToken(tampered, TEST_KEY)).toThrow(FlowTokenError);
  });

  it('throws FlowTokenError when token is expired', () => {
    // Sign with an exp in the past.
    const pastExp = Math.floor(Date.now() / 1000) - 10;
    const payload = {
      proposalId: 'p',
      directiveId: 'd',
      userId: 'u',
      exp: pastExp,
    };
    const token = signFlowToken(
      payload,
      TEST_KEY,
      0 /* ttlSeconds=0 → already expired */,
    );

    expect(() => verifyFlowToken(token, TEST_KEY)).toThrow(FlowTokenError);
    expect(() => verifyFlowToken(token, TEST_KEY)).toThrow('expired');
  });

  it('throws FlowTokenError for a malformed token (no dot separator)', () => {
    expect(() => verifyFlowToken('notavalidtoken', TEST_KEY)).toThrow(
      FlowTokenError,
    );
  });

  it('throws FlowTokenError when key differs (wrong signing key)', () => {
    const token = signFlowToken(
      { proposalId: 'p', directiveId: 'd', userId: 'u' },
      TEST_KEY,
    );
    expect(() => verifyFlowToken(token, 'different-key')).toThrow(
      FlowTokenError,
    );
  });

  // --- Fail-closed on an empty signing key (security hardening) ---
  // With key='' the HMAC is attacker-computable, so a forged flow_token binding
  // an arbitrary victim userId would verify. Both sign and verify must refuse an
  // empty key (mirrors DirectiveService/TokenService), independent of env validation.

  it('signFlowToken throws FlowTokenError when the key is empty', () => {
    expect(() =>
      signFlowToken({ proposalId: 'p', directiveId: 'd', userId: 'u' }, ''),
    ).toThrow(FlowTokenError);
  });

  it('verifyFlowToken throws FlowTokenError when the key is empty', () => {
    // Sign with a real key so the token is otherwise well-formed; the empty
    // verify key must still be rejected (not silently accepted via attacker HMAC).
    const token = signFlowToken(
      { proposalId: 'p', directiveId: 'd', userId: 'u' },
      TEST_KEY,
    );
    expect(() => verifyFlowToken(token, '')).toThrow(FlowTokenError);
  });
});
