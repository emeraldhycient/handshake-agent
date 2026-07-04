import {
  TreasuryPayoutApproveRequestSchema,
  TreasuryPayoutApproveResponseSchema,
  TreasuryPayoutRetryRequestSchema,
  TreasuryPayoutRetryResponseSchema,
} from "./treasury-action.dto";

describe("TreasuryPayoutApproveRequestSchema", () => {
  it("accepts a reason within the change-request bounds", () => {
    const parsed = TreasuryPayoutApproveRequestSchema.parse({
      reason: "Large payout verified against the source order; releasing.",
    });
    expect(parsed.reason).toContain("payout");
  });

  it("rejects a too-short reason (<3 chars)", () => {
    expect(() =>
      TreasuryPayoutApproveRequestSchema.parse({ reason: "ok" }),
    ).toThrow();
  });

  it("rejects a too-long reason (>500 chars)", () => {
    expect(() =>
      TreasuryPayoutApproveRequestSchema.parse({ reason: "x".repeat(501) }),
    ).toThrow();
  });
});

describe("TreasuryPayoutApproveResponseSchema", () => {
  it("parses a pending maker-checker request with released:false", () => {
    const parsed = TreasuryPayoutApproveResponseSchema.parse({
      payoutId: "0190a000-0000-7000-8000-000000000001",
      changeRequestId: "0190a000-0000-7000-8000-000000000002",
      status: "pending",
      released: false,
    });
    expect(parsed.status).toBe("pending");
    expect(parsed.released).toBe(false);
  });

  it("rejects released:true — approving raises a request, never releases (§3.1)", () => {
    expect(() =>
      TreasuryPayoutApproveResponseSchema.parse({
        payoutId: "x",
        changeRequestId: "y",
        status: "pending",
        released: true,
      }),
    ).toThrow();
  });

  it("rejects a non-pending status — the release is not applied here", () => {
    expect(() =>
      TreasuryPayoutApproveResponseSchema.parse({
        payoutId: "x",
        changeRequestId: "y",
        status: "approved",
        released: false,
      }),
    ).toThrow();
  });
});

describe("TreasuryPayoutRetryRequestSchema", () => {
  it("accepts a reason within bounds", () => {
    const parsed = TreasuryPayoutRetryRequestSchema.parse({
      reason: "Payout stuck settling after a missed webhook; re-driving.",
    });
    expect(parsed.reason).toContain("settling");
  });

  it("rejects a too-short reason (<3 chars)", () => {
    expect(() =>
      TreasuryPayoutRetryRequestSchema.parse({ reason: "no" }),
    ).toThrow();
  });

  it("rejects a too-long reason (>500 chars)", () => {
    expect(() =>
      TreasuryPayoutRetryRequestSchema.parse({ reason: "x".repeat(501) }),
    ).toThrow();
  });
});

describe("TreasuryPayoutRetryResponseSchema", () => {
  it("parses a retry_enqueued result with reChecked:true", () => {
    const parsed = TreasuryPayoutRetryResponseSchema.parse({
      payoutId: "0190a000-0000-7000-8000-000000000001",
      transactionId: "0190a000-0000-7000-8000-0000000000aa",
      status: "retry_enqueued",
      reChecked: true,
    });
    expect(parsed.status).toBe("retry_enqueued");
    expect(parsed.reChecked).toBe(true);
  });

  it("rejects a status other than retry_enqueued (no money moves here, §3.1)", () => {
    expect(() =>
      TreasuryPayoutRetryResponseSchema.parse({
        payoutId: "x",
        transactionId: "y",
        status: "completed",
        reChecked: true,
      }),
    ).toThrow();
  });
});
