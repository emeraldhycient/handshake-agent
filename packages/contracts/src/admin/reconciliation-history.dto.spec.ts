import {
  ReconRunTypeSchema,
  ReconRunStatusSchema,
  ReconRunSchema,
  ReconRunListResponseSchema,
  PersistedReconBreakTypeSchema,
  PersistedReconBreakStatusSchema,
  PersistedReconBreakSchema,
  ReconRunDetailSchema,
  ReconBreakActionRequestSchema,
} from "./reconciliation-history.dto";

describe("ReconRunTypeSchema", () => {
  it("accepts the two run types", () => {
    for (const t of ["settlement_outbox", "wallet_deposit"]) {
      expect(ReconRunTypeSchema.parse(t)).toBe(t);
    }
  });

  it("rejects an unknown run type", () => {
    expect(ReconRunTypeSchema.safeParse("wallet").success).toBe(false);
  });
});

describe("ReconRunStatusSchema", () => {
  it("accepts running / completed / failed", () => {
    for (const s of ["running", "completed", "failed"]) {
      expect(ReconRunStatusSchema.parse(s)).toBe(s);
    }
  });

  it("rejects an unknown status", () => {
    expect(ReconRunStatusSchema.safeParse("done").success).toBe(false);
  });
});

describe("ReconRunSchema", () => {
  const valid = {
    id: "run_9f2a41c7",
    runType: "settlement_outbox",
    status: "completed",
    totalChecked: 12,
    breaksDetected: 2,
    startedAt: "2026-07-04T04:00:00.000Z",
    completedAt: "2026-07-04T04:00:03.000Z",
    createdAt: "2026-07-04T04:00:00.000Z",
  };

  it("parses a well-formed completed run", () => {
    const parsed = ReconRunSchema.parse(valid);
    expect(parsed.runType).toBe("settlement_outbox");
    expect(parsed.breaksDetected).toBe(2);
  });

  it("allows a null completedAt for a still-running run", () => {
    const parsed = ReconRunSchema.parse({
      ...valid,
      status: "running",
      completedAt: null,
    });
    expect(parsed.completedAt).toBeNull();
  });

  it("rejects a negative totalChecked", () => {
    expect(
      ReconRunSchema.safeParse({ ...valid, totalChecked: -1 }).success,
    ).toBe(false);
  });

  it("rejects a non-integer breaksDetected", () => {
    expect(
      ReconRunSchema.safeParse({ ...valid, breaksDetected: 1.5 }).success,
    ).toBe(false);
  });
});

describe("ReconRunListResponseSchema", () => {
  it("parses an empty page with a null cursor", () => {
    expect(
      ReconRunListResponseSchema.parse({ items: [], nextCursor: null }),
    ).toEqual({ items: [], nextCursor: null });
  });

  it("rejects a non-array items field", () => {
    expect(
      ReconRunListResponseSchema.safeParse({ items: {}, nextCursor: null })
        .success,
    ).toBe(false);
  });
});

describe("PersistedReconBreakTypeSchema", () => {
  it("accepts the three break classes", () => {
    for (const t of ["balance_mismatch", "over_credit", "settlement_failure"]) {
      expect(PersistedReconBreakTypeSchema.parse(t)).toBe(t);
    }
  });

  it("rejects an unknown break type", () => {
    expect(
      PersistedReconBreakTypeSchema.safeParse("duplicate_credit").success,
    ).toBe(false);
  });
});

describe("PersistedReconBreakStatusSchema", () => {
  it("accepts the four lifecycle states", () => {
    for (const s of ["detected", "acknowledged", "resolved", "rejected"]) {
      expect(PersistedReconBreakStatusSchema.parse(s)).toBe(s);
    }
  });

  it("rejects an unknown lifecycle state", () => {
    expect(PersistedReconBreakStatusSchema.safeParse("open").success).toBe(
      false,
    );
  });
});

describe("PersistedReconBreakSchema", () => {
  const valid = {
    id: "brk_9f2a41c7",
    reconRunId: "run_9f2a41c7",
    breakType: "over_credit",
    userId: "usr_1",
    walletId: "wal_1",
    outboxId: null,
    currency: "USDT",
    delta: "-50.00",
    status: "detected",
    approvedByAdminId: null,
    reason: null,
    actionAt: null,
    createdAt: "2026-07-04T04:00:00.000Z",
    updatedAt: "2026-07-04T04:00:00.000Z",
  };

  it("parses a well-formed detected break", () => {
    const parsed = PersistedReconBreakSchema.parse(valid);
    expect(parsed.breakType).toBe("over_credit");
    expect(parsed.delta).toBe("-50.00");
    expect(parsed.status).toBe("detected");
  });

  it("parses a resolved break carrying its admin annotation", () => {
    const parsed = PersistedReconBreakSchema.parse({
      ...valid,
      status: "resolved",
      approvedByAdminId: "adm_1",
      reason: "Confirmed lagged provider balance; ledger is authoritative.",
      actionAt: "2026-07-04T05:00:00.000Z",
    });
    expect(parsed.status).toBe("resolved");
    expect(parsed.approvedByAdminId).toBe("adm_1");
  });

  it("allows null userId/walletId/outboxId (settlement breaks carry an outboxId only)", () => {
    const parsed = PersistedReconBreakSchema.parse({
      ...valid,
      breakType: "settlement_failure",
      userId: null,
      walletId: null,
      outboxId: "obx_1",
    });
    expect(parsed.userId).toBeNull();
    expect(parsed.outboxId).toBe("obx_1");
  });

  it("rejects a non-string delta (byte-stability invariant)", () => {
    expect(
      PersistedReconBreakSchema.safeParse({ ...valid, delta: -50 }).success,
    ).toBe(false);
  });
});

describe("ReconRunDetailSchema", () => {
  const run = {
    id: "run_1",
    runType: "wallet_deposit",
    status: "completed",
    totalChecked: 3,
    breaksDetected: 1,
    startedAt: "2026-07-04T04:00:00.000Z",
    completedAt: "2026-07-04T04:00:03.000Z",
    createdAt: "2026-07-04T04:00:00.000Z",
  };

  it("parses a run with its break list", () => {
    const parsed = ReconRunDetailSchema.parse({ run, breaks: [] });
    expect(parsed.run.runType).toBe("wallet_deposit");
    expect(parsed.breaks).toEqual([]);
  });

  it("rejects a detail missing its run", () => {
    expect(ReconRunDetailSchema.safeParse({ breaks: [] }).success).toBe(false);
  });
});

describe("ReconBreakActionRequestSchema", () => {
  it("parses a non-empty reason", () => {
    expect(ReconBreakActionRequestSchema.parse({ reason: "ack" })).toEqual({
      reason: "ack",
    });
  });

  it("rejects an empty reason (audited justification is mandatory)", () => {
    expect(
      ReconBreakActionRequestSchema.safeParse({ reason: "" }).success,
    ).toBe(false);
  });
});
