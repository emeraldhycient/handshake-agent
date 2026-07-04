import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type {
  AdminCustomFiat,
  AdminCustomFiatCreateRequest,
  AdminCustomFiatListResponse,
  AdminCustomFiatUpdateRequest,
} from '@handshake-agent/contracts';

import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { AuditService } from '../../../core/audit/application/audit.service';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import { AdminNotFoundError } from '../domain/admin-errors';
import { CurrencyCollisionError } from '../domain/currency-errors';
import { MultiCurrencyInvariantError } from '../domain/settings-errors';
import { CustomFiatSyncService } from './custom-fiat-sync.service';
import {
  CUSTOM_FIAT_REPOSITORY,
  type CustomFiatRecord,
  type ICustomFiatRepository,
} from './ports/custom-fiat.repository.port';

/** Minimal shape of the `pricing` config section the base-rate check consults. */
interface PricingSnapshot {
  assets?: Record<string, { baseRates?: Record<string, number> }>;
}

/**
 * AdminCurrencyService — the runtime "Add currency" CRUD (CLAUDE.md §7). An operator
 * adds a fiat currency, edits its display metadata, and enables/disables it. A custom
 * currency moves NO money (§3.1): it is a catalog entry published to the money path via
 * the AssetRegistry overlay (CustomFiatSyncService) — it stays fail-closed exactly like
 * a built-in fiat.
 *
 * Funds-safety invariants enforced here (server-side, §3.3):
 *   - `add` rejects a code that collides with a BUILT-IN catalog fiat (the registry's
 *     recognised set) or an existing custom fiat — a custom fiat may never shadow a
 *     platform currency. The currency is created DISABLED and only becomes live after
 *     pricing is configured and it is explicitly enabled.
 *   - `update` with `enabled: true` is FAIL-CLOSED: rejected unless pricing exists for
 *     the currency (a base rate keyed by its code on at least one priced asset) — the
 *     same "an enabled currency must be transactable" invariant the settings console
 *     enforces for built-in fiats. Disabling / metadata edits skip the pricing check.
 *
 * Every write is immutably audited (`admin_update`, subject `Currency:<code>`, actor
 * threaded from the principal) and republishes the overlay via CustomFiatSyncService so
 * the money path sees the change without a restart. Holds no Prisma import — reaches the
 * DB only through the injected port (§3.2).
 */
@Injectable()
export class AdminCurrencyService {
  constructor(
    @Inject(CUSTOM_FIAT_REPOSITORY)
    private readonly repo: ICustomFiatRepository,
    private readonly registry: AssetRegistry,
    private readonly effectiveConfig: EffectiveConfigService,
    private readonly audit: AuditService,
    private readonly sync: CustomFiatSyncService,
  ) {}

  /** All runtime custom currencies (newest-first), mapped to the wire shape. Read-only. */
  async list(): Promise<AdminCustomFiatListResponse> {
    const rows = await this.repo.listAll();
    return { items: rows.map(toWire) };
  }

  /**
   * Add a runtime currency. Rejects a code that collides with a built-in catalog fiat
   * or an existing custom fiat; otherwise creates it DISABLED, audits the add, and
   * republishes the overlay. The actor becomes `addedByAdminId` (from the principal).
   */
  async add(
    input: AdminCustomFiatCreateRequest,
    adminId: string,
  ): Promise<AdminCustomFiat> {
    const code = input.code;

    // Collision: a built-in catalog fiat (or an already-known custom overlay code)…
    if (this.registry.supportedFiats().includes(code)) {
      throw new CurrencyCollisionError(code);
    }
    // …or an existing custom-fiat row not yet reflected in the overlay.
    if ((await this.repo.findByCode(code)) !== null) {
      throw new CurrencyCollisionError(code);
    }

    const created = await this.repo.create({
      code,
      displayName: input.displayName,
      symbol: input.symbol,
      decimals: input.decimals,
      addedByAdminId: adminId,
    });

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `Currency:${code}`,
      action: 'admin_update',
      after: {
        operation: 'add',
        code,
        displayName: input.displayName,
        symbol: input.symbol,
        decimals: input.decimals,
        enabled: false,
      },
    });

    // Publish the new (disabled) currency to the money path.
    await this.sync.sync();

    return toWire(created);
  }

  /**
   * Update a runtime currency — enable/disable and/or edit display metadata. Enabling
   * is FAIL-CLOSED: rejected unless the currency has pricing (a base rate keyed by its
   * code). An unknown code fails closed (404). Applies the patch, audits it, and
   * republishes the overlay.
   */
  async update(
    code: string,
    patch: AdminCustomFiatUpdateRequest,
    adminId: string,
  ): Promise<AdminCustomFiat> {
    const before = await this.repo.findByCode(code);
    if (before === null) throw new AdminNotFoundError('Currency');

    // Fail-closed: enabling requires pricing (re-checked server-side, §3.3).
    if (patch.enabled === true) this.assertPricingExists(code);

    const updated = await this.repo.update(code, {
      ...(patch.enabled !== undefined && { enabled: patch.enabled }),
      ...(patch.displayName !== undefined && {
        displayName: patch.displayName,
      }),
      ...(patch.symbol !== undefined && { symbol: patch.symbol }),
      ...(patch.decimals !== undefined && { decimals: patch.decimals }),
    });

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `Currency:${code}`,
      action: 'admin_update',
      before: {
        displayName: before.displayName,
        symbol: before.symbol,
        decimals: before.decimals,
        enabled: before.enabled,
      },
      after: {
        operation: 'update',
        displayName: updated.displayName,
        symbol: updated.symbol,
        decimals: updated.decimals,
        enabled: updated.enabled,
      },
    });

    // Republish so a toggled/edited currency reaches the money path immediately.
    await this.sync.sync();

    return toWire(updated);
  }

  /**
   * Fail-closed pricing gate: a currency may only be enabled when at least one priced
   * asset carries a base rate keyed by the currency code (`pricing.assets.<asset>.
   * baseRates.<CODE>`) — mirrors the multi-currency invariant the settings console
   * applies to built-in fiats. Throws MultiCurrencyInvariantError (→ 422) otherwise.
   */
  private assertPricingExists(code: string): void {
    const pricing = this.effectiveConfig.get<PricingSnapshot>('pricing');
    const assets = pricing?.assets ?? {};
    const hasRate = Object.values(assets).some(
      (a) => a?.baseRates?.[code] !== undefined,
    );
    if (!hasRate) {
      throw new MultiCurrencyInvariantError(
        `Currency "${code}" cannot be enabled until a base rate is configured for it.`,
      );
    }
  }
}

// ── mapper (record → contract shape) ──────────────────────────────────────────────

/** Projects a persisted custom-fiat record into the wire `AdminCustomFiat` shape. */
function toWire(row: CustomFiatRecord): AdminCustomFiat {
  return {
    code: row.code,
    displayName: row.displayName,
    symbol: row.symbol,
    decimals: row.decimals,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
  };
}
