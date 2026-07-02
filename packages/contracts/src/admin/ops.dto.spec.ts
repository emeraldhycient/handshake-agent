import {
  OpsHealthEnum,
  OpsProviderStatusSchema,
  OpsWebhookQueueSchema,
  OpsJobStatusEnum,
  OpsJobSchema,
  OpsBoardSchema,
} from "./ops.dto";

describe("OpsHealthEnum", () => {
  it("accepts ok / warn / down", () => {
    expect(OpsHealthEnum.parse("ok")).toBe("ok");
    expect(OpsHealthEnum.parse("warn")).toBe("warn");
    expect(OpsHealthEnum.parse("down")).toBe("down");
  });

  it("rejects an unknown health", () => {
    expect(OpsHealthEnum.safeParse("flaky").success).toBe(false);
  });
});

describe("OpsProviderStatusSchema", () => {
  it("parses a provider row with an observed latency", () => {
    const value = OpsProviderStatusSchema.parse({
      key: "blockradar",
      name: "Blockradar",
      health: "ok",
      lastLatencyMs: 120,
    });
    expect(value.key).toBe("blockradar");
    expect(value.health).toBe("ok");
    expect(value.lastLatencyMs).toBe(120);
  });

  it("allows a null latency (no observed dispatch to measure)", () => {
    const value = OpsProviderStatusSchema.parse({
      key: "resend",
      name: "Resend",
      health: "ok",
      lastLatencyMs: null,
    });
    expect(value.lastLatencyMs).toBeNull();
  });

  it("rejects a missing health", () => {
    expect(
      OpsProviderStatusSchema.safeParse({
        key: "resend",
        name: "Resend",
        lastLatencyMs: null,
      }).success,
    ).toBe(false);
  });
});

describe("OpsWebhookQueueSchema", () => {
  it("parses a queue row with depth + retries", () => {
    const value = OpsWebhookQueueSchema.parse({
      key: "blockradar.deposit",
      depth: 3,
      retries: 1,
      health: "warn",
    });
    expect(value.key).toBe("blockradar.deposit");
    expect(value.depth).toBe(3);
    expect(value.retries).toBe(1);
    expect(value.health).toBe("warn");
  });

  it("rejects a non-integer depth", () => {
    expect(
      OpsWebhookQueueSchema.safeParse({
        key: "blockradar.deposit",
        depth: 1.5,
        retries: 0,
        health: "ok",
      }).success,
    ).toBe(false);
  });

  it("rejects a negative retries count", () => {
    expect(
      OpsWebhookQueueSchema.safeParse({
        key: "whatsapp.inbound",
        depth: 0,
        retries: -1,
        health: "ok",
      }).success,
    ).toBe(false);
  });
});

describe("OpsJobStatusEnum", () => {
  it("accepts idle / running / ok / failed", () => {
    for (const status of ["idle", "running", "ok", "failed"]) {
      expect(OpsJobStatusEnum.parse(status)).toBe(status);
    }
  });

  it("rejects an unknown job status", () => {
    expect(OpsJobStatusEnum.safeParse("paused").success).toBe(false);
  });
});

describe("OpsJobSchema", () => {
  it("parses a cron-registry row with a last run", () => {
    const value = OpsJobSchema.parse({
      id: "settlement-reconciliation",
      name: "Reconciliation sweep",
      schedule: "*/2 * * * *",
      lastRunAt: "2026-07-01T09:00:00.000Z",
      status: "ok",
      health: "ok",
    });
    expect(value.id).toBe("settlement-reconciliation");
    expect(value.lastRunAt).toBe("2026-07-01T09:00:00.000Z");
    expect(value.status).toBe("ok");
  });

  it("allows a null lastRunAt (job has never observably run)", () => {
    const value = OpsJobSchema.parse({
      id: "sanctions-refresh",
      name: "Sanctions list refresh",
      schedule: "0 3 * * *",
      lastRunAt: null,
      status: "idle",
      health: "ok",
    });
    expect(value.lastRunAt).toBeNull();
  });

  it("rejects a missing schedule", () => {
    expect(
      OpsJobSchema.safeParse({
        id: "child-address-sweep",
        name: "Child-address sweep",
        lastRunAt: null,
        status: "idle",
        health: "ok",
      }).success,
    ).toBe(false);
  });
});

describe("OpsBoardSchema", () => {
  it("parses the composite ops board", () => {
    const value = OpsBoardSchema.parse({
      providers: [
        {
          key: "blockradar",
          name: "Blockradar",
          health: "ok",
          lastLatencyMs: 120,
        },
      ],
      webhookQueues: [
        { key: "blockradar.deposit", depth: 0, retries: 0, health: "ok" },
      ],
      jobs: [
        {
          id: "settlement-reconciliation",
          name: "Reconciliation sweep",
          schedule: "*/2 * * * *",
          lastRunAt: null,
          status: "idle",
          health: "ok",
        },
      ],
    });
    expect(value.providers).toHaveLength(1);
    expect(value.webhookQueues).toHaveLength(1);
    expect(value.jobs).toHaveLength(1);
  });

  it("parses an all-empty board", () => {
    const value = OpsBoardSchema.parse({
      providers: [],
      webhookQueues: [],
      jobs: [],
    });
    expect(value.providers).toEqual([]);
  });

  it("rejects when a section is missing", () => {
    expect(
      OpsBoardSchema.safeParse({
        providers: [],
        webhookQueues: [],
      }).success,
    ).toBe(false);
  });
});
