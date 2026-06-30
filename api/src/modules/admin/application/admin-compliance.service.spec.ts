import { AdminNotFoundError } from '../domain/admin-errors';
import { AdminComplianceService } from './admin-compliance.service';
import type {
  AuditService,
  RecordAuditInput,
} from '../../../core/audit/application/audit.service';
import type {
  IComplianceEventRepository,
  ComplianceEventRecord,
} from '../../compliance/application/ports/compliance-event.repository.port';
import type {
  ISanctionsRecordRepository,
  SanctionsRecordRecord,
} from '../../compliance/application/ports/sanctions-record.repository.port';
import type {
  IAmlRuleRepository,
  AmlRuleRecord,
} from '../../compliance/application/ports/aml-rule.repository.port';
import type {
  ITravelRuleRepository,
  TravelRuleRecord,
} from '../../compliance/application/ports/travel-rule.repository.port';
import type {
  IComplianceReportRepository,
  ComplianceReportRecord,
} from '../../compliance/application/ports/compliance-report.repository.port';

const EVENT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_ID = '99999999-9999-9999-9999-999999999999';
const RULE_ID = '33333333-3333-3333-3333-333333333333';
const REPORT_ID = '44444444-4444-4444-4444-444444444444';

function makeEvent(
  over?: Partial<ComplianceEventRecord>,
): ComplianceEventRecord {
  return {
    id: EVENT_ID,
    userId: USER_ID,
    transactionId: null,
    eventType: 'sanctions_hit',
    severity: 'high',
    screeningProvider: 'open_sanctions',
    ruleOrHit: 'OFAC SDN',
    details: { hit: true },
    status: 'flagged',
    dispositionComment: null,
    dispositionAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

function makeRule(over?: Partial<AmlRuleRecord>): AmlRuleRecord {
  return {
    id: RULE_ID,
    ruleKey: 'velocity_daily_limit',
    name: 'Daily velocity',
    description: 'desc',
    enabled: true,
    ruleType: 'velocity_amount',
    action: 'flag',
    parameters: { limit: 1000 },
    version: 1,
    ...over,
  };
}

function makeReport(
  over?: Partial<ComplianceReportRecord>,
): ComplianceReportRecord {
  return {
    id: REPORT_ID,
    reportType: 'sar',
    status: 'draft',
    relatedEvents: [EVENT_ID],
    submittedAt: null,
    submissionRef: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

describe('AdminComplianceService', () => {
  let eventRepo: jest.Mocked<IComplianceEventRepository>;
  let sanctionsRepo: jest.Mocked<ISanctionsRecordRepository>;
  let amlRepo: jest.Mocked<IAmlRuleRepository>;
  let travelRepo: jest.Mocked<ITravelRuleRepository>;
  let reportRepo: jest.Mocked<IComplianceReportRepository>;
  let audit: jest.Mocked<Pick<AuditService, 'record'>>;
  let auditCalls: RecordAuditInput[];
  let service: AdminComplianceService;

  beforeEach(() => {
    eventRepo = {
      create: jest.fn(),
      listByStatus: jest.fn(),
      findById: jest.fn(),
      updateDisposition: jest.fn(),
    };
    sanctionsRepo = { list: jest.fn() };
    amlRepo = {
      list: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    travelRepo = { list: jest.fn() };
    reportRepo = {
      list: jest.fn(),
      findById: jest.fn(),
      createDraft: jest.fn(),
      submit: jest.fn(),
    };
    auditCalls = [];
    audit = {
      record: jest.fn((input: RecordAuditInput) => {
        auditCalls.push(input);
        return Promise.resolve();
      }),
    };

    service = new AdminComplianceService(
      eventRepo,
      sanctionsRepo,
      amlRepo,
      travelRepo,
      reportRepo,
      audit as unknown as AuditService,
    );
  });

  // ── events ──────────────────────────────────────────────────────────────────

  describe('listEvents', () => {
    it('maps records to items + cursor and forwards the filter + default limit', async () => {
      eventRepo.listByStatus.mockResolvedValue({
        items: [makeEvent()],
        nextCursor: 'cur-1',
      });

      const res = await service.listEvents({ status: 'flagged' });

      const [filter, page] = eventRepo.listByStatus.mock.calls[0];
      expect(filter).toEqual({
        status: 'flagged',
        severity: undefined,
        userId: undefined,
      });
      expect(page.cursor).toBeUndefined();
      expect(page.limit).toBeGreaterThan(0);
      expect(res.items).toEqual([
        {
          id: EVENT_ID,
          userId: USER_ID,
          transactionId: null,
          eventType: 'sanctions_hit',
          severity: 'high',
          status: 'flagged',
          screeningProvider: 'open_sanctions',
          ruleOrHit: 'OFAC SDN',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]);
      expect(res.nextCursor).toBe('cur-1');
    });
  });

  describe('getEvent', () => {
    it('throws AdminNotFoundError when missing', async () => {
      eventRepo.findById.mockResolvedValue(null);
      await expect(service.getEvent(EVENT_ID)).rejects.toBeInstanceOf(
        AdminNotFoundError,
      );
    });

    it('returns the detail projection (details + disposition fields)', async () => {
      eventRepo.findById.mockResolvedValue(
        makeEvent({
          status: 'approved',
          dispositionComment: 'ok',
          dispositionAt: new Date('2026-01-02T00:00:00.000Z'),
        }),
      );
      const detail = await service.getEvent(EVENT_ID);
      expect(detail.details).toEqual({ hit: true });
      expect(detail.dispositionComment).toBe('ok');
      expect(detail.dispositionAt).toBe('2026-01-02T00:00:00.000Z');
    });
  });

  describe('disposeEvent', () => {
    it('throws AdminNotFoundError when the event is missing', async () => {
      eventRepo.findById.mockResolvedValue(null);
      await expect(
        service.disposeEvent(
          EVENT_ID,
          { status: 'approved', comment: 'c' },
          ADMIN_ID,
        ),
      ).rejects.toBeInstanceOf(AdminNotFoundError);
      expect(eventRepo.updateDisposition).not.toHaveBeenCalled();
    });

    it('updates the disposition and records an admin_review audit (before/after status)', async () => {
      eventRepo.findById
        .mockResolvedValueOnce(makeEvent({ status: 'flagged' }))
        .mockResolvedValueOnce(
          makeEvent({
            status: 'approved',
            dispositionComment: 'verified',
            dispositionAt: new Date('2026-01-02T00:00:00.000Z'),
          }),
        );

      const result = await service.disposeEvent(
        EVENT_ID,
        { status: 'approved', comment: 'verified' },
        ADMIN_ID,
      );

      expect(eventRepo.updateDisposition).toHaveBeenCalledWith(
        EVENT_ID,
        expect.objectContaining({
          status: 'approved',
          adminId: ADMIN_ID,
          comment: 'verified',
        }),
      );
      expect(result.status).toBe('approved');
      expect(auditCalls).toHaveLength(1);
      expect(auditCalls[0]).toMatchObject({
        actorAdminId: ADMIN_ID,
        subject: `ComplianceEvent:${EVENT_ID}`,
        action: 'admin_review',
        before: { status: 'flagged' },
        after: { status: 'approved' },
      });
    });
  });

  // ── sanctions / travel-rule reads ──────────────────────────────────────────

  describe('listSanctions / listTravelRule', () => {
    it('wraps sanctions records into a list response', async () => {
      const rec: SanctionsRecordRecord = {
        id: '55555555-5555-5555-5555-555555555555',
        counterpartyId: 'address:T1',
        verdict: 'hit',
        provider: 'open_sanctions',
        screeningType: 'transaction_counterparty',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      };
      sanctionsRepo.list.mockResolvedValue([rec]);
      const res = await service.listSanctions({ limit: 50 });
      expect(res.items).toEqual([
        {
          id: rec.id,
          counterpartyId: 'address:T1',
          verdict: 'hit',
          provider: 'open_sanctions',
          screeningType: 'transaction_counterparty',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]);
    });

    it('wraps travel-rule records into a list response', async () => {
      const rec: TravelRuleRecord = {
        id: '66666666-6666-6666-6666-666666666666',
        transactionId: USER_ID,
        asset: 'USDT',
        amount: '1500',
        amountFiat: '2400000',
        triggeringFactor: 'amount_threshold',
        capturedAt: new Date('2026-01-01T00:00:00.000Z'),
        reportedAt: null,
      };
      travelRepo.list.mockResolvedValue([rec]);
      const res = await service.listTravelRule({ limit: 50 });
      expect(res.items[0].amountFiat).toBe('2400000');
      expect(res.items[0].reportedAt).toBeNull();
      expect(res.items[0].capturedAt).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  // ── AML rules ───────────────────────────────────────────────────────────────

  describe('AML rules', () => {
    it('lists rules wrapped in { rules }', async () => {
      amlRepo.list.mockResolvedValue([makeRule()]);
      const res = await service.listAmlRules();
      expect(res.rules).toHaveLength(1);
      expect(res.rules[0].ruleKey).toBe('velocity_daily_limit');
    });

    it('creates a rule and records a config_change audit', async () => {
      amlRepo.create.mockResolvedValue(makeRule());
      const res = await service.createAmlRule(
        {
          ruleKey: 'velocity_daily_limit',
          name: 'Daily velocity',
          description: 'desc',
          ruleType: 'velocity_amount',
          action: 'flag',
          parameters: { limit: 1000 },
          enabled: true,
        },
        ADMIN_ID,
      );
      expect(res.id).toBe(RULE_ID);
      expect(amlRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ ruleKey: 'velocity_daily_limit' }),
        ADMIN_ID,
      );
      expect(auditCalls[0]).toMatchObject({
        actorAdminId: ADMIN_ID,
        subject: `AmlRule:${RULE_ID}`,
        action: 'config_change',
      });
    });

    it('throws AdminNotFoundError updating a missing rule', async () => {
      amlRepo.findById.mockResolvedValue(null);
      await expect(
        service.updateAmlRule(RULE_ID, { enabled: false }, ADMIN_ID),
      ).rejects.toBeInstanceOf(AdminNotFoundError);
      expect(amlRepo.update).not.toHaveBeenCalled();
    });

    it('updates a rule and audits the version bump (before/after)', async () => {
      amlRepo.findById.mockResolvedValue(makeRule({ version: 1 }));
      amlRepo.update.mockResolvedValue(
        makeRule({ version: 2, enabled: false, action: 'block' }),
      );

      const res = await service.updateAmlRule(
        RULE_ID,
        { enabled: false, action: 'block' },
        ADMIN_ID,
      );

      expect(res.version).toBe(2);
      expect(auditCalls[0]).toMatchObject({
        subject: `AmlRule:${RULE_ID}`,
        action: 'config_change',
      });
      expect((auditCalls[0].before as AmlRuleRecord).version).toBe(1);
      expect((auditCalls[0].after as AmlRuleRecord).version).toBe(2);
    });
  });

  // ── reports ─────────────────────────────────────────────────────────────────

  describe('reports', () => {
    it('lists reports wrapped in { items }', async () => {
      reportRepo.list.mockResolvedValue([makeReport()]);
      const res = await service.listReports();
      expect(res.items).toHaveLength(1);
      expect(res.items[0].reportType).toBe('sar');
    });

    it('drafts a report and records an admin_review audit', async () => {
      reportRepo.createDraft.mockResolvedValue(makeReport());
      const res = await service.draftReport(
        {
          reportType: 'sar',
          relatedEvents: [EVENT_ID],
          content: { narrative: 'x' },
        },
        ADMIN_ID,
      );
      expect(res.status).toBe('draft');
      expect(auditCalls[0]).toMatchObject({
        actorAdminId: ADMIN_ID,
        subject: `ComplianceReport:${REPORT_ID}`,
        action: 'admin_review',
      });
    });

    it('throws AdminNotFoundError submitting a missing report', async () => {
      reportRepo.findById.mockResolvedValue(null);
      await expect(
        service.submitReport(REPORT_ID, 'SEC-1', ADMIN_ID),
      ).rejects.toBeInstanceOf(AdminNotFoundError);
      expect(reportRepo.submit).not.toHaveBeenCalled();
    });

    it('submits a report and audits the status transition', async () => {
      reportRepo.findById.mockResolvedValue(makeReport({ status: 'draft' }));
      reportRepo.submit.mockResolvedValue(
        makeReport({
          status: 'submitted',
          submissionRef: 'SEC-1',
          submittedAt: new Date('2026-01-03T00:00:00.000Z'),
        }),
      );

      const res = await service.submitReport(REPORT_ID, 'SEC-1', ADMIN_ID);
      expect(res.status).toBe('submitted');
      expect(res.submissionRef).toBe('SEC-1');
      expect(reportRepo.submit).toHaveBeenCalledWith(
        REPORT_ID,
        'SEC-1',
        expect.any(Date),
      );
      expect(auditCalls[0]).toMatchObject({
        subject: `ComplianceReport:${REPORT_ID}`,
        action: 'admin_review',
        before: { status: 'draft' },
        after: { status: 'submitted', submissionRef: 'SEC-1' },
      });
    });
  });
});
