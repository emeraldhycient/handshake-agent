/**
 * Integration tests for the admin COMPLIANCE CONSOLE repositories (Phase 3,
 * sub-area C) against a REAL Postgres (Testcontainers). Exercises every new
 * read/write method on the real schema — enums, FKs, Json, Decimal, version-bump:
 *
 *   - ComplianceEventPrismaRepository: listByStatus (filter + keyset), findById,
 *     updateDisposition
 *   - SanctionsRecordPrismaRepository: list (newest-first, capped)
 *   - AmlRulePrismaRepository: create, list, findById, update (VERSION BUMP)
 *   - TravelRulePrismaRepository: list (non-PII projection, Decimal→string)
 *   - ComplianceReportPrismaRepository: createDraft, list, findById, submit
 *
 * Runs in the `test:e2e` lane (jest-e2e.json). Requires Docker.
 */

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '../generated/prisma/client';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { ComplianceEventPrismaRepository } from '../src/modules/compliance/infrastructure/compliance-event.prisma.repository';
import { SanctionsRecordPrismaRepository } from '../src/modules/compliance/infrastructure/sanctions-record.prisma.repository';
import { AmlRulePrismaRepository } from '../src/modules/compliance/infrastructure/aml-rule.prisma.repository';
import { TravelRulePrismaRepository } from '../src/modules/compliance/infrastructure/travel-rule.prisma.repository';
import { ComplianceReportPrismaRepository } from '../src/modules/compliance/infrastructure/compliance-report.prisma.repository';
import { startTestPostgres } from './helpers/pg-testcontainer';

jest.setTimeout(180_000);

describe('Admin compliance console repositories (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  let events: ComplianceEventPrismaRepository;
  let sanctions: SanctionsRecordPrismaRepository;
  let amlRules: AmlRulePrismaRepository;
  let travelRule: TravelRulePrismaRepository;
  let reports: ComplianceReportPrismaRepository;

  let userId: string;
  const adminId = randomUUID();

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());
    const svc = prisma as unknown as PrismaService;
    events = new ComplianceEventPrismaRepository(svc);
    sanctions = new SanctionsRecordPrismaRepository(svc);
    amlRules = new AmlRulePrismaRepository(svc);
    travelRule = new TravelRulePrismaRepository(svc);
    reports = new ComplianceReportPrismaRepository(svc);
    userId = (await prisma.user.create({ data: {} })).id;
  });

  afterAll(async () => {
    await stop?.();
  });

  // ── ComplianceEvent: queue + disposition ───────────────────────────────────

  async function seedEvent(
    over: {
      status?:
        | 'flagged'
        | 'under_review'
        | 'approved'
        | 'blocked'
        | 'dismissed';
      severity?: 'low' | 'medium' | 'high' | 'critical';
      createdAt?: Date;
    } = {},
  ): Promise<string> {
    const row = await prisma.complianceEvent.create({
      data: {
        userId,
        eventType: 'sanctions_hit',
        severity: (over.severity ?? 'high') as never,
        screeningProvider: 'open_sanctions',
        ruleOrHit: 'OFAC SDN',
        details: { hit: true },
        status: (over.status ?? 'flagged') as never,
        ...(over.createdAt ? { createdAt: over.createdAt } : {}),
      },
      select: { id: true },
    });
    return row.id;
  }

  describe('ComplianceEventPrismaRepository', () => {
    it('listByStatus filters to flagged and keyset-paginates newest-first', async () => {
      const a = await seedEvent({
        status: 'flagged',
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
      });
      const b = await seedEvent({
        status: 'flagged',
        createdAt: new Date('2026-05-02T00:00:00.000Z'),
      });
      await seedEvent({
        status: 'approved',
        createdAt: new Date('2026-05-03T00:00:00.000Z'),
      });

      const page1 = await events.listByStatus(
        { status: 'flagged' },
        { limit: 1 },
      );
      expect(page1.items).toHaveLength(1);
      expect(page1.items[0].id).toBe(b); // newest first
      expect(page1.items.every((e) => e.status === 'flagged')).toBe(true);
      expect(page1.nextCursor).toBe(b);

      const page2 = await events.listByStatus(
        { status: 'flagged' },
        { limit: 1, cursor: page1.nextCursor ?? undefined },
      );
      expect(page2.items.map((e) => e.id)).toEqual([a]);
      expect(page2.nextCursor).toBeNull();
    });

    it('listByStatus filters by severity', async () => {
      await seedEvent({ severity: 'critical' });
      const res = await events.listByStatus(
        { severity: 'critical' },
        {
          limit: 50,
        },
      );
      expect(res.items.length).toBeGreaterThan(0);
      expect(res.items.every((e) => e.severity === 'critical')).toBe(true);
    });

    it('findById returns the event (with disposition fields) or null', async () => {
      const id = await seedEvent();
      const found = await events.findById(id);
      expect(found?.id).toBe(id);
      expect(found?.dispositionComment).toBeNull();
      expect(found?.dispositionAt).toBeNull();
      expect(await events.findById(randomUUID())).toBeNull();
    });

    it('updateDisposition sets status + admin ref + comment + timestamp', async () => {
      const id = await seedEvent({ status: 'flagged' });
      const at = new Date('2026-05-10T00:00:00.000Z');
      await events.updateDisposition(id, {
        status: 'approved',
        adminId,
        comment: 'manually verified',
        at,
      });

      const row = await prisma.complianceEvent.findUniqueOrThrow({
        where: { id },
      });
      expect(row.status).toBe('approved');
      expect(row.dispositionAdminId).toBe(adminId);
      expect(row.dispositionComment).toBe('manually verified');
      expect(row.dispositionAt?.toISOString()).toBe(at.toISOString());
    });
  });

  // ── SanctionsRecord: read-only list ────────────────────────────────────────

  describe('SanctionsRecordPrismaRepository', () => {
    it('lists records newest-first, capped at limit', async () => {
      for (let i = 0; i < 3; i++) {
        await prisma.sanctionsRecord.create({
          data: {
            counterpartyId: `address:T${i}`,
            screeningType: 'transaction_counterparty',
            provider: 'open_sanctions',
            query: {},
            result: {},
            verdict: i === 0 ? 'hit' : 'clear',
            createdAt: new Date(`2026-04-0${i + 1}T00:00:00.000Z`),
          },
        });
      }

      const rows = await sanctions.list({ limit: 2 });
      expect(rows).toHaveLength(2);
      // Newest first → the 2026-04-03 record leads.
      expect(rows[0].createdAt.getTime()).toBeGreaterThan(
        rows[1].createdAt.getTime(),
      );
      expect(rows[0].verdict).toMatch(/clear|hit|inconclusive/);
    });
  });

  // ── AmlRule: CRUD with version bump ────────────────────────────────────────

  describe('AmlRulePrismaRepository', () => {
    it('creates, finds, lists, and version-bumps on update', async () => {
      const created = await amlRules.create(
        {
          ruleKey: `rule_${randomUUID()}`,
          name: 'Daily velocity',
          description: 'Flags daily volume over threshold',
          ruleType: 'velocity_amount',
          action: 'flag',
          parameters: { window: '24h', limit: 1_000_000 },
          enabled: true,
        },
        adminId,
      );
      expect(created.version).toBe(1);
      expect(created.parameters).toEqual({ window: '24h', limit: 1_000_000 });

      const dbCreated = await prisma.amlRule.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(dbCreated.createdByAdminId).toBe(adminId);
      expect(dbCreated.updatedByAdminId).toBe(adminId);

      expect((await amlRules.findById(created.id))?.id).toBe(created.id);
      expect((await amlRules.list()).some((r) => r.id === created.id)).toBe(
        true,
      );

      const updated = await amlRules.update(
        created.id,
        { enabled: false, action: 'block' },
        adminId,
      );
      // VERSION BUMPED 1 → 2.
      expect(updated.version).toBe(2);
      expect(updated.enabled).toBe(false);
      expect(updated.action).toBe('block');
    });
  });

  // ── TravelRuleData: non-PII projection ─────────────────────────────────────

  describe('TravelRulePrismaRepository', () => {
    it('lists captures with the Decimal amountFiat serialized to a string', async () => {
      const txn = await prisma.transaction.create({
        data: {
          userId,
          type: 'send' as never,
          status: 'completed' as never,
          idempotencyKey: randomUUID(),
          requestChecksum: `chk-${randomUUID()}`,
          metadata: {},
        },
        select: { id: true },
      });

      await prisma.travelRuleData.create({
        data: {
          transactionId: txn.id,
          originatorType: 'individual',
          originatorName: 'Alice',
          originatorAddress: 'Lagos',
          originatorAccountNumber: '0011',
          beneficiaryType: 'individual',
          beneficiaryAccountNumber: 'TBenef',
          asset: 'USDT',
          amount: '1500',
          amountFiat: '2400000.00',
          triggeringFactor: 'amount_threshold',
        },
      });

      const rows = await travelRule.list({ limit: 50 });
      const found = rows.find((r) => r.transactionId === txn.id);
      expect(found).toBeDefined();
      expect(found?.asset).toBe('USDT');
      expect(typeof found?.amountFiat).toBe('string');
      expect(found?.amountFiat).toBe('2400000');
      expect(found?.reportedAt).toBeNull();
    });
  });

  // ── ComplianceReport: draft + submit ───────────────────────────────────────

  describe('ComplianceReportPrismaRepository', () => {
    it('drafts, lists, finds, and submits a report', async () => {
      const evId = await seedEvent();
      const draft = await reports.createDraft(
        {
          reportType: 'sar',
          relatedEvents: [evId],
          content: { narrative: 'suspicious activity' },
        },
        adminId,
      );
      expect(draft.status).toBe('draft');
      expect(draft.relatedEvents).toEqual([evId]);
      expect(draft.submittedAt).toBeNull();

      const dbDraft = await prisma.complianceReport.findUniqueOrThrow({
        where: { id: draft.id },
      });
      expect(dbDraft.createdByAdminId).toBe(adminId);

      expect((await reports.findById(draft.id))?.id).toBe(draft.id);
      expect((await reports.list()).some((r) => r.id === draft.id)).toBe(true);

      const at = new Date('2026-06-01T00:00:00.000Z');
      const submitted = await reports.submit(draft.id, 'SEC-RECEIPT-9', at);
      expect(submitted.status).toBe('submitted');
      expect(submitted.submissionRef).toBe('SEC-RECEIPT-9');
      expect(submitted.submittedAt?.toISOString()).toBe(at.toISOString());
    });
  });
});
