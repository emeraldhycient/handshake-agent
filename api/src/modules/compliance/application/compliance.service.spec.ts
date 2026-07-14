/**
 * Unit tests for ComplianceService.screenSendDestination (N2).
 *
 * TDD: tests written RED first, then implementation makes them GREEN.
 *
 * Mocked: ISanctionsScreener (via SANCTIONS_SCREENER port),
 *         IComplianceEventRepository (via COMPLIANCE_EVENT_REPOSITORY port).
 * No Nest TestingModule — ComplianceService is constructed directly.
 */

import type { ISanctionsScreener } from './ports/sanctions-screener.port';
import type {
  IComplianceEventRepository,
  ComplianceEventRecord,
} from './ports/compliance-event.repository.port';
import { ComplianceService } from './compliance.service';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const USER_ID = 'user-uuid-n2-001';
const CLEAN_ADDRESS = 'TClean0000000000000000000000000CLEAN';
const BLOCKED_ADDRESS = 'TBlocked0000000000000000000000000BAD';
const NETWORK = 'tron';
const EVENT_ID = 'event-uuid-n2-001';
const REFERENCE = 'mock-sanctions-abc123';
const PROVIDER = 'mock';

/** Builds a mock screener that returns a clean (passed) result. */
function makeCleanScreener(): jest.Mocked<ISanctionsScreener> {
  return {
    screen: jest.fn().mockResolvedValue({
      passed: true,
      provider: PROVIDER,
      reference: REFERENCE,
    }),
  };
}

/** Builds a mock screener that returns a blocked (failed) result. */
function makeBlockedScreener(
  reason = 'sanctioned address',
): jest.Mocked<ISanctionsScreener> {
  return {
    screen: jest.fn().mockResolvedValue({
      passed: false,
      reason,
      provider: PROVIDER,
      reference: REFERENCE,
    }),
  };
}

/** Builds a mock IComplianceEventRepository. */
function makeEventRepo(
  record?: Partial<ComplianceEventRecord>,
): jest.Mocked<IComplianceEventRepository> {
  const base: ComplianceEventRecord = {
    id: EVENT_ID,
    userId: USER_ID,
    transactionId: null,
    eventType: 'sanctions_hit',
    severity: 'high',
    screeningProvider: PROVIDER,
    ruleOrHit: null,
    details: {},
    status: 'flagged',
    dispositionComment: null,
    dispositionAt: null,
    createdAt: new Date(),
    ...record,
  };
  return {
    create: jest.fn().mockResolvedValue(base),
    listByStatus: jest.fn(),
    findById: jest.fn(),
    findLatestOpenByUserAndType: jest.fn(),
    updateDisposition: jest.fn(),
  };
}

/** Builds a ComplianceService with injected mocks. */
function buildService(opts: {
  screener?: jest.Mocked<ISanctionsScreener>;
  eventRepo?: jest.Mocked<IComplianceEventRepository>;
}) {
  const screener = opts.screener ?? makeCleanScreener();
  const eventRepo = opts.eventRepo ?? makeEventRepo();
  const svc = new ComplianceService(screener, eventRepo);
  return { svc, screener, eventRepo };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ComplianceService.screenSendDestination', () => {
  // ── Passed path ──────────────────────────────────────────────────────────

  it('clean address → calls screener, persists an approved ComplianceEvent, returns passed:true + eventId', async () => {
    const eventRepo = makeEventRepo({
      status: 'approved',
      eventType: 'sanctions_hit',
    });
    const { svc, screener } = buildService({ eventRepo });

    const result = await svc.screenSendDestination({
      userId: USER_ID,
      address: CLEAN_ADDRESS,
      network: NETWORK,
    });

    expect(result.passed).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.complianceEventId).toBe(EVENT_ID);

    // Screener was called with the correct input
    expect(screener.screen).toHaveBeenCalledWith({
      address: CLEAN_ADDRESS,
      network: NETWORK,
      userId: USER_ID,
    });

    // Event was persisted — approved status for a clear screening
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        eventType: 'sanctions_hit',
        screeningProvider: PROVIDER,
        status: 'approved',
      }),
    );
  });

  it('persisted event includes the provider reference in details', async () => {
    const eventRepo = makeEventRepo({ status: 'approved' });
    const { svc } = buildService({ eventRepo });

    await svc.screenSendDestination({
      userId: USER_ID,
      address: CLEAN_ADDRESS,
      network: NETWORK,
    });

    const createCall = eventRepo.create.mock.calls[0][0];
    expect(createCall.details).toMatchObject({
      address: CLEAN_ADDRESS,
      network: NETWORK,
      reference: REFERENCE,
    });
  });

  // ── Failed path ───────────────────────────────────────────────────────────

  it('blocked address → persists a flagged ComplianceEvent, returns passed:false + reason + eventId', async () => {
    const eventRepo = makeEventRepo({
      status: 'flagged',
      eventType: 'sanctions_hit',
    });
    const { svc, screener } = buildService({
      screener: makeBlockedScreener(),
      eventRepo,
    });

    const result = await svc.screenSendDestination({
      userId: USER_ID,
      address: BLOCKED_ADDRESS,
      network: NETWORK,
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toBe('sanctioned address');
    expect(result.complianceEventId).toBe(EVENT_ID);

    // Screener still called
    expect(screener.screen).toHaveBeenCalled();

    // Event persisted as flagged
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        status: 'flagged',
      }),
    );
  });

  it('ComplianceEvent is always persisted — even on a failed screen', async () => {
    const eventRepo = makeEventRepo();
    const { svc } = buildService({
      screener: makeBlockedScreener(),
      eventRepo,
    });

    await svc.screenSendDestination({
      userId: USER_ID,
      address: BLOCKED_ADDRESS,
      network: NETWORK,
    });

    expect(eventRepo.create).toHaveBeenCalledTimes(1);
  });

  it('optional transactionId is forwarded to the repository when provided', async () => {
    const TX_ID = 'tx-uuid-001';
    const eventRepo = makeEventRepo({ transactionId: TX_ID });
    const { svc } = buildService({ eventRepo });

    await svc.screenSendDestination({
      userId: USER_ID,
      address: CLEAN_ADDRESS,
      network: NETWORK,
      transactionId: TX_ID,
    });

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: TX_ID }),
    );
  });

  it('transactionId defaults to null when not provided', async () => {
    const eventRepo = makeEventRepo({ transactionId: null });
    const { svc } = buildService({ eventRepo });

    await svc.screenSendDestination({
      userId: USER_ID,
      address: CLEAN_ADDRESS,
      network: NETWORK,
    });

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: null }),
    );
  });

  // ── Severity ─────────────────────────────────────────────────────────────

  it('blocked screening → event is persisted with severity "high"', async () => {
    const eventRepo = makeEventRepo();
    const { svc } = buildService({
      screener: makeBlockedScreener(),
      eventRepo,
    });

    await svc.screenSendDestination({
      userId: USER_ID,
      address: BLOCKED_ADDRESS,
      network: NETWORK,
    });

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'high' }),
    );
  });

  it('clean screening → event is persisted with severity "low"', async () => {
    const eventRepo = makeEventRepo();
    const { svc } = buildService({ eventRepo });

    await svc.screenSendDestination({
      userId: USER_ID,
      address: CLEAN_ADDRESS,
      network: NETWORK,
    });

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'low' }),
    );
  });
});

// ---------------------------------------------------------------------------
// screenCounterpartyUser (Task 8 — counterparty sanctions screening for
// internal user→user transfers). Reuses the same ISanctionsScreener /
// IComplianceEventRepository fixtures as screenSendDestination above: the
// screener port is shared and unchanged (non-breaking), only the screen
// subject differs — the counterparty's userId stands in for `address`.
// ---------------------------------------------------------------------------

describe('ComplianceService.screenCounterpartyUser', () => {
  const COUNTERPARTY_USER_ID = 'counterparty-uuid-001';

  it('clean counterparty → calls screener, persists an approved ComplianceEvent, returns passed:true + eventId', async () => {
    const eventRepo = makeEventRepo({
      userId: COUNTERPARTY_USER_ID,
      status: 'approved',
      eventType: 'sanctions_hit',
    });
    const { svc, screener } = buildService({ eventRepo });

    const result = await svc.screenCounterpartyUser({
      userId: COUNTERPARTY_USER_ID,
    });

    expect(result.passed).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.complianceEventId).toBe(EVENT_ID);

    // Screener called with the counterparty's userId standing in for the
    // screen subject (address) — same port, no port change.
    expect(screener.screen).toHaveBeenCalledWith({
      address: COUNTERPARTY_USER_ID,
      network: 'internal',
      userId: COUNTERPARTY_USER_ID,
    });

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: COUNTERPARTY_USER_ID,
        eventType: 'sanctions_hit',
        screeningProvider: PROVIDER,
        status: 'approved',
      }),
    );
  });

  it('sanctioned counterparty (denylisted userId via the screener) → persists a flagged ComplianceEvent, returns passed:false + reason + eventId', async () => {
    const eventRepo = makeEventRepo({
      userId: COUNTERPARTY_USER_ID,
      status: 'flagged',
      eventType: 'sanctions_hit',
    });
    const { svc, screener } = buildService({
      screener: makeBlockedScreener('sanctioned counterparty'),
      eventRepo,
    });

    const result = await svc.screenCounterpartyUser({
      userId: COUNTERPARTY_USER_ID,
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toBe('sanctioned counterparty');
    expect(result.complianceEventId).toBe(EVENT_ID);

    expect(screener.screen).toHaveBeenCalledWith({
      address: COUNTERPARTY_USER_ID,
      network: 'internal',
      userId: COUNTERPARTY_USER_ID,
    });

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: COUNTERPARTY_USER_ID,
        status: 'flagged',
        severity: 'high',
      }),
    );
  });

  it('persisted event records the counterparty userId in details', async () => {
    const eventRepo = makeEventRepo({ status: 'approved' });
    const { svc } = buildService({ eventRepo });

    await svc.screenCounterpartyUser({ userId: COUNTERPARTY_USER_ID });

    const createCall = eventRepo.create.mock.calls[0][0];
    expect(createCall.details).toMatchObject({
      counterpartyUserId: COUNTERPARTY_USER_ID,
      reference: REFERENCE,
    });
  });

  it('ComplianceEvent is always persisted — even on a failed screen', async () => {
    const eventRepo = makeEventRepo();
    const { svc } = buildService({
      screener: makeBlockedScreener(),
      eventRepo,
    });

    await svc.screenCounterpartyUser({ userId: COUNTERPARTY_USER_ID });

    expect(eventRepo.create).toHaveBeenCalledTimes(1);
  });
});
