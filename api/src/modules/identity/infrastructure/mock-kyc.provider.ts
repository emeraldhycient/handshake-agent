import { Injectable } from '@nestjs/common';

import type {
  CreateVerificationSessionInput,
  CreateVerificationSessionResult,
  IKycProvider,
} from '../application/ports/kyc-provider.port';

/**
 * Mock KYC provider — the default adapter (KYC_MOCK_MODE=true).
 *
 * Provides a deterministic fake Sumsub WebSDK session for tier_2/tier_3 upgrade
 * tests. The real adapter (SumsubKycProvider) is swapped in by the
 * `KYC_PROVIDER` binding in `IdentityModule` when KYC_MOCK_MODE=false (same
 * isolation pattern as `LlmProvider` / `IWalletProvider`). tier_1 is granted at
 * email verification; there is no synchronous NIN/BVN path.
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
