import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type {
  AmlRule,
  AmlRuleCreateRequest,
  AmlRuleListResponse,
  AmlRuleUpdateRequest,
  ComplianceDispositionRequest,
  ComplianceEventDetail,
  ComplianceEventItem,
  ComplianceEventListResponse,
  ComplianceReport,
  ComplianceReportDraftRequest,
  ComplianceReportListResponse,
  SanctionsDispositionRequest,
  SanctionsMonitoringView,
  SanctionsRecordItem,
  SanctionsRecordListResponse,
  TravelRuleListResponse,
} from '@handshake-agent/contracts';

import { AuditService } from '../../../core/audit/application/audit.service';
import { EffectiveConfigService } from '../../../core/config/application/effective-config.service';
import type { SanctionsRecordRecord } from '../../compliance/application/ports/sanctions-record.repository.port';
import {
  COMPLIANCE_EVENT_REPOSITORY,
  type IComplianceEventRepository,
  type ComplianceEventRecord,
} from '../../compliance/application/ports/compliance-event.repository.port';
import {
  SANCTIONS_RECORD_REPOSITORY,
  type ISanctionsRecordRepository,
} from '../../compliance/application/ports/sanctions-record.repository.port';
import {
  AML_RULE_REPOSITORY,
  type IAmlRuleRepository,
  type AmlRuleRecord,
} from '../../compliance/application/ports/aml-rule.repository.port';
import {
  TRAVEL_RULE_REPOSITORY,
  type ITravelRuleRepository,
} from '../../compliance/application/ports/travel-rule.repository.port';
import {
  COMPLIANCE_REPORT_REPOSITORY,
  type IComplianceReportRepository,
  type ComplianceReportRecord,
} from '../../compliance/application/ports/compliance-report.repository.port';
import { AdminNotFoundError } from '../domain/admin-errors';

/** Default page size for the flagged-event queue when the caller omits one. */
const DEFAULT_EVENT_LIMIT = 20;
/** Default cap for the bounded sanctions/Travel-Rule feeds. */
const DEFAULT_FEED_LIMIT = 50;

/** Human matched-list names keyed by the stored `provider` value. Anything not
 *  mapped falls back to the raw provider string (forward-compatible with new lists). */
const MATCHED_LIST_LABEL: Record<string, string> = {
  open_sanctions: 'OpenSanctions',
  trm: 'TRM Labs',
  mock: 'Mock screener',
};

/** Human match-type labels keyed by the stored `screeningType`. Unmapped types
 *  fall back to the raw value (forward-compatible with new screening contexts). */
const MATCH_TYPE_LABEL: Record<string, string> = {
  beneficiary_add: 'Beneficiary match',
  transaction_counterparty: 'Counterparty match',
  identity_verification: 'Identity match',
  periodic_recheck: 'Periodic re-check',
};

/** 0–100 confidence banded from the screening verdict. Not a fabricated precise
 *  score — a bounded, deterministic projection so the Score slot reflects severity
 *  (hit → high, inconclusive → mid, clear → low). */
const VERDICT_SCORE: Record<SanctionsRecordItem['verdict'], number> = {
  hit: 92,
  inconclusive: 60,
  clear: 8,
};

/** Safe monitoring-policy baseline used when a config flag is absent (mirrors the
 *  JSON defaults in `configuration.ts`). */
const MONITORING_DEFAULTS: SanctionsMonitoringView = {
  reScreenDaily: true,
  screenOnOutbound: true,
  pepAlert: true,
  autoBlockOfac: false,
};

export interface ListEventsQuery {
  status?: string;
  severity?: string;
  userId?: string;
  cursor?: string;
  limit?: number;
}

/**
 * Phase 3 (sub-area C) — the admin COMPLIANCE CONSOLE service: flagged-event
 * disposition, sanctions/Travel-Rule reads, AML-rule CRUD, and SAR/STR reports.
 *
 * It NEVER moves money (§3.1) and holds no Prisma import — it reaches data
 * exclusively through the injected compliance repository ports (§3.2). Every
 * disposition, rule change, and report action is audited (admin_review for
 * event/report disposition, config_change for AML-rule writes).
 */
@Injectable()
export class AdminComplianceService {
  constructor(
    @Inject(COMPLIANCE_EVENT_REPOSITORY)
    private readonly events: IComplianceEventRepository,
    @Inject(SANCTIONS_RECORD_REPOSITORY)
    private readonly sanctions: ISanctionsRecordRepository,
    @Inject(AML_RULE_REPOSITORY)
    private readonly amlRules: IAmlRuleRepository,
    @Inject(TRAVEL_RULE_REPOSITORY)
    private readonly travelRule: ITravelRuleRepository,
    @Inject(COMPLIANCE_REPORT_REPOSITORY)
    private readonly reports: IComplianceReportRepository,
    private readonly audit: AuditService,
    private readonly config: EffectiveConfigService,
  ) {}

  // ── flagged events ───────────────────────────────────────────────────────────

  async listEvents(
    query: ListEventsQuery,
  ): Promise<ComplianceEventListResponse> {
    const result = await this.events.listByStatus(
      {
        status: query.status,
        severity: query.severity,
        userId: query.userId,
      },
      { cursor: query.cursor, limit: query.limit ?? DEFAULT_EVENT_LIMIT },
    );
    return {
      items: result.items.map((e) => toEventItem(e)),
      nextCursor: result.nextCursor,
    };
  }

  async getEvent(id: string): Promise<ComplianceEventDetail> {
    const event = await this.events.findById(id);
    if (event === null) throw new AdminNotFoundError('Compliance event');
    return toEventDetail(event);
  }

  async disposeEvent(
    id: string,
    decision: ComplianceDispositionRequest,
    adminId: string,
  ): Promise<ComplianceEventDetail> {
    const before = await this.events.findById(id);
    if (before === null) throw new AdminNotFoundError('Compliance event');

    await this.events.updateDisposition(id, {
      status: decision.status,
      adminId,
      comment: decision.comment,
      at: new Date(),
    });

    const after = await this.events.findById(id);
    if (after === null) throw new AdminNotFoundError('Compliance event');

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `ComplianceEvent:${id}`,
      action: 'admin_review',
      before: { status: before.status },
      after: { status: after.status },
    });
    return toEventDetail(after);
  }

  // ── sanctions + travel rule (read-only) ───────────────────────────────────────

  async listSanctions(page: {
    limit?: number;
  }): Promise<SanctionsRecordListResponse> {
    const rows = await this.sanctions.list({
      limit: page.limit ?? DEFAULT_FEED_LIMIT,
    });
    return { items: rows.map((r) => toSanctionsItem(r)) };
  }

  /**
   * Record an operator DISPOSITION on a screening match (Clear / Escalate / Block).
   * The immutable screener `verdict` is never mutated — this writes only the
   * annotation columns through the repository port, then records an audited
   * `admin_review` with the before/after disposition. It moves no money (§3.1) and
   * holds no Prisma import (§3.2). The endpoint layer gates Block behind step-up and
   * routes Escalate through maker-checker; the write itself is deterministic.
   */
  async disposeSanctions(
    id: string,
    decision: SanctionsDispositionRequest,
    adminId: string,
  ): Promise<SanctionsRecordItem> {
    const before = await this.sanctions.findById(id);
    if (before === null) throw new AdminNotFoundError('Sanctions record');

    await this.sanctions.disposition(id, {
      disposition: decision.disposition,
      adminId,
      comment: decision.comment,
      at: new Date(),
    });

    const after = await this.sanctions.findById(id);
    if (after === null) throw new AdminNotFoundError('Sanctions record');

    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `SanctionsRecord:${id}`,
      action: 'admin_review',
      before: { disposition: before.disposition },
      after: { disposition: after.disposition },
    });
    return toSanctionsItem(after);
  }

  /**
   * The read-only ongoing-monitoring policy view (four flags from layered config).
   * Absent flags coerce to the safe baseline; toggling is a Phase-7 write.
   */
  getMonitoring(): SanctionsMonitoringView {
    const raw =
      this.config.get<Partial<SanctionsMonitoringView>>(
        'compliance.ongoingMonitoring',
      ) ?? {};
    return {
      reScreenDaily: raw.reScreenDaily ?? MONITORING_DEFAULTS.reScreenDaily,
      screenOnOutbound:
        raw.screenOnOutbound ?? MONITORING_DEFAULTS.screenOnOutbound,
      pepAlert: raw.pepAlert ?? MONITORING_DEFAULTS.pepAlert,
      autoBlockOfac: raw.autoBlockOfac ?? MONITORING_DEFAULTS.autoBlockOfac,
    };
  }

  async listTravelRule(page: {
    limit?: number;
  }): Promise<TravelRuleListResponse> {
    const rows = await this.travelRule.list({
      limit: page.limit ?? DEFAULT_FEED_LIMIT,
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        transactionId: r.transactionId,
        asset: r.asset,
        amount: r.amount,
        amountFiat: r.amountFiat,
        fiatCurrency: r.fiatCurrency,
        triggeringFactor: r.triggeringFactor,
        capturedAt: r.capturedAt.toISOString(),
        reportedAt: r.reportedAt !== null ? r.reportedAt.toISOString() : null,
      })),
    };
  }

  // ── AML rules (CRUD) ──────────────────────────────────────────────────────────

  async listAmlRules(): Promise<AmlRuleListResponse> {
    const rules = await this.amlRules.list();
    return { rules: rules.map((r) => toAmlRule(r)) };
  }

  async createAmlRule(
    input: AmlRuleCreateRequest,
    adminId: string,
  ): Promise<AmlRule> {
    const created = await this.amlRules.create(
      {
        ruleKey: input.ruleKey,
        name: input.name,
        description: input.description,
        ruleType: input.ruleType,
        action: input.action,
        parameters: input.parameters,
        enabled: input.enabled,
      },
      adminId,
    );
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `AmlRule:${created.id}`,
      action: 'config_change',
      before: null,
      after: toAmlRule(created),
    });
    return toAmlRule(created);
  }

  async updateAmlRule(
    id: string,
    patch: AmlRuleUpdateRequest,
    adminId: string,
  ): Promise<AmlRule> {
    const before = await this.amlRules.findById(id);
    if (before === null) throw new AdminNotFoundError('AML rule');

    const after = await this.amlRules.update(id, patch, adminId);
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `AmlRule:${id}`,
      action: 'config_change',
      before: toAmlRule(before),
      after: toAmlRule(after),
    });
    return toAmlRule(after);
  }

  // ── SAR/STR reports ───────────────────────────────────────────────────────────

  async listReports(): Promise<ComplianceReportListResponse> {
    const reports = await this.reports.list();
    return { items: reports.map((r) => toReport(r)) };
  }

  async draftReport(
    input: ComplianceReportDraftRequest,
    adminId: string,
  ): Promise<ComplianceReport> {
    const draft = await this.reports.createDraft(
      {
        reportType: input.reportType,
        relatedEvents: input.relatedEvents,
        content: input.content,
      },
      adminId,
    );
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `ComplianceReport:${draft.id}`,
      action: 'admin_review',
      before: null,
      after: { status: draft.status, reportType: draft.reportType },
    });
    return toReport(draft);
  }

  async submitReport(
    id: string,
    submissionRef: string,
    adminId: string,
  ): Promise<ComplianceReport> {
    const before = await this.reports.findById(id);
    if (before === null) throw new AdminNotFoundError('Compliance report');

    const after = await this.reports.submit(id, submissionRef, new Date());
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `ComplianceReport:${id}`,
      action: 'admin_review',
      before: { status: before.status },
      after: { status: after.status, submissionRef: after.submissionRef },
    });
    return toReport(after);
  }
}

// ── mappers (record → contract shape) ────────────────────────────────────────────

/** Projects a sanctions record onto the enriched match-card item, deriving the
 *  human matched-list name (⇐ provider), match-type label (⇐ screeningType), and
 *  a verdict-banded confidence score (⇐ verdict) — see the constant maps above. */
function toSanctionsItem(r: SanctionsRecordRecord): SanctionsRecordItem {
  return {
    id: r.id,
    counterpartyId: r.counterpartyId,
    verdict: r.verdict,
    provider: r.provider,
    screeningType: r.screeningType,
    matchedList: MATCHED_LIST_LABEL[r.provider] ?? r.provider,
    matchType: MATCH_TYPE_LABEL[r.screeningType] ?? r.screeningType,
    matchScore: VERDICT_SCORE[r.verdict],
    disposition: r.disposition,
    createdAt: r.createdAt.toISOString(),
  };
}

function toEventItem(e: ComplianceEventRecord): ComplianceEventItem {
  return {
    id: e.id,
    userId: e.userId,
    transactionId: e.transactionId,
    eventType: e.eventType,
    severity: e.severity,
    status: e.status,
    screeningProvider: e.screeningProvider,
    ruleOrHit: e.ruleOrHit,
    createdAt: e.createdAt.toISOString(),
  };
}

function toEventDetail(e: ComplianceEventRecord): ComplianceEventDetail {
  return {
    ...toEventItem(e),
    details: e.details,
    dispositionComment: e.dispositionComment,
    dispositionAt:
      e.dispositionAt !== null ? e.dispositionAt.toISOString() : null,
  };
}

function toAmlRule(r: AmlRuleRecord): AmlRule {
  return {
    id: r.id,
    ruleKey: r.ruleKey,
    name: r.name,
    description: r.description,
    enabled: r.enabled,
    ruleType: r.ruleType,
    action: r.action,
    parameters: r.parameters,
    version: r.version,
  };
}

function toReport(r: ComplianceReportRecord): ComplianceReport {
  return {
    id: r.id,
    reportType: r.reportType,
    status: r.status,
    relatedEvents: r.relatedEvents,
    submittedAt: r.submittedAt !== null ? r.submittedAt.toISOString() : null,
    submissionRef: r.submissionRef,
    createdAt: r.createdAt.toISOString(),
  };
}
