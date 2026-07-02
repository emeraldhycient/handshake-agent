import {
  AdminLedgerEntrySchema,
  AdminLedgerHistoryResponseSchema,
  AdminLedgerIntegrityResultSchema,
  AdminLedgerIntegritySummarySchema,
  AdminLedgerListQuerySchema,
  AdminLedgerListResponseSchema,
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
    expect(
      AdminLedgerHistoryResponseSchema.parse({ entries: [] }).entries,
    ).toEqual([]);
  });
});

describe("AdminLedgerListQuerySchema", () => {
  it("accepts an empty query (both filters optional)", () => {
    expect(AdminLedgerListQuerySchema.parse({})).toEqual({});
  });

  it("accepts accountType + currency + cursor + coerced limit", () => {
    const q = AdminLedgerListQuerySchema.parse({
      accountType: "user_wallet",
      currency: "USDT",
      cursor: UUID,
      limit: "25",
    });
    expect(q).toEqual({
      accountType: "user_wallet",
      currency: "USDT",
      cursor: UUID,
      limit: 25,
    });
  });

  it("rejects an empty-string accountType", () => {
    expect(() =>
      AdminLedgerListQuerySchema.parse({ accountType: "" }),
    ).toThrow();
  });

  it("rejects a limit over the 200 cap", () => {
    expect(() => AdminLedgerListQuerySchema.parse({ limit: 201 })).toThrow();
  });

  it("rejects a non-positive limit", () => {
    expect(() => AdminLedgerListQuerySchema.parse({ limit: 0 })).toThrow();
  });
});

describe("AdminLedgerListResponseSchema", () => {
  const entry = {
    id: UUID,
    transactionId: "txn-1",
    accountType: "treasury_reserve",
    accountId: "usdt_treasury",
    currency: "USDT",
    amount: "5",
    direction: "credit" as const,
    balanceAfter: "5",
    sequence: 1,
    postedAt: "2026-01-01T00:00:00.000Z",
  };

  it("accepts entries with a string nextCursor", () => {
    const res = AdminLedgerListResponseSchema.parse({
      entries: [entry],
      nextCursor: UUID,
    });
    expect(res.entries).toHaveLength(1);
    expect(res.nextCursor).toBe(UUID);
  });

  it("accepts an empty page with a null nextCursor", () => {
    const res = AdminLedgerListResponseSchema.parse({
      entries: [],
      nextCursor: null,
    });
    expect(res.entries).toEqual([]);
    expect(res.nextCursor).toBeNull();
  });

  it("rejects a missing nextCursor", () => {
    expect(() =>
      AdminLedgerListResponseSchema.parse({ entries: [] }),
    ).toThrow();
  });
});

describe("AdminLedgerIntegritySummarySchema", () => {
  it("accepts an all-clear summary with a null brokenAccount", () => {
    const s = AdminLedgerIntegritySummarySchema.parse({
      ok: true,
      accountsChecked: 12,
      brokenAccount: null,
    });
    expect(s.ok).toBe(true);
    expect(s.brokenAccount).toBeNull();
  });

  it("accepts a broken summary naming the offending sub-ledger", () => {
    const s = AdminLedgerIntegritySummarySchema.parse({
      ok: false,
      accountsChecked: 12,
      brokenAccount: "user_wallet:wallet-1:NGN",
    });
    expect(s.ok).toBe(false);
    expect(s.brokenAccount).toBe("user_wallet:wallet-1:NGN");
  });

  it("rejects a non-boolean ok", () => {
    expect(() =>
      AdminLedgerIntegritySummarySchema.parse({
        ok: "yes",
        accountsChecked: 1,
        brokenAccount: null,
      }),
    ).toThrow();
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
