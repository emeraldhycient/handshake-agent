import {
  ProviderStatusEnum,
  ProviderHealthSchema,
  SystemHealthSchema,
  ActivityKindEnum,
  ActivityEventSchema,
  OpenComplianceSchema,
  MetricsOpsSchema,
} from "./metrics-ops.dto";

describe("ProviderStatusEnum", () => {
  it("accepts ok / degraded / down", () => {
    expect(ProviderStatusEnum.parse("ok")).toBe("ok");
    expect(ProviderStatusEnum.parse("degraded")).toBe("degraded");
    expect(ProviderStatusEnum.parse("down")).toBe("down");
  });

  it("rejects an unknown status", () => {
    expect(ProviderStatusEnum.safeParse("flaky").success).toBe(false);
  });
});

describe("ProviderHealthSchema", () => {
  it("parses a provider row with an observed latency", () => {
    const value = ProviderHealthSchema.parse({
      key: "blockradar",
      name: "Blockradar",
      note: "Custodial WaaS · TRON",
      status: "ok",
      lastLatencyMs: 120,
    });
    expect(value.key).toBe("blockradar");
    expect(value.status).toBe("ok");
    expect(value.lastLatencyMs).toBe(120);
  });

  it("allows a null latency (no observed dispatch to measure)", () => {
    const value = ProviderHealthSchema.parse({
      key: "resend",
      name: "Resend",
      note: "Email",
      status: "ok",
      lastLatencyMs: null,
    });
    expect(value.lastLatencyMs).toBeNull();
  });

  it("rejects a missing status", () => {
    expect(
      ProviderHealthSchema.safeParse({
        key: "resend",
        name: "Resend",
        note: "Email",
        lastLatencyMs: null,
      }).success,
    ).toBe(false);
  });
});

describe("SystemHealthSchema", () => {
  it("parses providers + queue depth + recon drift", () => {
    const value = SystemHealthSchema.parse({
      providers: [
        {
          key: "flutterwave",
          name: "Flutterwave",
          note: "NGN rails",
          status: "degraded",
          lastLatencyMs: 890,
        },
      ],
      webhookQueueDepth: 3,
      reconDriftCount: 2,
    });
    expect(value.providers).toHaveLength(1);
    expect(value.webhookQueueDepth).toBe(3);
    expect(value.reconDriftCount).toBe(2);
  });

  it("rejects a non-numeric queue depth", () => {
    expect(
      SystemHealthSchema.safeParse({
        providers: [],
        webhookQueueDepth: "3",
        reconDriftCount: 0,
      }).success,
    ).toBe(false);
  });
});

describe("ActivityKindEnum", () => {
  it("accepts the six real activity kinds", () => {
    for (const kind of [
      "settled",
      "kyc_approved",
      "config_change",
      "failed",
      "sweep",
      "refund",
    ]) {
      expect(ActivityKindEnum.parse(kind)).toBe(kind);
    }
  });

  it("rejects an unknown kind", () => {
    expect(ActivityKindEnum.safeParse("login").success).toBe(false);
  });
});

describe("ActivityEventSchema", () => {
  it("parses a feed row", () => {
    const value = ActivityEventSchema.parse({
      id: "evt_1",
      kind: "settled",
      title: "Buy settled",
      meta: "tx_80231 · 120.00 USDT",
      at: "2026-07-01T09:00:00.000Z",
    });
    expect(value.kind).toBe("settled");
    expect(value.title).toBe("Buy settled");
  });

  it("rejects a row missing a timestamp", () => {
    expect(
      ActivityEventSchema.safeParse({
        id: "evt_1",
        kind: "settled",
        title: "Buy settled",
        meta: "tx_80231",
      }).success,
    ).toBe(false);
  });
});

describe("OpenComplianceSchema", () => {
  it("parses an open-cases count", () => {
    expect(OpenComplianceSchema.parse({ openCases: 3 })).toEqual({
      openCases: 3,
    });
  });
});

describe("MetricsOpsSchema", () => {
  it("parses the composite ops payload", () => {
    const value = MetricsOpsSchema.parse({
      systemHealth: {
        providers: [],
        webhookQueueDepth: 0,
        reconDriftCount: 0,
      },
      activityFeed: [],
      compliance: { openCases: 0 },
    });
    expect(value.systemHealth.webhookQueueDepth).toBe(0);
    expect(value.activityFeed).toEqual([]);
    expect(value.compliance.openCases).toBe(0);
  });

  it("rejects when a section is missing", () => {
    expect(
      MetricsOpsSchema.safeParse({
        systemHealth: {
          providers: [],
          webhookQueueDepth: 0,
          reconDriftCount: 0,
        },
        activityFeed: [],
      }).success,
    ).toBe(false);
  });
});
