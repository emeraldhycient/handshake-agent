import { MockPaymentProvider } from './mock-payment.provider';
import type {
  IPaymentProvider,
  CreateCollectionInput,
  CreatePayoutInput,
} from '../application/ports/payment-provider.port';

/**
 * Unit tests for MockPaymentProvider — the default (PAYMENTS_MOCK_MODE=true)
 * adapter. It must be fully deterministic and make NO network calls (it has no
 * HttpService dependency), and it must NEVER report a pay-in/payout as confirmed
 * (a mock virtual account receives no real funds — crediting off a fake payment
 * would violate safety-of-funds, root §3.1).
 */
describe('MockPaymentProvider', () => {
  // Typed as the port so calls exercise the full IPaymentProvider contract even
  // though the mock omits params it ignores (e.g. verifyWebhookSignature).
  const provider: IPaymentProvider = new MockPaymentProvider();

  const collectionInput: CreateCollectionInput = {
    amount: '20000',
    currency: 'NGN',
    reference: 'idem-abc-123',
    customer: { email: 'u@example.com', firstname: 'Ada', lastname: 'Obi' },
  };

  const payoutInput: CreatePayoutInput = {
    amount: '15000',
    currency: 'NGN',
    reference: 'idem-payout-9',
    bankAccount: {
      accountNumber: '0123456789',
      bankCode: '044',
      accountName: 'Ada Obi',
    },
  };

  it('createCollection returns a deterministic mock virtual account', async () => {
    const out = await provider.createCollection(collectionInput);

    expect(out.bankName).toBe('Mock Bank');
    // providerRef is derived from the reference so it is stable across replays.
    expect(out.providerRef).toBe('MOCK-FLW-idem-abc-123');
    expect(out.accountNumber).toMatch(/^\d{10}$/);
  });

  it('verify reports pending — a mock account never confirms a real payment', async () => {
    const out = await provider.verify('idem-abc-123');

    // 'pending' is the safe default: the engine must not credit crypto off a
    // fake payment. Settlement only completes against a real provider.
    expect(out.status).toBe('pending');
    expect(out.providerRef).toContain('idem-abc-123');
  });

  it('createPayout returns a deterministic pending payout', async () => {
    const out = await provider.createPayout(payoutInput);

    expect(out.status).toBe('pending');
    expect(out.providerRef).toContain('idem-payout-9');
  });

  it('verifyPayout reports pending (no real disbursement occurred)', async () => {
    const out = await provider.verifyPayout('MOCK-FLW-PO-idem-payout-9');

    expect(out.status).toBe('pending');
  });

  it('verifyWebhookSignature returns false — mock mode processes no real webhooks', () => {
    expect(provider.verifyWebhookSignature('anything')).toBe(false);
    expect(provider.verifyWebhookSignature(undefined)).toBe(false);
  });
});
