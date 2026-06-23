import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

import type {
  ISanctionsScreener,
  SanctionsScreenInput,
  SanctionsScreenResult,
} from '../application/ports/sanctions-screener.port';

/**
 * Mock sanctions screener — the only adapter wired at launch (N2).
 *
 * Passes all addresses by default. Flags addresses that appear in a
 * configurable denylist (injected via constructor for testability; in
 * production use the SANCTIONS_DENYLIST env variable or config array).
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

  /**
   * @param denylist Optional array of addresses to flag. Defaults to
   *   `SANCTIONS_DENYLIST` env var (comma-separated) when not provided.
   */
  constructor(denylist?: string[]) {
    if (denylist !== undefined) {
      this.denylist = new Set(denylist);
    } else {
      // Parse from env: SANCTIONS_DENYLIST=addr1,addr2
      const raw = process.env['SANCTIONS_DENYLIST'] ?? '';
      this.denylist = new Set(
        raw
          .split(',')
          .map((a) => a.trim())
          .filter((a) => a.length > 0),
      );
    }
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
}
