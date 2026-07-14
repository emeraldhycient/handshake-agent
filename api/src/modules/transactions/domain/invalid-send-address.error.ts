/**
 * Raised when a user-supplied raw send address fails the network's pattern
 * validation. Maps to a clean in-chat clarification (never a 5xx), mirroring
 * the other proposal-builder rejections.
 */
export class InvalidSendAddressError extends Error {
  readonly code = 'INVALID_SEND_ADDRESS';
  constructor(
    readonly address: string,
    readonly network: string,
  ) {
    super(`Invalid ${network} address: ${address}`);
    this.name = 'InvalidSendAddressError';
  }
}
