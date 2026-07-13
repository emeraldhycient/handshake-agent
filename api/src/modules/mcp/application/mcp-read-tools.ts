/**
 * Read-scope MCP tools: profile, balances, deposit address, capabilities,
 * beneficiaries, quotes (Wave C), and rate discovery (Wave K — get_rate /
 * list_rates, folded spread-inclusive display rates, no money movement).
 *
 * Every tool is read-only or read-mostly (§3.1): quoting never moves money;
 * deposit-address provisioning mirrors the chat `receive_crypto` branch
 * (KYC-gated, idempotent get-or-provision of the user's OWN custodial
 * address). Beneficiary details are ALWAYS masked — never a full account
 * number or address on this surface.
 */

import { z } from 'zod';

import {
  GetRateInputSchema,
  ListRatesInputSchema,
  PublicConfigResponseSchema,
  QuoteBuyInputSchema,
  QuoteSellInputSchema,
} from '@handshake-agent/contracts';

import type { KycTier } from '@handshake-agent/contracts';

import { McpToolError } from '../domain/mcp-tool-error';
import { maskBeneficiaryDetail } from '../../beneficiaries/application/beneficiary-display';
import type { GatingConfig } from '../../../core/config/configuration';
import { meetsCapabilityMinTier } from '../../identity/domain/tier-order';
import { defineTool } from './mcp-tool-types';
import type { McpToolDefinition, McpToolDeps } from './mcp-tool-types';

const KYC_REQUIRED_MESSAGE =
  'KYC verification is required before a deposit address can be issued. Complete verification in the Handshake web app.';

const BENEFICIARY_TYPES = ['bank_account', 'crypto_address'] as const;

export function buildReadTools(deps: McpToolDeps): McpToolDefinition[] {
  return [
    defineTool({
      name: 'get_profile',
      description:
        "The user's profile: email, name, phone, KYC status/tier, display currency, and tier limits.",
      scope: 'read',
      inputSchema: z.object({}),
      handler: (_args, principal) => deps.profile.getProfile(principal.userId),
    }),

    defineTool({
      name: 'get_balances',
      description:
        "The user's crypto balances with fiat valuations. Optionally scope to a single asset symbol (e.g. USDT).",
      scope: 'read',
      inputSchema: z.object({ asset: z.string().optional() }),
      handler: (args, principal) =>
        deps.balances.getBalances(principal.userId, args.asset),
    }),

    defineTool({
      name: 'get_deposit_address',
      description:
        "The user's own custodial deposit address for an asset (provisioned on first use). KYC-verified users only.",
      scope: 'read',
      inputSchema: z.object({
        asset: z.string(),
        network: z.string().optional(),
      }),
      handler: async (args, principal) => {
        const user = await deps.identityRepo.loadUser(principal.userId);
        // Gate on the capability→min-tier ladder (crypto.receive = tier_1),
        // mirroring the web-chat `receive_crypto` gate — NOT the legacy
        // `kycStatus==='verified'` check, which the onboarding redesign made
        // stale (an email-verified tier_1 user has kycStatus='not_started' yet
        // may receive). Fails closed for `unverified` and any unconfigured
        // capability (meetsCapabilityMinTier → tier_2 floor).
        const capabilityMinTier =
          deps.config.get<GatingConfig>('gating')?.capabilityMinTier ?? {};
        if (
          user === null ||
          !meetsCapabilityMinTier(
            user.kycTier as KycTier,
            'crypto.receive',
            capabilityMinTier,
          )
        ) {
          throw new McpToolError(KYC_REQUIRED_MESSAGE);
        }
        // Registry validation throws typed catalog errors (client-safe copy).
        const assetMeta = deps.registry.asset(args.asset);
        const network =
          args.network ?? deps.registry.defaultNetworkFor(args.asset);
        deps.registry.network(network);
        if (!assetMeta.networks.includes(network)) {
          throw new McpToolError(
            `${args.asset} is not available on network "${network}". Supported: ${assetMeta.networks.join(', ')}.`,
          );
        }
        const wallet = await deps.wallets.getOrProvisionNetworkWallet(
          principal.userId,
          network,
        );
        return { asset: args.asset, network, address: wallet.address };
      },
    }),

    defineTool({
      name: 'get_capabilities',
      description:
        'Enabled fiat currencies, crypto assets, networks, and capability flags (the public platform config).',
      scope: 'read',
      inputSchema: z.object({}),
      // Same defense-in-depth parse as GET /config: strips unknown keys so
      // publicView() drift can never leak a secret field.
      handler: () =>
        Promise.resolve(
          PublicConfigResponseSchema.parse(deps.registry.publicView()),
        ),
    }),

    defineTool({
      name: 'list_beneficiaries',
      description:
        "The user's saved beneficiaries (labels + MASKED destination details only). Optionally filter by type.",
      scope: 'read',
      inputSchema: z.object({
        type: z.enum(BENEFICIARY_TYPES).optional(),
      }),
      handler: async (args, principal) => {
        const types = args.type ? [args.type] : [...BENEFICIARY_TYPES];
        const lists = await Promise.all(
          types.map((type) =>
            deps.beneficiaries.listForUser(principal.userId, type),
          ),
        );
        return {
          beneficiaries: lists.flat().map((beneficiary) => ({
            id: beneficiary.id,
            type: beneficiary.type,
            label: beneficiary.label,
            // Human-safe mask — NEVER the full account number / address.
            detail: maskBeneficiaryDetail(beneficiary),
            isDefault: beneficiary.isDefault,
            createdAt: beneficiary.createdAt.toISOString(),
          })),
        };
      },
    }),

    defineTool({
      name: 'quote_buy',
      description:
        'Itemized buy quote (crypto received for a fiat amount, all-in pricing). Read-only — no funds move.',
      scope: 'read',
      inputSchema: QuoteBuyInputSchema,
      handler: (args) => deps.quotes.quoteBuy(args),
    }),

    defineTool({
      name: 'quote_sell',
      description:
        'Itemized sell quote (net fiat received for a crypto amount, all-in pricing). Read-only — no funds move.',
      scope: 'read',
      inputSchema: QuoteSellInputSchema,
      handler: (args) => deps.quotes.quoteSell(args),
    }),

    defineTool({
      name: 'get_rate',
      description:
        "The effective buy and sell rate for one asset/fiat pair — each a single spread-inclusive number (what a buyer pays / a seller receives per unit). 'source' flags live-feed vs config floor. Read-only — no funds move.",
      scope: 'read',
      inputSchema: GetRateInputSchema,
      handler: (args) =>
        deps.rates.getEffectiveRate(args.asset, args.fiatCurrency),
    }),

    defineTool({
      name: 'list_rates',
      description:
        'The effective buy and sell rates for every enabled, tradeable asset/fiat pair (spread-inclusive folded numbers). Read-only — no funds move.',
      scope: 'read',
      inputSchema: ListRatesInputSchema,
      handler: () => deps.rates.listEffectiveRates(),
    }),
  ];
}
