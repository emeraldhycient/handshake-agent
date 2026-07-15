import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { AppConfig } from '../../../core/config/configuration';
import type {
  ISanctionsScreener,
  SanctionsScreenIdentityInput,
  SanctionsScreenInput,
  SanctionsScreenResult,
} from '../application/ports/sanctions-screener.port';

/**
 * Mock sanctions screener — the only adapter wired at launch (N2).
 *
 * Passes all addresses by default. Flags addresses that appear in the
 * `compliance.sanctionsDenylist` config array (see
 * `api/src/core/config/configuration.ts`).  The denylist is tunable via
 * EffectiveConfigService / AppSetting (root CLAUDE.md §7) — an admin override
 * flows through the same `get('compliance')` read.  Injecting the service
 * (instead of a bare `string[]`) lets Nest DI construct this class when it is
 * bound via `useClass` in `ComplianceModule` — a bare constructor parameter of
 * type `Array` has no DI token and causes:
 *   "Nest can't resolve dependencies of the MockSanctionsScreener (?)"
 *
 * A real provider (OpenSanctions, TRM, etc.) will implement
 * `ISanctionsScreener` and be swapped in by changing the `SANCTIONS_SCREENER`
 * binding in `ComplianceModule` — same isolation pattern as `MockKycProvider`.
 *
 * `SANCTIONS_MOCK_MODE` is read from env as an operational documentation guard
 * only — the module binding selects the adapter; the flag signals to operators
 * that the real provider is not yet active.
 */
@Injectable()
export class MockSanctionsScreener implements ISanctionsScreener {
  private readonly denylist: ReadonlySet<string>;

  constructor(private readonly config: EffectiveConfigService) {
    const list =
      this.config.get<AppConfig['compliance']>('compliance')
        ?.sanctionsDenylist ?? [];
    this.denylist = new Set(list);
  }

  screen(input: SanctionsScreenInput): Promise<SanctionsScreenResult> {
    const reference = `mock-sanctions-${randomUUID().slice(0, 8)}`;

    if (this.denylist.has(input.address)) {
      return Promise.resolve({
        passed: false,
        reason: 'sanctioned address',
        provider: 'mock',
        reference,
      });
    }

    return Promise.resolve({
      passed: true,
      provider: 'mock',
      reference,
    });
  }

  /**
   * Identity screen for internal-transfer counterparties (Task 8). Keys on the
   * subject `userId` against the SAME `sanctionsDenylist` config the address
   * screen uses — so a test/admin can force a block by denylisting a userId.
   * Non-throwing.
   */
  screenIdentity(
    input: SanctionsScreenIdentityInput,
  ): Promise<SanctionsScreenResult> {
    const reference =
      input.reference ?? `mock-sanctions-${randomUUID().slice(0, 8)}`;

    if (this.denylist.has(input.userId)) {
      return Promise.resolve({
        passed: false,
        reason: 'sanctioned identity',
        provider: 'mock',
        reference,
      });
    }

    return Promise.resolve({
      passed: true,
      provider: 'mock',
      reference,
    });
  }
}
