import {
  AdminLedgerEntrySchema,
  AdminLedgerHistoryResponseSchema,
  AdminLedgerIntegrityResultSchema,
} from "./admin-ledger.dto";

const UUID = "11111111-1111-1111-1111-111111111111";

describe("AdminLedgerEntrySchema", () => {
  const base = {
    id: UUID,
    transactionId: "txn-1",
    accountType: "user_wallet",
    accountId: "wallet-1",
    currency: "USDT",
    amount: "10.5",
    direction: "credit" as const,
    balanceAfter: "100.5",
    sequence: 3,
    postedAt: "2026-01-01T00:00:00.000Z",
  };

  it("accepts a well-formed entry", () => {
    expect(AdminLedgerEntrySchema.parse(base)).toEqual(base);
  });

  it("accepts a debit direction", () => {
    expect(
      AdminLedgerEntrySchema.parse({ ...base, direction: "debit" }).direction,
    ).toBe("debit");
  });

  it("rejects a non-uuid id", () => {
    expect(() => AdminLedgerEntrySchema.parse({ ...base, id: "x" })).toThrow();
  });

  it("rejects an invalid direction", () => {
    expect(() =>
      AdminLedgerEntrySchema.parse({ ...base, direction: "up" }),
    ).toThrow();
  });

  it("rejects a non-number sequence", () => {
    expect(() =>
      AdminLedgerEntrySchema.parse({ ...base, sequence: "3" }),
    ).toThrow();
  });
});

describe("AdminLedgerHistoryResponseSchema", () => {
  it("accepts an entries array", () => {
    const res = AdminLedgerHistoryResponseSchema.parse({
      entries: [
        {
          id: UUID,
          transactionId: "txn-1",
          accountType: "user_wallet",
          accountId: "wallet-1",
          currency: "USDT",
          amount: "1",
          direction: "credit",
          balanceAfter: "1",
          sequence: 1,
          postedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(res.entries).toHaveLength(1);
  });

  it("accepts an empty entries array", () => {
    expect(AdminLedgerHistoryResponseSchema.parse({ entries: [] }).entries).toEqual(
      [],
    );
  });
});

describe("AdminLedgerIntegrityResultSchema", () => {
  it("accepts a balanced result with a null brokenAt", () => {
    const r = AdminLedgerIntegrityResultSchema.parse({
      transactionId: "txn-1",
      balanced: true,
      legCount: 2,
      brokenAt: null,
    });
    expect(r.balanced).toBe(true);
    expect(r.brokenAt).toBeNull();
  });

  it("accepts an unbalanced result naming the broken currency", () => {
    const r = AdminLedgerIntegrityResultSchema.parse({
      transactionId: "txn-1",
      balanced: false,
      legCount: 3,
      brokenAt: "USDT",
    });
    expect(r.balanced).toBe(false);
    expect(r.brokenAt).toBe("USDT");
  });

  it("rejects a non-boolean balanced", () => {
    expect(() =>
      AdminLedgerIntegrityResultSchema.parse({
        transactionId: "txn-1",
        balanced: "yes",
        legCount: 2,
        brokenAt: null,
      }),
    ).toThrow();
  });
});
