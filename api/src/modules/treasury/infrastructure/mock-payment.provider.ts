import { Injectable, Logger } from '@nestjs/common';

import type {
  IPaymentProvider,
  CreateCollectionInput,
  CreateCollectionOutput,
  VerifyOutput,
  CreatePayoutInput,
  CreatePayoutOutput,
  VerifyPayoutOutput,
} from '../application/ports/payment-provider.port';

/**
 * Mock payment provider — the default adapter when `PAYMENTS_MOCK_MODE=true`
 * (the env-schema default). Lets the buy/sell flows be exercised locally and in
 * tests WITHOUT a live Flutterwave call or real keys. The real
 * `FlutterwaveProvider` is selected by `TreasuryModule` when the flag is 'false'
 * — same isolation pattern as `MockKycProvider` / `MockSanctionsScreener`.
 *
 * Safety (root §3.1 — model proposes, engine disposes, no fake money movement):
 *   - `createCollection` returns a deterministic, clearly-labelled fake virtual
 *     account ("Mock Bank") so an operator can immediately tell mock mode is on.
 *   - `verify` / `verifyPayout` ALWAYS report `pending`: a mock account receives
 *     no real funds, so the engine must never credit crypto (or finalise a
 *     payout) off a fabricated "successful" payment. Settlement only completes
 *     against the real provider.
 *
 * No HttpService dependency — it makes no network calls.
 */
@Injectable()
export class MockPaymentProvider implements IPaymentProvider {
  private readonly logger = new Logger(MockPaymentProvider.name);

  createCollection(
    input: CreateCollectionInput,
  ): Promise<CreateCollectionOutput> {
    this.logger.warn(
      `[mock-payments] createCollection ref=${input.reference} — NO real Flutterwave call (PAYMENTS_MOCK_MODE=true)`,
    );
    return Promise.resolve({
      accountNumber: '0000000000',
      bankName: 'Mock Bank',
      // Derived from the reference so idempotent replay returns the same ref.
      providerRef: `MOCK-FLW-${input.reference}`,
    });
  }

  verify(reference: string): Promise<VerifyOutput> {
    // Honest, fail-closed default: no real money arrived, so the pay-in is never
    // confirmed. Returning 'pending' prevents the engine from crediting crypto.
    return Promise.resolve({
      status: 'pending',
      amount: '0',
      currency: 'NGN',
      providerRef: `MOCK-FLW-${reference}`,
    });
  }

  createPayout(input: CreatePayoutInput): Promise<CreatePayoutOutput> {
    this.logger.warn(
      `[mock-payments] createPayout ref=${input.reference} — NO real Flutterwave transfer (PAYMENTS_MOCK_MODE=true)`,
    );
    return Promise.resolve({
      providerRef: `MOCK-FLW-PO-${input.reference}`,
      status: 'pending',
    });
  }

  verifyPayout(providerRef: string): Promise<VerifyPayoutOutput> {
    // No real disbursement occurred — stays pending so nothing is finalised.
    return Promise.resolve({
      status: 'pending',
      amount: '0',
      currency: 'NGN',
      providerRef,
    });
  }

  findPayoutByReference(reference: string): Promise<VerifyPayoutOutput | null> {
    // Mirrors verifyPayout: a mock payout is never terminal. Returning the
    // pending record rather than null keeps the crash-window branch on the same
    // "nothing is finalised" path instead of looking like a missing transfer.
    return Promise.resolve({
      status: 'pending',
      amount: '0',
      currency: 'NGN',
      providerRef: `MOCK-FLW-PO-${reference}`,
    });
  }

  // Param omitted intentionally (still satisfies IPaymentProvider): mock mode
  // processes no real webhooks, so every signature is rejected (fail-closed).
  verifyWebhookSignature(): boolean {
    return false;
  }
}
