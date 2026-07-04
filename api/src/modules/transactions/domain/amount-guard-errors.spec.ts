/**
 * Tests for the proposal-boundary amount-guard domain errors (scenario findings
 * #2/#3/#4/#5/#6). These are pure domain errors carrying stable `code` strings
 * so the global filter can map them to clean 4xx responses without importing the
 * concrete classes.
 *
 * TDD: written before the errors / boundary guards exist (red → green).
 */

import {
  AmountTooLargeError,
  AmountTooSmallError,
  SelfSendError,
} from './amount-guard-errors';

describe('AmountTooSmallError', () => {
  it('carries the stable AMOUNT_TOO_SMALL code', () => {
    const err = new AmountTooSmallError('buy', '0.01', '500', 'NGN');
    expect(err.code).toBe('AMOUNT_TOO_SMALL');
  });

  it('is an Error with a name and a descriptive message', () => {
    const err = new AmountTooSmallError('buy', '0.01', '500', 'NGN');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AmountTooSmallError');
    expect(err.message).toContain('0.01');
    expect(err.message).toContain('500');
    expect(err.message).toContain('NGN');
  });

  it('exposes the operation, attempted amount, minimum, and unit for the caller', () => {
    const err = new AmountTooSmallError('send', '0.0000001', '0.5', 'USDT');
    expect(err.operation).toBe('send');
    expect(err.attempted).toBe('0.0000001');
    expect(err.minimum).toBe('0.5');
    expect(err.unit).toBe('USDT');
  });

  it('survives instanceof across a transpiled prototype chain', () => {
    const err = new AmountTooSmallError('sell', '0', '0.5', 'USDT');
    expect(err instanceof AmountTooSmallError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});

describe('AmountTooLargeError', () => {
  it('carries the stable AMOUNT_TOO_LARGE code', () => {
    const err = new AmountTooLargeError('buy', '9999999', '5000000', 'NGN');
    expect(err.code).toBe('AMOUNT_TOO_LARGE');
  });

  it('is an Error with a name and a descriptive message echoing the cap', () => {
    const err = new AmountTooLargeError('buy', '9999999', '5000000', 'NGN');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AmountTooLargeError');
    expect(err.message).toContain('9999999');
    expect(err.message).toContain('5000000');
    expect(err.message).toContain('NGN');
  });

  it('exposes the operation, attempted amount, maximum, and unit', () => {
    const err = new AmountTooLargeError('sell', '6000000', '5000000', 'NGN');
    expect(err.operation).toBe('sell');
    expect(err.attempted).toBe('6000000');
    expect(err.maximum).toBe('5000000');
    expect(err.unit).toBe('NGN');
  });

  it('survives instanceof across a transpiled prototype chain', () => {
    const err = new AmountTooLargeError('buy', '6000000', '5000000', 'NGN');
    expect(err instanceof AmountTooLargeError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});

describe('SelfSendError', () => {
  it('carries the stable SELF_SEND_BLOCKED code', () => {
    const err = new SelfSendError();
    expect(err.code).toBe('SELF_SEND_BLOCKED');
  });

  it('is an Error with a name and a non-leaking message', () => {
    const err = new SelfSendError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SelfSendError');
    // The message must NOT echo the user's address (it is masked elsewhere).
    expect(err.message.toLowerCase()).toContain('own');
  });

  it('survives instanceof across a transpiled prototype chain', () => {
    const err = new SelfSendError();
    expect(err instanceof SelfSendError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});
