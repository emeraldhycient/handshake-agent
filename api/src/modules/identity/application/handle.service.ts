/**
 * HandleService — the global handle resolver + public-nickname CRUD + PayID
 * change (Spec 2: PayID + public nicknames + internal transfer).
 *
 * `resolveHandle` is a SERVER-SIDE lookup-key resolver (root CLAUDE.md §3.1):
 * it turns an `@handle` into a `userId` + a name-minimal display name, never
 * a destination the model can spoof. It mirrors
 * `beneficiaryService.resolveByNickname`'s "lookup key, never a destination"
 * contract, but resolves GLOBALLY to any Handshake user, not just the
 * caller's own saved beneficiaries — consumed by the chat send path (Task 9)
 * to route `@`-prefixed recipients to the internal-transfer rail.
 *
 * PayID and public nicknames share ONE namespace (design §4.2): claiming a
 * nickname or renaming a PayID must check BOTH `User.payId` and
 * `PublicAlias.alias` before writing. The per-table `lower(...)` unique index
 * (see the Task-2 migration) closes the check-then-act race — the repository
 * translates that DB-level collision into `HandleTakenError`.
 */

import { Inject, Injectable } from '@nestjs/common';

import { normalizeHandle, PayIdSchema } from '@handshake-agent/contracts';

import {
  HandleTakenError,
  NicknameCapError,
  PayIdAlreadyChangedError,
} from '../domain/handle-errors';
import {
  HANDLE_REPOSITORY,
  type HandleOwnerRecord,
  type IHandleRepository,
  type PublicNicknameRecord,
} from './ports/handle.repository.port';

/**
 * ≤5 public nicknames per user — a fixed anti-abuse ceiling specified by the
 * design (not a DB-admin setting; unlike KYC-tier limits this isn't a
 * business lever ops needs to tune without a deploy, root CLAUDE.md §7).
 */
const MAX_PUBLIC_NICKNAMES = 5;

export interface ResolvedHandle {
  userId: string;
  displayName: string;
  handle: string;
}

@Injectable()
export class HandleService {
  constructor(
    @Inject(HANDLE_REPOSITORY) private readonly repo: IHandleRepository,
  ) {}

  /**
   * Resolves a user-supplied handle (e.g. "@Ada", case-insensitive) to its
   * owner. Checks PayId first, then public nicknames. Returns null on a
   * miss — callers (Task 9) must surface a clarification, NEVER fall through
   * to a default recipient (§3.1 no-misroute).
   */
  async resolveHandle(handle: string): Promise<ResolvedHandle | null> {
    const normalized = normalizeHandle(handle);
    if (normalized === '') return null;

    const owner =
      (await this.repo.findUserByPayId(normalized)) ??
      (await this.repo.findAliasOwner(normalized));
    if (!owner) return null;

    return {
      userId: owner.userId,
      displayName: this.minimalRevealName(owner),
      handle: owner.handle,
    };
  }

  /**
   * Claims a new public nickname for the user: `firstName + ' ' + lastName +
   * '.'` minimal reveal. Format-validates, then enforces the shared
   * namespace + the ≤5 cap, in that order (design §4.2 / task brief).
   */
  async addPublicNickname(
    userId: string,
    alias: string,
  ): Promise<PublicNicknameRecord> {
    const normalized = PayIdSchema.parse(normalizeHandle(alias));

    await this.assertHandleAvailable(normalized);

    // Best-effort ≤5 cap (read-count-then-insert). This is a benign TOCTOU
    // under true concurrency — see IHandleRepository.countPublicNicknames. The
    // cap is an anti-abuse ceiling, not a funds/identity invariant (§3.1), so a
    // rare transient 6th row is acceptable; not worth a serialized row-lock.
    const count = await this.repo.countPublicNicknames(userId);
    if (count >= MAX_PUBLIC_NICKNAMES) {
      throw new NicknameCapError(MAX_PUBLIC_NICKNAMES);
    }

    return this.repo.createPublicNickname(userId, normalized);
  }

  /** Removes a public nickname. No PIN — it moves no money, §3.1. */
  async removePublicNickname(userId: string, id: string): Promise<void> {
    await this.repo.deletePublicNickname(userId, id);
  }

  async listPublicNicknames(userId: string): Promise<PublicNicknameRecord[]> {
    return this.repo.listPublicNicknames(userId);
  }

  /**
   * Changes the caller's PayID. One-change guard first (independent of
   * availability — a second attempt is rejected even if the new value is
   * free), then the shared-namespace check, then the write.
   */
  async changePayId(userId: string, payId: string): Promise<void> {
    const normalized = PayIdSchema.parse(normalizeHandle(payId));

    // Fast-path read: reject an obvious second change early (and gives the
    // one-change error precedence over the shared-namespace check). This is
    // NOT the real guard — a concurrent pair could both pass here.
    const changedAt = await this.repo.getPayIdChangedAt(userId);
    if (changedAt !== null) {
      throw new PayIdAlreadyChangedError();
    }

    await this.assertHandleAvailable(normalized);

    // Real guard: the conditional write only succeeds when payIdChangedAt is
    // still null. A concurrent second change that passed the stale read above
    // loses here (count === 0 → written === false) and is rejected atomically.
    const written = await this.repo.setPayId(userId, normalized);
    if (!written) {
      throw new PayIdAlreadyChangedError();
    }
  }

  /**
   * Shared-namespace check (design §4.2): a handle must be free across BOTH
   * User.payId and PublicAlias.alias before it can be claimed by either.
   */
  private async assertHandleAvailable(normalized: string): Promise<void> {
    const [payIdTaken, aliasTaken] = await Promise.all([
      this.repo.isPayIdTaken(normalized),
      this.repo.isAliasTaken(normalized),
    ]);
    if (payIdTaken || aliasTaken) {
      throw new HandleTakenError(normalized);
    }
  }

  /**
   * Minimal reveal: first name + last-initial (root spec §4.2), like a bank
   * name-enquiry. Falls back to the handle itself when no KYC name is on
   * file yet (e.g. a tier_1 account that has claimed a PayID pre-KYC).
   */
  private minimalRevealName(owner: HandleOwnerRecord): string {
    if (!owner.firstName) return owner.handle;
    const lastInitial = owner.lastName ? `${owner.lastName[0]}.` : '';
    return `${owner.firstName} ${lastInitial}`.trim();
  }
}
