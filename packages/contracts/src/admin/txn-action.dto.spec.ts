import {
  AdminTxnMarkFailedRequestSchema,
  AdminTxnActionResponseSchema,
  TxnRerunReconRequestSchema,
} from "./txn-action.dto";

describe("AdminTxnMarkFailedRequestSchema", () => {
  it("accepts a non-empty reason", () => {
    const parsed = AdminTxnMarkFailedRequestSchema.parse({
      reason: "Stuck for 3 days; payout provider confirmed cancelled.",
    });
    expect(parsed.reason).toBe(
      "Stuck for 3 days; payout provider confirmed cancelled.",
    );
  });

  it("rejects an empty reason (audit must always carry a justification)", () => {
    expect(() => AdminTxnMarkFailedRequestSchema.parse({ reason: "" })).toThrow();
  });

  it("rejects a missing reason", () => {
    expect(() => AdminTxnMarkFailedRequestSchema.parse({})).toThrow();
  });
});

describe("AdminTxnActionResponseSchema", () => {
  it("parses a mark-failed-with-refund outcome", () => {
    const parsed = AdminTxnActionResponseSchema.parse({
      transactionId: "0190a000-0000-7000-8000-000000000001",
      status: "failed",
      refunded: true,
    });
    expect(parsed).toEqual({
      transactionId: "0190a000-0000-7000-8000-000000000001",
      status: "failed",
      refunded: true,
    });
  });

  it("parses a retry outcome (refunded false, status unchanged)", () => {
    const parsed = AdminTxnActionResponseSchema.parse({
      transactionId: "0190a000-0000-7000-8000-000000000002",
      status: "settling",
      refunded: false,
    });
    expect(parsed.refunded).toBe(false);
    expect(parsed.status).toBe("settling");
  });

  it("rejects a non-boolean refunded flag", () => {
    expect(() =>
      AdminTxnActionResponseSchema.parse({
        transactionId: "x",
        status: "failed",
        refunded: "yes",
      }),
    ).toThrow();
  });
});

describe("TxnRerunReconRequestSchema", () => {
  it("accepts an optional reason", () => {
    const parsed = TxnRerunReconRequestSchema.parse({
      reason: "Re-running settlement recon after provider webhook replay.",
    });
    expect(parsed.reason).toContain("recon");
  });

  it("accepts an omitted reason (re-run recon is a read-only detection)", () => {
    expect(TxnRerunReconRequestSchema.parse({})).toEqual({});
  });

  it("rejects a reason longer than 500 characters", () => {
    expect(() =>
      TxnRerunReconRequestSchema.parse({ reason: "x".repeat(501) }),
    ).toThrow();
  });
});
