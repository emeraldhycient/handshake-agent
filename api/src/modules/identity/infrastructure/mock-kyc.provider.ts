import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

import type {
  CreateVerificationSessionInput,
  CreateVerificationSessionResult,
  IKycProvider,
  KycVerifyInput,
  KycVerifyResult,
} from '../application/ports/kyc-provider.port';

/**
 * Mock KYC provider — the only adapter wired at launch.
 *
 * Auto-approves Tier-1 when the minimum identity fields are present:
 *   (nin OR bvn) AND non-empty firstName AND non-empty lastName.
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
  verify(input: KycVerifyInput): Promise<KycVerifyResult> {
    const reference = `mock-kyc-${randomUUID().slice(0, 8)}`;

    const hasIdentifier =
      (input.nin !== undefined && input.nin.trim().length > 0) ||
      (input.bvn !== undefined && input.bvn.trim().length > 0);

    const hasName =
      input.firstName.trim().length > 0 && input.lastName.trim().length > 0;

    if (hasIdentifier && hasName) {
      return Promise.resolve({
        approved: true,
        tier: 'tier_1',
        reference,
      });
    }

    return Promise.resolve({
      approved: false,
      tier: 'unverified',
      reference,
      reason: 'missing required identity fields',
    });
  }

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
