import {
  AdminOpsRunRequestSchema,
  AdminOpsRunResponseSchema,
} from "./ops-action.dto";

describe("AdminOpsRunRequestSchema", () => {
  it("accepts a non-empty reason", () => {
    const parsed = AdminOpsRunRequestSchema.parse({
      reason: "Backlog cleared upstream; re-driving settlement now.",
    });
    expect(parsed.reason).toContain("re-driving");
  });

  it("rejects an empty reason (every manual run carries a why)", () => {
    expect(() => AdminOpsRunRequestSchema.parse({ reason: "" })).toThrow();
  });

  it("rejects a missing reason", () => {
    expect(() => AdminOpsRunRequestSchema.parse({})).toThrow();
  });
});

describe("AdminOpsRunResponseSchema", () => {
  it("parses a triggered run", () => {
    const parsed = AdminOpsRunResponseSchema.parse({
      jobId: "settlement-reconciliation",
      triggered: true,
      status: "running",
    });
    expect(parsed).toEqual({
      jobId: "settlement-reconciliation",
      triggered: true,
      status: "running",
    });
  });

  it("parses a not-triggered run (job not manually triggerable)", () => {
    const parsed = AdminOpsRunResponseSchema.parse({
      jobId: "sanctions-refresh",
      triggered: false,
      status: "idle",
    });
    expect(parsed.triggered).toBe(false);
  });

  it("rejects a non-boolean triggered flag", () => {
    expect(() =>
      AdminOpsRunResponseSchema.parse({
        jobId: "x",
        triggered: "yes",
        status: "running",
      }),
    ).toThrow();
  });
});
