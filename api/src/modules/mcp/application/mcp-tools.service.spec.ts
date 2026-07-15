/**
 * McpToolsService / tool-registry behavior (Wave C — MCP surface).
 *
 * Exercises the REAL MCP wire path (SDK Client ↔ InMemoryTransport ↔ the
 * per-principal Server this module builds):
 *
 *   1. Scope-filtered registration: read tools only for `read`, the chat tool
 *      only for `chat:propose`; unavailable tools are NOT advertised.
 *   2. §3.1 guarantee: even with EVERY scope, no execute/authorize/PIN-shaped
 *      tool exists — the registry is read + propose by construction.
 *   3. Defense in depth: dispatch re-checks the scope on every call.
 *   4. Per-tool happy paths + masked/gated outputs.
 *
 * The service is constructed directly with fakes for the cross-module deps
 * (buildReadTools/buildTransactionTools/buildChatTools close over them).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { UnsupportedAssetError } from '../../../core/catalog/catalog-errors';
import type { AssetRegistry } from '../../../core/catalog/asset-registry';
import type { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { ProfileService } from '../../identity/application/profile.service';
import type { IIdentityRepository } from '../../identity/application/ports/identity.repository.port';
import type { BalanceService } from '../../balances/application/balance.service';
import type { WalletService } from '../../wallets/application/wallet.service';
import type { BeneficiaryService } from '../../beneficiaries/application/beneficiary.service';
import type { TransactionHistoryService } from '../../transactions/application/transaction-history.service';
import type { QuotesService } from '../../quotes/application/quotes.service';
import type { RatesService } from '../../quotes/application/rates.service';
import type { WebChatService } from '../../chat/application/web-chat.service';
import type { ITransactionRepository } from '../../transactions/application/ports/transaction.repository.port';
import type { ISettlementRepository } from '../../transactions/application/ports/settlement.repository.port';
import type { IProposalRepository } from '../../transactions/application/ports/proposal.repository.port';

import { McpToolsService } from './mcp-tools.service';
import { dispatchToolCall } from './mcp-tool-dispatch';
import { buildReadTools } from './mcp-read-tools';
import type { McpToolDeps } from './mcp-tool-types';

// ---------------------------------------------------------------------------
// Fixtures / fakes
// ---------------------------------------------------------------------------

const USER_ID = 'aaaaaaaa-0000-7000-8000-000000000001';
const TX_ID = 'bbbbbbbb-0000-7000-8000-000000000002';

const READ_TOOL_NAMES = [
  'get_profile',
  'get_balances',
  'get_deposit_address',
  'get_capabilities',
  'list_beneficiaries',
  'quote_buy',
  'quote_sell',
  'get_rate',
  'list_rates',
  'list_transactions',
  'get_transaction',
  'list_pending_proposals',
];

const EFFECTIVE_RATE = {
  asset: 'USDT',
  fiatCurrency: 'NGN',
  buyRate: '1650.5',
  sellRate: '1600.25',
  source: 'config',
  asOf: '2026-07-09T00:00:00.000Z',
};

const PROFILE = {
  email: 'qa@example.com',
  fullName: 'QA User',
  phone: null,
  kycStatus: 'verified',
  kycTier: 'tier_1',
  fiatCurrency: 'NGN',
  limits: null,
};

const PUBLIC_VIEW = {
  fiats: [{ code: 'NGN', displayName: 'Naira', symbol: '₦', decimals: 2 }],
  assets: [
    { symbol: 'USDT', displayName: 'Tether', decimals: 6, networks: ['tron'] },
  ],
  networks: [{ id: 'tron', displayName: 'TRON' }],
  capabilities: { 'crypto.buy': true },
};

interface FakeOverrides {
  kycStatus?: string;
  kycTier?: string;
  chatOutcome?: Record<string, unknown>;
}

// Mirrors the real code-default gating map (configuration.ts): receive is tier_1.
const GATING = {
  capabilityMinTier: {
    'crypto.buy': 'tier_1',
    'crypto.receive': 'tier_1',
    'crypto.sell': 'tier_2',
    'crypto.send': 'tier_2',
    'crypto.swap': 'tier_2',
  },
};

function makeFakes(overrides: FakeOverrides = {}) {
  const profile = { getProfile: jest.fn().mockResolvedValue(PROFILE) };
  const balances = {
    getBalances: jest.fn().mockResolvedValue({
      fiatCurrency: 'NGN',
      balances: [{ asset: 'USDT', network: 'tron', amount: '12.5' }],
    }),
  };
  const wallets = {
    getOrProvisionNetworkWallet: jest
      .fn()
      .mockResolvedValue({ id: 'w1', address: 'TXYZaddr123456789' }),
  };
  const beneficiaries = {
    listForUser: jest.fn((_userId: string, type: string) =>
      Promise.resolve(
        type === 'bank_account'
          ? [
              {
                id: 'cccccccc-0000-7000-8000-000000000003',
                userId: USER_ID,
                type: 'bank_account',
                label: 'mum',
                accountNumber: '0123456789',
                accountHolderName: 'ADA OBI',
                bankCode: '058',
                cryptoAddress: null,
                cryptoAsset: null,
                cryptoNetwork: null,
                verificationStatus: 'verified',
                firstUseLockedUntil: null,
                verifiedAt: new Date('2026-07-01T00:00:00Z'),
                isDefault: true,
                createdAt: new Date('2026-07-01T00:00:00Z'),
                updatedAt: new Date('2026-07-01T00:00:00Z'),
                deletedAt: null,
              },
            ]
          : [],
      ),
    ),
  };
  const history = {
    query: jest.fn().mockResolvedValue({
      window: { from: 'f', to: 't', label: 'Today' },
      items: [],
      totalCount: 0,
      truncated: false,
      hasMore: false,
      nextCursor: null,
      txType: 'all',
      downloadUrl: 'https://x/statement?token=t',
    }),
    queryPage: jest.fn().mockResolvedValue({
      window: { from: 'f', to: 't', label: 'Frozen' },
      items: [],
      totalCount: 0,
      truncated: false,
      hasMore: false,
      nextCursor: null,
      txType: 'all',
      downloadUrl: 'https://x/statement?token=t',
    }),
  };
  const quotes = {
    quoteBuy: jest.fn().mockResolvedValue({ cryptoAmount: '3.21' }),
    quoteSell: jest.fn().mockResolvedValue({ netFiatAmount: '4900' }),
  };
  const rates = {
    getEffectiveRate: jest.fn().mockResolvedValue(EFFECTIVE_RATE),
    listEffectiveRates: jest
      .fn()
      .mockResolvedValue({ rates: [EFFECTIVE_RATE] }),
  };
  const chat = {
    handleMessage: jest.fn().mockResolvedValue({
      reply: { text: 'Your buy proposal is ready.' },
      outcome: overrides.chatOutcome ?? {
        kind: 'proposal',
        txType: 'buy',
        proposalId: 'dddddddd-0000-7000-8000-000000000004',
        confirmation: { fiatAmount: '5000', asset: 'USDT' },
      },
      conversationId: 'eeeeeeee-0000-7000-8000-000000000005',
      messageId: 'ffffffff-0000-7000-8000-000000000006',
    }),
  };
  const identityRepo = {
    loadUser: jest.fn().mockResolvedValue({
      id: USER_ID,
      kycStatus: overrides.kycStatus ?? 'verified',
      kycTier: overrides.kycTier ?? 'tier_1',
    }),
  };
  const config = {
    get: jest.fn((key: string) => (key === 'gating' ? GATING : undefined)),
  };
  const transactionRepo = {
    findById: jest.fn().mockResolvedValue({
      id: TX_ID,
      userId: USER_ID,
      type: 'buy',
      status: 'completed',
      metadata: {
        asset: 'USDT',
        cryptoAmount: '3.21',
        fiatAmount: '5000',
        fiatCurrency: 'NGN',
      },
      createdAt: new Date('2026-07-08T10:00:00Z'),
    }),
  };
  const settlementRepo = {
    findReceiptNumber: jest.fn().mockResolvedValue('HSK-2026-000123'),
  };
  const proposalRepo = {
    listPendingForUser: jest.fn().mockResolvedValue([
      {
        id: 'dddddddd-0000-7000-8000-000000000004',
        userId: USER_ID,
        conversationId: null,
        type: 'buy',
        status: 'pending',
        parameters: { secretInternal: 'never-shown' },
        parametersChecksum: 'x',
        quoteId: null,
        expiresAt: new Date('2026-07-08T12:05:00Z'),
        confirmedAt: null,
        createdAt: new Date('2026-07-08T11:59:00Z'),
      },
    ]),
  };
  const registry = {
    asset: jest.fn((symbol: string) => {
      if (symbol !== 'USDT') throw new UnsupportedAssetError(symbol);
      return { symbol: 'USDT', networks: ['tron'] };
    }),
    network: jest.fn((id: string) => ({ id })),
    defaultNetworkFor: jest.fn().mockReturnValue('tron'),
    publicView: jest.fn().mockReturnValue(PUBLIC_VIEW),
  };
  return {
    profile,
    balances,
    wallets,
    beneficiaries,
    history,
    quotes,
    rates,
    chat,
    identityRepo,
    transactionRepo,
    settlementRepo,
    proposalRepo,
    registry,
    config,
  };
}

function makeService(fakes: ReturnType<typeof makeFakes>): McpToolsService {
  return new McpToolsService(
    fakes.profile as unknown as ProfileService,
    fakes.balances as unknown as BalanceService,
    fakes.wallets as unknown as WalletService,
    fakes.beneficiaries as unknown as BeneficiaryService,
    fakes.history as unknown as TransactionHistoryService,
    fakes.quotes as unknown as QuotesService,
    fakes.rates as unknown as RatesService,
    fakes.chat as unknown as WebChatService,
    fakes.registry as unknown as AssetRegistry,
    fakes.identityRepo as unknown as IIdentityRepository,
    fakes.transactionRepo as unknown as ITransactionRepository,
    fakes.settlementRepo as unknown as ISettlementRepository,
    fakes.proposalRepo as unknown as IProposalRepository,
    fakes.config as unknown as EffectiveConfigService,
  );
}

/** Real MCP round-trip: client ↔ in-memory transport ↔ per-principal server. */
async function connect(
  service: McpToolsService,
  scopes: string[],
): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = service.buildServer({ userId: USER_ID, scopes });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'spec', version: '0.0.1' });
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

function textOf(result: CallToolResult): string {
  return (result.content[0] as { text: string }).text;
}

function payloadOf(result: CallToolResult): Record<string, unknown> {
  return JSON.parse(textOf(result)) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Scope-filtered registration
// ---------------------------------------------------------------------------

describe('McpToolsService — registration and scopes', () => {
  it("advertises exactly the read tools for scopes=['read'] (no chat tool)", async () => {
    const { client, close } = await connect(makeService(makeFakes()), ['read']);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [...READ_TOOL_NAMES].sort(),
    );
    await close();
  });

  it("advertises ONLY send_chat_message for scopes=['chat:propose']", async () => {
    const { client, close } = await connect(makeService(makeFakes()), [
      'chat:propose',
    ]);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['send_chat_message']);
    await close();
  });

  it('advertises all 13 tools with both scopes — and NONE is execute-shaped (§3.1)', async () => {
    const { client, close } = await connect(makeService(makeFakes()), [
      'read',
      'chat:propose',
    ]);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(13);
    for (const tool of tools) {
      // No execute/authorize/confirm/approve tool may EVER exist here (§3.1).
      expect(tool.name).not.toMatch(/execute|authoriz|confirm|approve|sign/i);
      // No tool accepts a PIN on this surface (§3.5).
      expect(JSON.stringify(tool.inputSchema)).not.toMatch(/"pin"/i);
    }
    await close();
  });

  it('rejects calling a registered-but-out-of-scope tool exactly like an unknown one', async () => {
    const fakes = makeFakes();
    const { client, close } = await connect(makeService(fakes), [
      'chat:propose',
    ]);
    const denied = await callTool(client, 'get_balances');
    expect(denied.isError).toBe(true);
    expect(textOf(denied)).toContain('Unknown or unavailable tool');
    const unknown = await callTool(client, 'not_a_tool');
    expect(textOf(unknown)).toContain('Unknown or unavailable tool');
    expect(fakes.balances.getBalances).not.toHaveBeenCalled();
    await close();
  });

  it('defense in depth: dispatch re-checks the scope even for a registered tool', async () => {
    const fakes = makeFakes();
    const tools = buildReadTools(fakes as unknown as McpToolDeps);
    // A principal WITHOUT `read` reaching the dispatcher directly (guard
    // misordering / future registration bug) must still be denied.
    const result = await dispatchToolCall(
      tools,
      { userId: USER_ID, scopes: [] },
      'get_balances',
      {},
    );
    expect(result.isError).toBe(true);
    expect(fakes.balances.getBalances).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------

describe('McpToolsService — read tools', () => {
  it('get_profile returns the profile projection for the principal user', async () => {
    const fakes = makeFakes();
    const { client, close } = await connect(makeService(fakes), ['read']);
    const result = await callTool(client, 'get_profile');
    expect(payloadOf(result)).toEqual(PROFILE);
    expect(fakes.profile.getProfile).toHaveBeenCalledWith(USER_ID);
    await close();
  });

  it('get_balances scopes to the requested asset', async () => {
    const fakes = makeFakes();
    const { client, close } = await connect(makeService(fakes), ['read']);
    await callTool(client, 'get_balances', { asset: 'USDT' });
    expect(fakes.balances.getBalances).toHaveBeenCalledWith(USER_ID, 'USDT');
    await close();
  });

  it('get_deposit_address provisions on the default network for a verified user', async () => {
    const fakes = makeFakes();
    const { client, close } = await connect(makeService(fakes), ['read']);
    const result = await callTool(client, 'get_deposit_address', {
      asset: 'USDT',
    });
    expect(payloadOf(result)).toEqual({
      asset: 'USDT',
      network: 'tron',
      address: 'TXYZaddr123456789',
    });
    expect(fakes.wallets.getOrProvisionNetworkWallet).toHaveBeenCalledWith(
      USER_ID,
      'tron',
    );
    await close();
  });

  it('get_deposit_address is tier-gated server-side (§3.3) — an unverified-tier user never provisions', async () => {
    // crypto.receive needs tier_1; an `unverified` tier fails the capability gate
    // (the check is tier-based now, not the stale kycStatus==='verified').
    const fakes = makeFakes({ kycTier: 'unverified' });
    const { client, close } = await connect(makeService(fakes), ['read']);
    const result = await callTool(client, 'get_deposit_address', {
      asset: 'USDT',
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('KYC verification is required');
    expect(fakes.wallets.getOrProvisionNetworkWallet).not.toHaveBeenCalled();
    await close();
  });

  it('get_deposit_address provisions for an email-verified tier_1 user whose kycStatus is not "verified" (redesign: tier-based gate)', async () => {
    const fakes = makeFakes({ kycTier: 'tier_1', kycStatus: 'not_started' });
    const { client, close } = await connect(makeService(fakes), ['read']);
    const result = await callTool(client, 'get_deposit_address', {
      asset: 'USDT',
    });
    expect(payloadOf(result)).toEqual({
      asset: 'USDT',
      network: 'tron',
      address: 'TXYZaddr123456789',
    });
    await close();
  });

  it('get_deposit_address surfaces the catalog validation error for an unknown asset', async () => {
    const fakes = makeFakes();
    const { client, close } = await connect(makeService(fakes), ['read']);
    const result = await callTool(client, 'get_deposit_address', {
      asset: 'DOGE',
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Unsupported or disabled asset "DOGE"');
    await close();
  });

  it('get_capabilities returns the schema-parsed public config view', async () => {
    const { client, close } = await connect(makeService(makeFakes()), ['read']);
    const result = await callTool(client, 'get_capabilities');
    expect(payloadOf(result)).toEqual(PUBLIC_VIEW);
    await close();
  });

  it('list_beneficiaries returns labels + MASKED details only (never the full destination)', async () => {
    const fakes = makeFakes();
    const { client, close } = await connect(makeService(fakes), ['read']);
    const result = await callTool(client, 'list_beneficiaries', {
      type: 'bank_account',
    });
    const payload = payloadOf(result) as {
      beneficiaries: Array<Record<string, unknown>>;
    };
    expect(payload.beneficiaries).toHaveLength(1);
    expect(payload.beneficiaries[0].label).toBe('mum');
    expect(payload.beneficiaries[0].detail).toContain('••6789');
    // The raw account number must NOT appear anywhere in the response.
    expect(textOf(result)).not.toContain('0123456789');
    await close();
  });

  it('quote_buy validates args through the shared contract schema (fiatCurrency defaulted)', async () => {
    const fakes = makeFakes();
    const { client, close } = await connect(makeService(fakes), ['read']);
    await callTool(client, 'quote_buy', { asset: 'USDT', fiatAmount: '5000' });
    expect(fakes.quotes.quoteBuy).toHaveBeenCalledWith({
      asset: 'USDT',
      fiatAmount: '5000',
      fiatCurrency: 'NGN',
    });
    const invalid = await callTool(client, 'quote_buy', {
      asset: 'NOPE',
      fiatAmount: '5000',
    });
    expect(invalid.isError).toBe(true);
    expect(textOf(invalid)).toContain('Invalid arguments');
    await close();
  });

  it('quote_sell delegates to the quotes service', async () => {
    const fakes = makeFakes();
    const { client, close } = await connect(makeService(fakes), ['read']);
    await callTool(client, 'quote_sell', {
      asset: 'USDT',
      cryptoAmount: '2.5',
    });
    expect(fakes.quotes.quoteSell).toHaveBeenCalledWith({
      asset: 'USDT',
      cryptoAmount: '2.5',
      fiatCurrency: 'NGN',
    });
    await close();
  });

  it('get_rate returns the folded buy+sell rate for a pair (fiatCurrency defaulted to NGN)', async () => {
    const fakes = makeFakes();
    const { client, close } = await connect(makeService(fakes), ['read']);
    const result = await callTool(client, 'get_rate', { asset: 'USDT' });
    expect(payloadOf(result)).toEqual(EFFECTIVE_RATE);
    // Default applied by the shared contract schema — mirrors quote_buy.
    expect(fakes.rates.getEffectiveRate).toHaveBeenCalledWith('USDT', 'NGN');
    await close();
  });

  it('get_rate rejects an unsupported asset through the shared contract schema', async () => {
    const fakes = makeFakes();
    const { client, close } = await connect(makeService(fakes), ['read']);
    const invalid = await callTool(client, 'get_rate', { asset: 'NOPE' });
    expect(invalid.isError).toBe(true);
    expect(textOf(invalid)).toContain('Invalid arguments');
    expect(fakes.rates.getEffectiveRate).not.toHaveBeenCalled();
    await close();
  });

  it('list_rates returns every enabled, priced pair (folded rates only)', async () => {
    const fakes = makeFakes();
    const { client, close } = await connect(makeService(fakes), ['read']);
    const result = await callTool(client, 'list_rates');
    expect(payloadOf(result)).toEqual({ rates: [EFFECTIVE_RATE] });
    expect(fakes.rates.listEffectiveRates).toHaveBeenCalledTimes(1);
    // The raw per-bps spread must never appear on this surface (§ Wave K).
    expect(textOf(result)).not.toMatch(/spread|bps/i);
    await close();
  });

  it('get_rate and list_rates are denied without the read scope', async () => {
    const fakes = makeFakes();
    const { client, close } = await connect(makeService(fakes), [
      'chat:propose',
    ]);
    const rate = await callTool(client, 'get_rate', { asset: 'USDT' });
    const list = await callTool(client, 'list_rates');
    expect(rate.isError).toBe(true);
    expect(list.isError).toBe(true);
    expect(fakes.rates.getEffectiveRate).not.toHaveBeenCalled();
    expect(fakes.rates.listEffectiveRates).not.toHaveBeenCalled();
    await close();
  });
});

// ---------------------------------------------------------------------------
// Transaction tools
// ---------------------------------------------------------------------------

describe('McpToolsService — transaction tools', () => {
  it('list_transactions runs a first-page window query', async () => {
    const fakes = makeFakes();
    const { client, close } = await connect(makeService(fakes), ['read']);
    await callTool(client, 'list_transactions', { period: 'today' });
    expect(fakes.history.query).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ period: 'today' }),
    );
    await close();
  });

  it('list_transactions cursor page requires the frozen from/to window', async () => {
    const fakes = makeFakes();
    const { client, close } = await connect(makeService(fakes), ['read']);
    const missing = await callTool(client, 'list_transactions', {
      cursor: 'abc',
    });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain('cursor page requires from and to');

    await callTool(client, 'list_transactions', {
      cursor: 'abc',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-08T00:00:00.000Z',
    });
    expect(fakes.history.queryPage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, cursor: 'abc' }),
    );
    await close();
  });

  it('get_transaction returns the status projection incl. receipt number', async () => {
    const fakes = makeFakes();
    const { client, close } = await connect(makeService(fakes), ['read']);
    const result = await callTool(client, 'get_transaction', {
      transactionId: TX_ID,
    });
    const payload = payloadOf(result);
    expect(payload).toMatchObject({
      id: TX_ID,
      type: 'buy',
      status: 'completed',
      direction: 'in',
      receiptNumber: 'HSK-2026-000123',
      cryptoAmount: '3.21',
      fiatCurrency: 'NGN',
    });
    await close();
  });

  it("get_transaction hides other users' transactions as not-found (no ownership disclosure)", async () => {
    const fakes = makeFakes();
    fakes.transactionRepo.findById.mockResolvedValue({
      id: TX_ID,
      userId: 'someone-else',
      type: 'buy',
      status: 'completed',
      metadata: {},
      createdAt: new Date(),
    });
    const { client, close } = await connect(makeService(fakes), ['read']);
    const result = await callTool(client, 'get_transaction', {
      transactionId: TX_ID,
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Transaction not found');
    await close();
  });

  it('get_transaction surfaces the recipient @handle as counterparty for an internal_transfer (direction out)', async () => {
    // An internal transfer's metadata carries no address/destination — only the
    // audit-snapshot recipientHandle. The projection must fall back to it so a
    // settled transfer shows the recipient identity, not a blank counterparty.
    const fakes = makeFakes();
    fakes.transactionRepo.findById.mockResolvedValue({
      id: TX_ID,
      userId: USER_ID,
      type: 'internal_transfer',
      status: 'completed',
      metadata: {
        asset: 'USDT',
        cryptoAmount: '3.00',
        recipientUserId: 'recipient-user-2',
        recipientHandle: '@ada',
      },
      createdAt: new Date('2026-07-08T10:00:00Z'),
    });
    const { client, close } = await connect(makeService(fakes), ['read']);
    const result = await callTool(client, 'get_transaction', {
      transactionId: TX_ID,
    });
    const payload = payloadOf(result);
    expect(payload).toMatchObject({
      id: TX_ID,
      type: 'internal_transfer',
      direction: 'out',
      counterparty: '@ada',
    });
    await close();
  });

  it('get_transaction surfaces the senderHandle counterparty + direction=in for a recipient internal_transfer row', async () => {
    // The RECIPIENT-side row snapshots direction:'in' and the SENDER's @handle.
    // The projection must honour the per-row direction and show "from @A".
    const fakes = makeFakes();
    fakes.transactionRepo.findById.mockResolvedValue({
      id: TX_ID,
      userId: USER_ID,
      type: 'internal_transfer',
      status: 'completed',
      metadata: {
        asset: 'USDT',
        cryptoAmount: '3.00',
        direction: 'in',
        role: 'recipient',
        senderUserId: 'sender-user-1',
        senderHandle: '@sam.pay',
      },
      createdAt: new Date('2026-07-15T10:00:00Z'),
    });
    const { client, close } = await connect(makeService(fakes), ['read']);
    const result = await callTool(client, 'get_transaction', {
      transactionId: TX_ID,
    });
    const payload = payloadOf(result);
    expect(payload).toMatchObject({
      id: TX_ID,
      type: 'internal_transfer',
      direction: 'in',
      counterparty: '@sam.pay',
    });
    await close();
  });

  it('list_pending_proposals lists lifecycle fields + web-app instruction — never raw parameters', async () => {
    const fakes = makeFakes();
    const { client, close } = await connect(makeService(fakes), ['read']);
    const result = await callTool(client, 'list_pending_proposals');
    const payload = payloadOf(result) as {
      proposals: Array<Record<string, unknown>>;
      instruction: string;
    };
    expect(payload.proposals[0]).toEqual({
      proposalId: 'dddddddd-0000-7000-8000-000000000004',
      type: 'buy',
      status: 'pending',
      createdAt: '2026-07-08T11:59:00.000Z',
      expiresAt: '2026-07-08T12:05:00.000Z',
    });
    expect(payload.instruction).toContain('Handshake web app');
    expect(textOf(result)).not.toContain('secretInternal');
    expect(fakes.proposalRepo.listPendingForUser).toHaveBeenCalledWith(
      USER_ID,
      expect.any(Date),
    );
    await close();
  });
});

// ---------------------------------------------------------------------------
// Chat tool
// ---------------------------------------------------------------------------

describe('McpToolsService — send_chat_message (chat:propose)', () => {
  it('runs the agent turn and returns the proposal outcome verbatim + confirm-on-web instruction', async () => {
    const fakes = makeFakes();
    const { client, close } = await connect(makeService(fakes), [
      'chat:propose',
    ]);
    const result = await callTool(client, 'send_chat_message', {
      text: 'buy 5k of USDT',
    });
    const payload = payloadOf(result);
    expect(fakes.chat.handleMessage).toHaveBeenCalledWith({
      userId: USER_ID,
      text: 'buy 5k of USDT',
      beneficiaryId: undefined,
    });
    expect(payload.outcome).toMatchObject({
      kind: 'proposal',
      proposalId: 'dddddddd-0000-7000-8000-000000000004',
      confirmation: { fiatAmount: '5000', asset: 'USDT' },
    });
    expect(payload.instruction).toContain(
      'cannot be executed from this integration',
    );
    await close();
  });

  it('omits the instruction for non-proposal outcomes', async () => {
    const fakes = makeFakes({
      chatOutcome: { kind: 'clarification', text: 'Which asset?' },
    });
    const { client, close } = await connect(makeService(fakes), [
      'chat:propose',
    ]);
    const payload = payloadOf(
      await callTool(client, 'send_chat_message', { text: 'buy' }),
    );
    expect(payload.instruction).toBeUndefined();
    expect(payload.outcome).toEqual({
      kind: 'clarification',
      text: 'Which asset?',
    });
    await close();
  });

  it('never leaks internals when the chat service fails unexpectedly', async () => {
    const fakes = makeFakes();
    fakes.chat.handleMessage.mockRejectedValue(
      new Error('pg: connection refused at 10.0.0.5:5432'),
    );
    const { client, close } = await connect(makeService(fakes), [
      'chat:propose',
    ]);
    const result = await callTool(client, 'send_chat_message', {
      text: 'buy 5k',
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).not.toContain('10.0.0.5');
    expect(textOf(result)).toContain('Something went wrong');
    await close();
  });
});
