import type { PricingConfig } from '../../../core/config/configuration';

import { BaseRateMisconfiguredError } from '../domain/execution-errors';

/**
 * Resolves the per-fiat baseRate for an asset from pricing config and fails
 * closed when it is missing, zero, or negative.
 *
 * A 0/negative rate would zero the fiat-equivalent (`cryptoAmount × baseRate`)
 * and silently bypass the KYC / velocity / Travel-Rule money gate. Both the
 * proposal builder (`ProposalService.createSendProposal`) and the execution
 * engine (`ExecutionService.executeSend`) MUST resolve the rate through this
 * single guard so the money gate cannot be bypassed on misconfiguration
 * (CLAUDE.md §3.1 / §3.3).
 *
 * @returns the validated, strictly-positive baseRate.
 * @throws {BaseRateMisconfiguredError} when the rate is absent / 0 / negative.
 */
export function resolveBaseRate(
  pricingConfig: PricingConfig | undefined,
  asset: string,
  fiat: string,
): number {
  const baseRate = pricingConfig?.assets?.[asset]?.baseRates?.[fiat];
  if (!baseRate || baseRate <= 0) {
    throw new BaseRateMisconfiguredError(asset, fiat);
  }
  return baseRate;
}
