import {
  ReconResolveRequestSchema,
  ReconAcceptRequestSchema,
  ReconActionResponseSchema,
  EscalateBreakRequestSchema,
} from "./reconciliation-action.dto";

describe("ReconResolveRequestSchema / ReconAcceptRequestSchema", () => {
  it("accepts a non-empty reason for resolve", () => {
    const parsed = ReconResolveRequestSchema.parse({
      reason: "Webhook replayed; re-driving settlement via the engine.",
    });
    expect(parsed.reason).toContain("engine");
  });

  it("accepts a non-empty reason for accept", () => {
    const parsed = ReconAcceptRequestSchema.parse({
      reason: "Sub-cent rounding drift within tolerance; accepting.",
    });
    expect(parsed.reason).toContain("tolerance");
  });

  it("rejects an empty reason (audit must always carry a justification)", () => {
    expect(() => ReconResolveRequestSchema.parse({ reason: "" })).toThrow();
    expect(() => ReconAcceptRequestSchema.parse({ reason: "" })).toThrow();
  });
});

describe("ReconActionResponseSchema", () => {
  it("parses a resolved disposition with moved:false", () => {
    const parsed = ReconActionResponseSchema.parse({
      breakId: "cmp-1",
      disposition: "resolved",
      moved: false,
    });
    expect(parsed).toEqual({
      breakId: "cmp-1",
      disposition: "resolved",
      moved: false,
    });
  });

  it("parses an accepted disposition", () => {
    const parsed = ReconActionResponseSchema.parse({
      breakId: "out-2",
      disposition: "accepted",
      moved: false,
    });
    expect(parsed.disposition).toBe("accepted");
  });

  it("rejects moved:true — a disposition NEVER moves money (§3.1)", () => {
    expect(() =>
      ReconActionResponseSchema.parse({
        breakId: "x",
        disposition: "resolved",
        moved: true,
      }),
    ).toThrow();
  });
});

describe("EscalateBreakRequestSchema", () => {
  it("accepts a non-empty reason (opens a compliance case from the break)", () => {
    const parsed = EscalateBreakRequestSchema.parse({
      reason: "Persistent over-credit; escalating to compliance for review.",
    });
    expect(parsed.reason).toContain("compliance");
  });

  it("rejects a reason shorter than 3 characters", () => {
    expect(() => EscalateBreakRequestSchema.parse({ reason: "no" })).toThrow();
  });

  it("rejects a reason longer than 500 characters", () => {
    expect(() =>
      EscalateBreakRequestSchema.parse({ reason: "x".repeat(501) }),
    ).toThrow();
  });
});
