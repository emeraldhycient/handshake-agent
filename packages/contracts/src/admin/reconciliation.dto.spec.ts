import {
  ReconBreakKindSchema,
  ReconBreakSeveritySchema,
  ReconBreakStatusSchema,
  ReconBreakSchema,
  ReconBreakListResponseSchema,
  ReconStatusSchema,
} from "./reconciliation.dto";

describe("ReconBreakKindSchema", () => {
  it("accepts the four discrepancy classes", () => {
    for (const kind of [
      "over_credit",
      "missing_settlement",
      "amount_mismatch",
      "duplicate_credit",
    ]) {
      expect(ReconBreakKindSchema.parse(kind)).toBe(kind);
    }
  });

  it("rejects an unknown kind", () => {
    expect(ReconBreakKindSchema.safeParse("underpayment").success).toBe(false);
  });
});

describe("ReconBreakSeveritySchema", () => {
  it("accepts high / medium / low", () => {
    expect(ReconBreakSeveritySchema.parse("high")).toBe("high");
    expect(ReconBreakSeveritySchema.parse("medium")).toBe("medium");
    expect(ReconBreakSeveritySchema.parse("low")).toBe("low");
  });

  it("rejects an unknown severity", () => {
    expect(ReconBreakSeveritySchema.safeParse("urgent").success).toBe(false);
  });
});

describe("ReconBreakStatusSchema", () => {
  it("accepts open + the three Phase-7 outcomes", () => {
    for (const status of ["open", "resolved", "accepted", "escalated"]) {
      expect(ReconBreakStatusSchema.parse(status)).toBe(status);
    }
  });

  it("rejects an unknown status", () => {
    expect(ReconBreakStatusSchema.safeParse("closed").success).toBe(false);
  });
});

describe("ReconBreakSchema", () => {
  const valid = {
    id: "comp_9f2a41c7",
    kind: "over_credit",
    severity: "high",
    transactionId: "tx_9f2a41c7",
    asset: "USDT",
    delta: "+50.00",
    detail:
      "Ledger credited more than the provider confirmed. Flagged for human action — never auto-debited.",
    status: "open",
    detectedAt: "2026-07-01T04:00:00.000Z",
  };

  it("parses a well-formed break", () => {
    const parsed = ReconBreakSchema.parse(valid);
    expect(parsed.kind).toBe("over_credit");
    expect(parsed.delta).toBe("+50.00");
    expect(parsed.status).toBe("open");
  });

  it("rejects a break with a non-string delta (byte-stability invariant)", () => {
    expect(ReconBreakSchema.safeParse({ ...valid, delta: 50 }).success).toBe(
      false,
    );
  });

  it("rejects a break missing its detectedAt timestamp", () => {
    const { detectedAt: _omit, ...rest } = valid;
    expect(ReconBreakSchema.safeParse(rest).success).toBe(false);
  });
});

describe("ReconBreakListResponseSchema", () => {
  it("parses an empty break list", () => {
    expect(ReconBreakListResponseSchema.parse({ items: [] })).toEqual({
      items: [],
    });
  });

  it("rejects a non-array items field", () => {
    expect(ReconBreakListResponseSchema.safeParse({ items: {} }).success).toBe(
      false,
    );
  });
});

describe("ReconStatusSchema", () => {
  it("parses a scheduled, enabled status", () => {
    const parsed = ReconStatusSchema.parse({
      enabled: true,
      lastRunAt: "2026-07-01T04:00:00.000Z",
      nextRunAt: "2026-07-01T04:02:00.000Z",
      intervalSeconds: 120,
      openBreakCount: 3,
    });
    expect(parsed.enabled).toBe(true);
    expect(parsed.openBreakCount).toBe(3);
  });

  it("allows null last/next run (never run / not scheduled)", () => {
    const parsed = ReconStatusSchema.parse({
      enabled: false,
      lastRunAt: null,
      nextRunAt: null,
      intervalSeconds: 120,
      openBreakCount: 0,
    });
    expect(parsed.lastRunAt).toBeNull();
    expect(parsed.nextRunAt).toBeNull();
  });

  it("rejects a non-numeric open-break count", () => {
    expect(
      ReconStatusSchema.safeParse({
        enabled: true,
        lastRunAt: null,
        nextRunAt: null,
        intervalSeconds: 120,
        openBreakCount: "3",
      }).success,
    ).toBe(false);
  });
});
