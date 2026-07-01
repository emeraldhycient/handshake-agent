import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import {
  BroadcastAudienceSchema,
  CreateManualCreditRequestSchema,
  type ChangeRequest,
  type ChangeRequestInboxResponse,
  type CreateChangeRequest,
} from '@handshake-agent/contracts';

import { AuditService } from '../../../core/audit/application/audit.service';
import { CLOCK, type Clock } from '../../../core/common/clock';
import type { AppSettingScope } from '../../../core/config/application/ports/app-setting.repository.port';
import { AdminNotFoundError } from '../domain/admin-errors';
import {
  ChangeRequestNotApplicableError,
  ChangeRequestNotPendingError,
  SelfApprovalForbiddenError,
} from '../domain/approvals-errors';
import {
  CHANGE_REQUEST_REPOSITORY,
  type ChangeRequestRecord,
  type IChangeRequestRepository,
} from './ports/change-request.repository.port';
import {
  BROADCAST_DISPATCH_REPOSITORY,
  type IBroadcastDispatchRepository,
} from './ports/broadcast-dispatch.repository.port';
import { AdminSettingsService } from './admin-settings.service';
import { AdminTxnTriageService } from './admin-txn-triage.service';
import { AdminManualCreditService } from './admin-manual-credit.service';

/**
 * ADM Phase 7 — the maker-checker APPROVALS engine. This is a FUNDS-SAFETY-CRITICAL
 * surface, so it upholds the §3.1 invariant absolutely: it NEVER writes a ledger
 * entry or mutates a target resource directly. A change is captured as a pending
 * ChangeRequest by one admin (the maker); a DIFFERENT admin approves it (four-eyes —
 * self-approval is forbidden), at which point the change is RE-EXECUTED through the
 * target service's own existing atomic, idempotent, audited path:
 *   - pricing_change / capability_flip / tier_override → AdminSettingsService.update
 *     (layered-config write + hot-reload + config_change audit);
 *   - refund → AdminTxnTriageService.markFailedAndRefund (the engine's atomic
 *     settle{Sell,Send,Swap}RefundAtomic reserve reversal).
 * The decision row is flipped ONLY after the apply succeeds, via a conditional
 * "decide-if-pending" update that guards against a double-decision race — so a
 * change is applied at most once. Every decision is immutably audited.
 *
 * The service holds no Prisma import; it reaches the DB only through the injected
 * change-request port and the two target application services (§3.2).
 */
@Injectable()
export class AdminApprovalsService {
  constructor(
    @Inject(CHANGE_REQUEST_REPOSITORY)
    private readonly repo: IChangeRequestRepository,
    private readonly settings: AdminSettingsService,
    private readonly triage: AdminTxnTriageService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BROADCAST_DISPATCH_REPOSITORY)
    private readonly broadcast: IBroadcastDispatchRepository,
    private readonly manualCredit: AdminManualCreditService,
  ) {}

  /**
   * Raise a pending change request. This NEVER applies the change — it only records
   * the intent for a second admin to review. Audited as `admin_update` (a request,
   * not yet an override). The maker is the actor.
   */
  async create(
    input: CreateChangeRequest,
    requestedByAdminId: string,
  ): Promise<ChangeRequest> {
    const record = await this.repo.create({
      kind: input.kind,
      resource: input.resource,
      payload: input.payload,
      reason: input.reason,
      requestedByAdminId,
    });

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: requestedByAdminId,
      subject: `ChangeRequest:${record.id}`,
      action: 'admin_update',
      after: {
        kind: record.kind,
        resource: record.resource,
        reason: record.reason,
        status: 'pending',
      },
    });

    return this.toView(record);
  }

  /**
   * Approve a pending request AND apply its change atomically through the target
   * service. Enforces four-eyes (the requester cannot approve their own request)
   * BEFORE anything is applied. Applies first, then records the terminal decision
   * with a conditional update (so a lost race yields NOT-pending, never a
   * double-apply), then audits an `admin_override`.
   */
  async approve(id: string, decidedByAdminId: string): Promise<ChangeRequest> {
    const record = await this.loadPendingForDecision(id, decidedByAdminId);

    // Apply the change through the target's existing atomic path (§3.1) FIRST.
    // If this throws, we never record a decision — no half-applied state.
    await this.applyChange(record, decidedByAdminId);

    const decidedAt = this.clock.now();
    const decided = await this.repo.decideIfPending({
      id: record.id,
      status: 'approved',
      decidedByAdminId,
      decisionReason: null,
      decidedAt,
    });
    // The conditional update returns null iff the row was no longer pending — a
    // concurrent decision won the race. Surface it as a conflict (idempotent).
    if (decided === null) throw new ChangeRequestNotPendingError('decided');

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: decidedByAdminId,
      subject: `ChangeRequest:${record.id}`,
      action: 'admin_override',
      before: { status: 'pending' },
      after: {
        status: 'approved',
        kind: record.kind,
        resource: record.resource,
      },
    });

    return this.toView(decided);
  }

  /**
   * Reject a pending request with a reason. Applies NOTHING. Enforces four-eyes,
   * records the terminal decision (race-guarded), and audits an `admin_update`.
   */
  async reject(
    id: string,
    decidedByAdminId: string,
    reason: string,
  ): Promise<ChangeRequest> {
    const record = await this.loadPendingForDecision(id, decidedByAdminId);

    const decided = await this.repo.decideIfPending({
      id: record.id,
      status: 'rejected',
      decidedByAdminId,
      decisionReason: reason,
      decidedAt: this.clock.now(),
    });
    if (decided === null) throw new ChangeRequestNotPendingError('decided');

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: decidedByAdminId,
      subject: `ChangeRequest:${record.id}`,
      action: 'admin_update',
      before: { status: 'pending' },
      after: { status: 'rejected', reason },
    });

    return this.toView(decided);
  }

  /**
   * The approvals inbox: `awaitingMe` (pending requests this admin may decide —
   * i.e. NOT their own, since self-approval is forbidden) and `myRequests` (every
   * request this admin raised, any status), plus counts for the nav badge.
   */
  async inbox(adminId: string): Promise<ChangeRequestInboxResponse> {
    const [pending, mine] = await Promise.all([
      this.repo.listPending(),
      this.repo.listByRequester(adminId),
    ]);

    const awaitingMe = pending.filter((r) => r.requestedByAdminId !== adminId);
    const myPending = mine.filter((r) => r.status === 'pending').length;

    const awaitingMeViews = await this.toViews(awaitingMe);
    const myViews = await this.toViews(mine);

    return {
      awaitingMe: awaitingMeViews,
      myRequests: myViews,
      counts: {
        awaitingMe: awaitingMe.length,
        myRequests: mine.length,
        myPending,
      },
    };
  }

  // ── private ────────────────────────────────────────────────────────────────────

  /** Load a request, enforce existence, four-eyes, and pending-status guards. */
  private async loadPendingForDecision(
    id: string,
    decidedByAdminId: string,
  ): Promise<ChangeRequestRecord> {
    const record = await this.repo.findById(id);
    if (record === null) throw new AdminNotFoundError('Change request');

    // Four-eyes: the maker can never be the checker — enforce BEFORE any apply.
    if (record.requestedByAdminId === decidedByAdminId) {
      throw new SelfApprovalForbiddenError();
    }
    if (record.status !== 'pending') {
      throw new ChangeRequestNotPendingError(record.status);
    }
    return record;
  }

  /** Dispatch to the target service's atomic path by kind (never a raw write). */
  private async applyChange(
    record: ChangeRequestRecord,
    decidedByAdminId: string,
  ): Promise<void> {
    switch (record.kind) {
      case 'pricing_change':
      case 'capability_flip':
      case 'tier_override':
        await this.applyConfigChange(record, decidedByAdminId);
        return;
      case 'refund':
        await this.applyRefund(record, decidedByAdminId);
        return;
      case 'manual_credit':
        await this.applyManualCredit(record, decidedByAdminId);
        return;
      case 'payout_release':
        await this.applyPayoutRelease(record, decidedByAdminId);
        return;
      case 'notification_broadcast':
        await this.applyBroadcast(record);
        return;
    }
  }

  /**
   * Apply an approved payout release by RE-DRIVING the offending payout's settlement
   * through the engine-brokered triage path — it re-enqueues the settlement outbox
   * for the reconciliation worker, which releases the payout via the engine's atomic
   * settle path. Never a raw ledger write (§3.1). The payload must carry a
   * `transactionId`; fails closed on a missing id (§3.6).
   */
  private async applyPayoutRelease(
    record: ChangeRequestRecord,
    decidedByAdminId: string,
  ): Promise<void> {
    const transactionId = record.payload.transactionId;
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
      throw new ChangeRequestNotApplicableError(
        'payload.transactionId is missing or not a string',
      );
    }
    await this.triage.retrySettlement(transactionId, decidedByAdminId);
  }

  /**
   * Apply an approved LARGE-audience broadcast (§3.5) by RE-RUNNING the same
   * notifications-outbox enqueue the direct-send path uses — never a raw send. The
   * payload must carry `audience` + `templateKey`; the enqueue is idempotent on the
   * change-request id, so approving twice never double-blasts. Moves no money (§3.1).
   * Fails closed on a malformed payload — never guesses an audience or template.
   */
  private async applyBroadcast(record: ChangeRequestRecord): Promise<void> {
    const audience = record.payload.audience;
    const templateKey = record.payload.templateKey;
    if (typeof audience !== 'string' || audience.length === 0) {
      throw new ChangeRequestNotApplicableError(
        'payload.audience is missing or not a string',
      );
    }
    if (typeof templateKey !== 'string' || templateKey.length === 0) {
      throw new ChangeRequestNotApplicableError(
        'payload.templateKey is missing or not a string',
      );
    }
    const schedule = record.payload.schedule;
    const sendAt =
      isScheduledPayload(schedule) && typeof schedule.sendAt === 'string'
        ? schedule.sendAt
        : null;

    const parsed = BroadcastAudienceSchema.safeParse(audience);
    if (!parsed.success) {
      throw new ChangeRequestNotApplicableError(
        `payload.audience '${audience}' is not a known cohort`,
      );
    }

    await this.broadcast.enqueueBroadcast({
      // The change-request id anchors idempotency — an approved-twice race yields a
      // no-op enqueue (skipDuplicates on the derived per-recipient eventRef).
      broadcastId: record.id,
      audience: parsed.data,
      templateKey,
      templateVars: { audience, templateKey, reason: record.reason },
      sendAt,
    });
  }

  /**
   * Apply a config-backed change (pricing / capability flag / tier limit) via the
   * layered-config service, which validates, persists, hot-reloads and audits. The
   * payload must carry a `key` + `value`; `scope`/`scopeValue` default to global.
   * Fails closed on a malformed payload — never guesses a key or value (§3.6).
   */
  private async applyConfigChange(
    record: ChangeRequestRecord,
    decidedByAdminId: string,
  ): Promise<void> {
    const key = record.payload.key;
    if (typeof key !== 'string' || key.length === 0) {
      throw new ChangeRequestNotApplicableError(
        'payload.key is missing or not a string',
      );
    }
    if (!('value' in record.payload)) {
      throw new ChangeRequestNotApplicableError('payload.value is missing');
    }
    const scope = this.readScope(record.payload.scope);
    const scopeValue =
      typeof record.payload.scopeValue === 'string'
        ? record.payload.scopeValue
        : null;

    await this.settings.update(
      key,
      record.payload.value,
      scope,
      scopeValue,
      decidedByAdminId,
    );
  }

  /**
   * Apply a refund via the engine-brokered triage service — the ONLY money path.
   * The payload must carry a `transactionId`. The reserve reversal is done by the
   * engine's atomic `settle{Sell,Send,Swap}RefundAtomic`; nothing here touches the
   * ledger (§3.1). Fails closed on a missing transaction id.
   */
  private async applyRefund(
    record: ChangeRequestRecord,
    decidedByAdminId: string,
  ): Promise<void> {
    const transactionId = record.payload.transactionId;
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
      throw new ChangeRequestNotApplicableError(
        'payload.transactionId is missing or not a string',
      );
    }
    const reason =
      typeof record.payload.reason === 'string' &&
      record.payload.reason.length > 0
        ? record.payload.reason
        : `Approved change request ${record.id}: ${record.reason}`;

    await this.triage.markFailedAndRefund(
      transactionId,
      reason,
      decidedByAdminId,
    );
  }

  /**
   * Apply a manual credit via the engine-brokered credit service — the ONLY money
   * path. The payload must carry { userId, asset, amount }; it is re-parsed through
   * the contract schema (never trusted as stored) before the engine runs. The
   * credit is atomic + idempotent on the change-request id (an approved-twice race
   * yields a no-op) and re-checks the user server-side (§3.1/§3.3). Nothing here
   * touches the ledger. Fails closed on a malformed payload (§3.6).
   */
  private async applyManualCredit(
    record: ChangeRequestRecord,
    decidedByAdminId: string,
  ): Promise<void> {
    const parsed = CreateManualCreditRequestSchema.safeParse({
      asset: record.payload.asset,
      amount: record.payload.amount,
      // The stored reason is the maker's justification; re-validate its shape.
      reason: record.reason,
    });
    const userId = record.payload.userId;
    if (!parsed.success || typeof userId !== 'string' || userId.length === 0) {
      throw new ChangeRequestNotApplicableError(
        'payload must carry a userId + a valid asset + a positive amount',
      );
    }

    await this.manualCredit.creditUser({
      userId,
      asset: parsed.data.asset,
      amount: parsed.data.amount,
      reason: parsed.data.reason,
      // The change-request id anchors idempotency — an approved-twice race yields
      // a no-op credit (the engine short-circuits on the existing idempotencyKey).
      idempotencyKey: record.id,
      approvedByAdminId: decidedByAdminId,
    });
  }

  /** Narrow an untrusted scope value to AppSettingScope, defaulting to global. */
  private readScope(value: unknown): AppSettingScope {
    return value === 'tier' || value === 'provider' ? value : 'global';
  }

  private async toViews(
    records: ChangeRequestRecord[],
  ): Promise<ChangeRequest[]> {
    const ids = new Set<string>();
    for (const r of records) {
      ids.add(r.requestedByAdminId);
      if (r.decidedByAdminId !== null) ids.add(r.decidedByAdminId);
    }
    const emails = await this.repo.resolveEmails([...ids]);
    return records.map((r) => this.toView(r, emails));
  }

  private toView(
    record: ChangeRequestRecord,
    emails?: Map<string, string>,
  ): ChangeRequest {
    return {
      id: record.id,
      kind: record.kind,
      resource: record.resource,
      payload: record.payload,
      status: record.status,
      reason: record.reason,
      requestedByAdminId: record.requestedByAdminId,
      requestedByEmail: emails?.get(record.requestedByAdminId) ?? null,
      decidedByAdminId: record.decidedByAdminId,
      decidedByEmail:
        record.decidedByAdminId !== null
          ? (emails?.get(record.decidedByAdminId) ?? null)
          : null,
      decisionReason: record.decisionReason,
      decidedAt:
        record.decidedAt !== null ? record.decidedAt.toISOString() : null,
      createdAt: record.createdAt.toISOString(),
    };
  }
}

/** Narrow an untrusted broadcast `schedule` payload to its scheduled variant. */
function isScheduledPayload(
  value: unknown,
): value is { kind: 'scheduled'; sendAt?: unknown } {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as { kind?: unknown }).kind === 'scheduled'
  );
}
