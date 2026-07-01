import {
  ComplianceEventStatusSchema,
  ComplianceSeveritySchema,
  ComplianceEventItemSchema,
  ComplianceEventListResponseSchema,
  ComplianceEventDetailSchema,
  ComplianceDispositionRequestSchema,
  SanctionsRecordItemSchema,
  SanctionsRecordListResponseSchema,
  AmlRuleSchema,
  AmlRuleListResponseSchema,
  AmlRuleCreateRequestSchema,
  AmlRuleUpdateRequestSchema,
  TravelRuleItemSchema,
  TravelRuleListResponseSchema,
  ComplianceReportSchema,
  ComplianceReportListResponseSchema,
  ComplianceReportDraftRequestSchema,
  ComplianceReportSubmitRequestSchema,
} from "./compliance.dto";

const UUID = "11111111-1111-1111-1111-111111111111";
const UUID_2 = "22222222-2222-2222-2222-222222222222";

describe("ComplianceEventStatusSchema / ComplianceSeveritySchema", () => {
  it("accepts every compliance status", () => {
    for (const s of [
      "flagged",
      "under_review",
      "approved",
      "blocked",
      "dismissed",
    ]) {
      expect(ComplianceEventStatusSchema.parse(s)).toBe(s);
    }
  });

  it("accepts every severity", () => {
    for (const s of ["low", "medium", "high", "critical"]) {
      expect(ComplianceSeveritySchema.parse(s)).toBe(s);
    }
  });

  it("rejects unknown values", () => {
    expect(() => ComplianceEventStatusSchema.parse("boom")).toThrow();
    expect(() => ComplianceSeveritySchema.parse("fatal")).toThrow();
  });
});

describe("ComplianceEventItemSchema / ListResponse", () => {
  const item = {
    id: UUID,
    userId: UUID_2,
    transactionId: null,
    eventType: "sanctions_hit",
    severity: "high" as const,
    status: "flagged" as const,
    screeningProvider: "open_sanctions",
    ruleOrHit: "OFAC SDN",
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("accepts a well-formed item with a null transactionId", () => {
    expect(ComplianceEventItemSchema.parse(item)).toEqual(item);
  });

  it("accepts a string transactionId and a null ruleOrHit", () => {
    const parsed = ComplianceEventItemSchema.parse({
      ...item,
      transactionId: UUID,
      ruleOrHit: null,
    });
    expect(parsed.transactionId).toBe(UUID);
    expect(parsed.ruleOrHit).toBeNull();
  });

  it("rejects a non-uuid id", () => {
    expect(() =>
      ComplianceEventItemSchema.parse({ ...item, id: "x" }),
    ).toThrow();
  });

  it("accepts a list response with items and a nullable cursor", () => {
    const res = ComplianceEventListResponseSchema.parse({
      items: [item],
      nextCursor: null,
    });
    expect(res.items).toHaveLength(1);
    expect(res.nextCursor).toBeNull();
  });
});

describe("ComplianceEventDetailSchema", () => {
  const detail = {
    id: UUID,
    userId: UUID_2,
    transactionId: null,
    eventType: "aml_rule_triggered",
    severity: "medium" as const,
    status: "under_review" as const,
    screeningProvider: "aml_engine",
    ruleOrHit: "velocity_daily_limit",
    createdAt: "2026-01-01T00:00:00.000Z",
    details: { window: "24h", limit: 1000 },
    dispositionComment: null,
    dispositionAt: null,
  };

  it("accepts a full detail object", () => {
    expect(ComplianceEventDetailSchema.parse(detail)).toEqual(detail);
  });

  it("accepts a disposition comment + timestamp", () => {
    const parsed = ComplianceEventDetailSchema.parse({
      ...detail,
      status: "approved",
      dispositionComment: "verified manually",
      dispositionAt: "2026-01-02T00:00:00.000Z",
    });
    expect(parsed.dispositionComment).toBe("verified manually");
    expect(parsed.dispositionAt).toBe("2026-01-02T00:00:00.000Z");
  });
});

describe("ComplianceDispositionRequestSchema", () => {
  it("accepts every disposable status", () => {
    for (const status of ["approved", "blocked", "dismissed", "under_review"]) {
      expect(
        ComplianceDispositionRequestSchema.parse({ status }).status,
      ).toBe(status);
    }
  });

  it("accepts an optional comment", () => {
    const parsed = ComplianceDispositionRequestSchema.parse({
      status: "approved",
      comment: "looks legit",
    });
    expect(parsed.comment).toBe("looks legit");
  });

  it("rejects 'flagged' (not a disposition target)", () => {
    expect(() =>
      ComplianceDispositionRequestSchema.parse({ status: "flagged" }),
    ).toThrow();
  });
});

describe("SanctionsRecordItemSchema / ListResponse", () => {
  const rec = {
    id: UUID,
    counterpartyId: "address:TXyz",
    verdict: "hit" as const,
    provider: "open_sanctions",
    screeningType: "transaction_counterparty",
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("accepts a well-formed record and every verdict", () => {
    expect(SanctionsRecordItemSchema.parse(rec)).toEqual(rec);
    for (const verdict of ["clear", "hit", "inconclusive"]) {
      expect(
        SanctionsRecordItemSchema.parse({ ...rec, verdict }).verdict,
      ).toBe(verdict);
    }
  });

  it("rejects an unknown verdict", () => {
    expect(() =>
      SanctionsRecordItemSchema.parse({ ...rec, verdict: "maybe" }),
    ).toThrow();
  });

  it("accepts a list response", () => {
    expect(
      SanctionsRecordListResponseSchema.parse({ items: [rec] }).items,
    ).toHaveLength(1);
  });
});

describe("AmlRuleSchema + create/update/list", () => {
  const rule = {
    id: UUID,
    ruleKey: "velocity_daily_limit",
    name: "Daily velocity limit",
    description: "Flags daily volume over threshold",
    enabled: true,
    ruleType: "velocity_amount" as const,
    action: "flag" as const,
    parameters: { window: "24h", limit: 1_000_000 },
    version: 1,
  };

  it("accepts a well-formed rule and every ruleType + action", () => {
    expect(AmlRuleSchema.parse(rule)).toEqual(rule);
    for (const ruleType of [
      "velocity_amount",
      "velocity_count",
      "behavior_pattern",
      "kyc_gate",
      "rate_limit",
    ]) {
      expect(AmlRuleSchema.parse({ ...rule, ruleType }).ruleType).toBe(
        ruleType,
      );
    }
    for (const action of ["flag", "block"]) {
      expect(AmlRuleSchema.parse({ ...rule, action }).action).toBe(action);
    }
  });

  it("accepts a list response", () => {
    expect(AmlRuleListResponseSchema.parse({ rules: [rule] }).rules).toHaveLength(
      1,
    );
  });

  it("create request defaults enabled to true", () => {
    const parsed = AmlRuleCreateRequestSchema.parse({
      ruleKey: "k",
      name: "n",
      description: "d",
      ruleType: "kyc_gate",
      action: "block",
      parameters: {},
    });
    expect(parsed.enabled).toBe(true);
  });

  it("create request accepts an explicit enabled:false", () => {
    expect(
      AmlRuleCreateRequestSchema.parse({
        ruleKey: "k",
        name: "n",
        description: "d",
        ruleType: "kyc_gate",
        action: "block",
        parameters: {},
        enabled: false,
      }).enabled,
    ).toBe(false);
  });

  it("update request accepts a partial patch", () => {
    const parsed = AmlRuleUpdateRequestSchema.parse({
      enabled: false,
      action: "block",
    });
    expect(parsed.enabled).toBe(false);
    expect(parsed.action).toBe("block");
    expect(parsed.name).toBeUndefined();
  });

  it("update request accepts an empty patch", () => {
    expect(AmlRuleUpdateRequestSchema.parse({})).toEqual({});
  });
});

describe("TravelRuleItemSchema / ListResponse", () => {
  const item = {
    id: UUID,
    transactionId: UUID_2,
    asset: "USDT",
    amount: "1500",
    amountFiat: "2400000.00",
    triggeringFactor: "amount_threshold",
    capturedAt: "2026-01-01T00:00:00.000Z",
    reportedAt: null,
  };

  it("accepts a well-formed item with a null reportedAt", () => {
    expect(TravelRuleItemSchema.parse(item)).toEqual(item);
  });

  it("accepts a reportedAt timestamp", () => {
    expect(
      TravelRuleItemSchema.parse({
        ...item,
        reportedAt: "2026-01-02T00:00:00.000Z",
      }).reportedAt,
    ).toBe("2026-01-02T00:00:00.000Z");
  });

  it("accepts a list response", () => {
    expect(
      TravelRuleListResponseSchema.parse({ items: [item] }).items,
    ).toHaveLength(1);
  });
});

describe("ComplianceReportSchema + draft/submit/list", () => {
  const report = {
    id: UUID,
    reportType: "sar" as const,
    status: "draft" as const,
    relatedEvents: [UUID_2],
    submittedAt: null,
    submissionRef: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("accepts a well-formed report and both report types", () => {
    expect(ComplianceReportSchema.parse(report)).toEqual(report);
    for (const reportType of ["sar", "str"]) {
      expect(
        ComplianceReportSchema.parse({ ...report, reportType }).reportType,
      ).toBe(reportType);
    }
  });

  it("accepts every report status", () => {
    for (const status of ["draft", "submitted", "rejected", "closed"]) {
      expect(
        ComplianceReportSchema.parse({ ...report, status }).status,
      ).toBe(status);
    }
  });

  it("accepts a list response", () => {
    expect(
      ComplianceReportListResponseSchema.parse({ items: [report] }).items,
    ).toHaveLength(1);
  });

  it("draft request requires reportType, relatedEvents and content", () => {
    const parsed = ComplianceReportDraftRequestSchema.parse({
      reportType: "str",
      relatedEvents: [UUID, UUID_2],
      content: { narrative: "structuring suspected" },
    });
    expect(parsed.reportType).toBe("str");
    expect(parsed.relatedEvents).toHaveLength(2);
  });

  it("submit request requires a non-empty submissionRef", () => {
    expect(
      ComplianceReportSubmitRequestSchema.parse({ submissionRef: "SEC-123" })
        .submissionRef,
    ).toBe("SEC-123");
    expect(() =>
      ComplianceReportSubmitRequestSchema.parse({ submissionRef: "" }),
    ).toThrow();
  });
});
