import { Injectable } from '@nestjs/common';

import type {
  CreateVerificationSessionInput,
  CreateVerificationSessionResult,
  IKycProvider,
} from '../application/ports/kyc-provider.port';

/**
 * Mock KYC provider — the only adapter wired at launch.
 *
 * A real NIN/BVN/liveness provider will implement `IKycProvider` and be
 * swapped in by changing the `KYC_PROVIDER` binding in `IdentityModule`
 * (same isolation pattern as `LlmProvider` / `IWalletProvider`).
 *
 * `KYC_MOCK_MODE` is read from env as a documentation guard — when a real
 * provider is added, the module binding selects the adapter; the flag signals
 * to operators that the real provider is not active.
 */
@Injectable()
export class MockKycProvider implements IKycProvider {
  /**
   * Deterministic fake Sumsub WebSDK access token (task 3.3). No network call,
   * no tier is granted — the real tier upgrade only happens once a later task
   * wires the `applicantReviewed` webhook.
   */
  createVerificationSession(
    input: CreateVerificationSessionInput,
  ): Promise<CreateVerificationSessionResult> {
    return Promise.resolve({
      token: `mock-${input.userId}-${input.level}`,
      applicantId: `mock-app-${input.userId}`,
    });
  }
}
