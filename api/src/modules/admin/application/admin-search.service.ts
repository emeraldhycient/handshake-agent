import { Injectable } from '@nestjs/common';

import type { AdminSearchResponse } from '@handshake-agent/contracts';

import { AdminEndUserService } from './admin-end-user.service';
import { AdminTxnOversightService } from './admin-txn-oversight.service';

/** Below this length a query is too broad to be useful — return nothing. */
const MIN_QUERY_LENGTH = 2;
/** Per-entity result cap (keeps the palette snappy + the response small). */
const PER_ENTITY_LIMIT = 5;

/**
 * Global admin search (go-readiness #14). Composes the existing end-user + txn
 * oversight read services (both already support a free-text term) into one unified
 * result set the ⌘K palette renders. READ-ONLY — every result is an in-app href;
 * nothing here moves money (§3.1). Labels use displayName/email, never raw PII (§3.4).
 */
@Injectable()
export class AdminSearchService {
  constructor(
    private readonly endUsers: AdminEndUserService,
    private readonly txns: AdminTxnOversightService,
  ) {}

  async search(q: string): Promise<AdminSearchResponse> {
    const term = q.trim();
    if (term.length < MIN_QUERY_LENGTH) return { results: [] };

    const [users, txns] = await Promise.all([
      this.endUsers.list({ query: term, limit: PER_ENTITY_LIMIT }),
      this.txns.list({ q: term, limit: PER_ENTITY_LIMIT }),
    ]);

    return {
      results: [
        ...users.items.map((u) => ({
          kind: 'user' as const,
          href: `/users/${u.id}`,
          label: u.displayName || u.email || u.id,
          sublabel: `User · ${u.kycTier}`,
        })),
        ...txns.items.map((t) => ({
          kind: 'transaction' as const,
          href: `/transactions/${t.id}`,
          label: t.amount
            ? `${t.type} · ${t.amount}${t.asset ? ` ${t.asset}` : ''}`
            : t.type,
          sublabel: `Transaction · ${t.userEmail ?? t.id.slice(0, 8)}`,
        })),
      ],
    };
  }
}
