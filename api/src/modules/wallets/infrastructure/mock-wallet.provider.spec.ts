import { MockWalletProvider } from './mock-wallet.provider';
import type {
  IWalletProvider,
  ProvisionAddressInput,
  WithdrawInput,
} from '../application/ports/wallet-provider.port';

/**
 * Unit tests for MockWalletProvider — the default (WALLET_MOCK_MODE=true)
 * adapter. Fully deterministic, NO network calls (no HttpService dependency),
 * and never reports an on-chain withdrawal as confirmed (a mock never broadcasts
 * a real transaction — root §3.1).
 */
describe('MockWalletProvider', () => {
  // Typed as the port so calls exercise the full IWalletProvider contract even
  // though the mock omits params it ignores (e.g. getBalance).
  const provider: IWalletProvider = new MockWalletProvider();

  const provisionInput: ProvisionAddressInput = {
    userRef: 'user-42',
    network: 'TRON',
  };

  const withdrawInput: WithdrawInput = {
    addressId: 'mock-addr-user-42',
    toAddress: 'TDestination1111111111111111111111',
    amount: '5',
    assetId: 'usdt-tron',
    network: 'TRON',
    reference: 'idem-wd-7',
  };

  it('provisionAddress returns a deterministic address echoing the network', async () => {
    const out = await provider.provisionAddress(provisionInput);

    expect(out.network).toBe('TRON');
    expect(out.address).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    expect(out.providerReference).toContain('user-42');
  });

  it('getBalance returns a zero USDT balance', async () => {
    const out = await provider.getBalance(
      'mock-addr-user-42',
      'usdt-tron',
      'TRON',
    );

    expect(out.amount).toBe('0');
    expect(out.decimals).toBe(6);
  });

  it('withdraw reports pending — a mock never broadcasts a real transaction', async () => {
    const out = await provider.withdraw(withdrawInput);

    expect(out.status).toBe('pending');
    expect(out.providerReference).toContain('idem-wd-7');
  });

  it('getWithdrawalStatus returns pending (fail-safe; reconciler must not refund)', async () => {
    const out = await provider.getWithdrawalStatus({
      reference: 'idem-wd-7',
      addressId: 'mock-addr-user-42',
      network: 'TRON',
    });

    expect(out.status).toBe('pending');
  });
});
