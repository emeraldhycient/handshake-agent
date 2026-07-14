/**
 * ComplianceService — sanctions/AML screening for send destinations (N2).
 *
 * Screens a destination crypto address before a send proposal is created.
 * Every screening run (pass or fail) is persisted as an immutable
 * ComplianceEvent — the audit trail is unconditional.
 *
 * Architecture: imports NO Prisma, NO infrastructure (CLAUDE.md §3.2).
 * All I/O goes through two injected ports:
 *   - ISanctionsScreener  (SANCTIONS_SCREENER)   — calls the screening provider
 *   - IComplianceEventRepository (COMPLIANCE_EVENT_REPOSITORY) — appends the event
 *
 * N3 (send proposal) will inject this service and call screenSendDestination
 * before constructing the proposal; on failed screening it throws/blocks.
 */

import { Inject, Injectable } from '@nestjs/common';

import type { ISanctionsScreener } from './ports/sanctions-screener.port';
import { SANCTIONS_SCREENER } from './ports/sanctions-screener.port';
import type { IComplianceEventRepository } from './ports/compliance-event.repository.port';
import { COMPLIANCE_EVENT_REPOSITORY } from './ports/compliance-event.repository.port';

// ---------------------------------------------------------------------------
// Input / output
// ---------------------------------------------------------------------------

export interface ScreenSendDestinationInput {
  userId: string;
  address: string;
  network: string;
  /** Optional: link the event to an in-flight transaction (pre-execution). */
  transactionId?: string | null;
}

export interface ScreenSendDestinationResult {
  /** true = clear to proceed; false = blocked. */
  passed: boolean;
  /** Provider reason when passed is false. */
  reason?: string;
  /** Id of the persisted ComplianceEvent (always present — event is always written). */
  complianceEventId: string;
}

export interface ScreenCounterpartyUserInput {
  /** The recipient's userId — the counterparty of an internal transfer. */
  userId: string;
}

export interface ScreenCounterpartyUserResult {
  /** true = clear to proceed; false = blocked. */
  passed: boolean;
  /** Provider reason when passed is false; null when clear or unavailable. */
  reason: string | null;
  /** Id of the persisted ComplianceEvent (always present — event is always written). */
  complianceEventId: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ComplianceService {
  constructor(
    @Inject(SANCTIONS_SCREENER)
    private readonly sanctionsScreener: ISanctionsScreener,
    @Inject(COMPLIANCE_EVENT_REPOSITORY)
    private readonly eventRepo: IComplianceEventRepository,
  ) {}

  /**
   * Screens a destination address and persists the result as a ComplianceEvent.
   *
   * The event is always written — regardless of pass/fail — so every screening
   * run is audit-traceable. N3 (the send proposal service) calls this method;
   * when `passed` is false, N3 must throw `SanctionsBlockedError` to block the
   * proposal (domain error lives in compliance/domain/compliance-errors.ts).
   *
   * Severity mapping:
   *   - passed: true  → 'low'    (routine clear record)
   *   - passed: false → 'high'   (sanctions hit requires disposition)
   *
   * Status mapping:
   *   - passed: true  → 'approved'
   *   - passed: false → 'flagged'
   */
  async screenSendDestination(
    input: ScreenSendDestinationInput,
  ): Promise<ScreenSendDestinationResult> {
    const { userId, address, network, transactionId = null } = input;

    // ── Step 1: Call the screening provider ────────────────────────────────
    const screening = await this.sanctionsScreener.screen({
      address,
      network,
      userId,
    });

    // ── Step 2: Persist an immutable ComplianceEvent ───────────────────────
    const event = await this.eventRepo.create({
      userId,
      transactionId,
      eventType: 'sanctions_hit',
      severity: screening.passed ? 'low' : 'high',
      screeningProvider: screening.provider,
      ruleOrHit: screening.passed ? null : (screening.reason ?? 'sanctioned'),
      details: {
        address,
        network,
        reference: screening.reference,
        ...(screening.reason !== undefined ? { reason: screening.reason } : {}),
      },
      status: screening.passed ? 'approved' : 'flagged',
    });

    // ── Step 3: Return the result ───────────────────────────────────────────
    return {
      passed: screening.passed,
      ...(screening.reason !== undefined ? { reason: screening.reason } : {}),
      complianceEventId: event.id,
    };
  }

  /**
   * Screens an internal-transfer counterparty (recipient) and persists the
   * result as a ComplianceEvent (Task 8).
   *
   * Internal transfers move value user→user via a ledger double-entry — there
   * is no on-chain destination address to AML-screen. The counterparty is
   * screened by IDENTITY through the dedicated `screenIdentity` port method,
   * NOT by overloading the address `screen()` path with a fake
   * `network: 'internal'` — that fake network fail-closes the real Blockradar
   * adapter (which only maps real on-chain networks), throwing before the
   * ComplianceEvent is written and breaking every internal transfer in prod.
   * `screenIdentity` is non-throwing: address-only providers pass through and
   * record the gap; a name/entity provider can be wired later without changing
   * this caller.
   *
   * The event is always written — regardless of pass/fail — keyed to the
   * counterparty (`userId` on the event) with `counterpartyUserId` also
   * recorded in `details` for explicit traceability. Task 6 (the internal
   * transfer proposal) calls this method; when `passed` is false, Task 6 must
   * throw `SanctionsBlockedError` to block the transfer — this method never
   * throws, it only reports.
   *
   * Severity/status mapping mirrors screenSendDestination exactly:
   *   - passed: true  → severity 'low',  status 'approved'
   *   - passed: false → severity 'high', status 'flagged'
   */
  async screenCounterpartyUser(
    input: ScreenCounterpartyUserInput,
  ): Promise<ScreenCounterpartyUserResult> {
    const { userId: counterpartyUserId } = input;

    // ── Step 1: Screen the counterparty by identity (not by address) ────────
    const screening = await this.sanctionsScreener.screenIdentity({
      userId: counterpartyUserId,
      reference: null,
    });

    // ── Step 2: Persist an immutable ComplianceEvent ───────────────────────
    const event = await this.eventRepo.create({
      userId: counterpartyUserId,
      transactionId: null,
      eventType: 'sanctions_hit',
      severity: screening.passed ? 'low' : 'high',
      screeningProvider: screening.provider,
      ruleOrHit: screening.passed ? null : (screening.reason ?? 'sanctioned'),
      details: {
        counterpartyUserId,
        reference: screening.reference,
        ...(screening.reason !== undefined ? { reason: screening.reason } : {}),
      },
      status: screening.passed ? 'approved' : 'flagged',
    });

    // ── Step 3: Return the result ───────────────────────────────────────────
    return {
      passed: screening.passed,
      reason: screening.reason ?? null,
      complianceEventId: event.id,
    };
  }
}
