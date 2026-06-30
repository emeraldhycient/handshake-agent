import {
  AdminTxnStatusSchema,
  AdminTxnSearchQuerySchema,
  AdminTxnListItemSchema,
  AdminTxnListResponseSchema,
  AdminTxnLedgerLegSchema,
  AdminTxnTimelineEntrySchema,
  AdminTxnDetailSchema,
} from "./admin-txn.dto";

const UUID = "11111111-1111-1111-1111-111111111111";
const UUID_2 = "22222222-2222-2222-2222-222222222222";

describe("AdminTxnStatusSchema", () => {
  it("accepts every Transaction lifecycle status", () => {
    for (const s of [
      "pending",
      "validating",
      "confirmed",
      "settling",
      "completed",
      "failed",
      "rolled_back",
      "cancelled",
    ]) {
      expect(AdminTxnStatusSchema.parse(s)).toBe(s);
    }
  });

  it("rejects an unknown status", () => {
    expect(() => AdminTxnStatusSchema.parse("exploded")).toThrow();
  });
});

describe("AdminTxnSearchQuerySchema", () => {
  it("accepts an empty query (all fields optional)", () => {
    expect(AdminTxnSearchQuerySchema.parse({})).toEqual({});
  });

  it("accepts a full query and coerces limit to an int", () => {
    const parsed = AdminTxnSearchQuerySchema.parse({
      status: "settling",
      type: "send",
      userId: UUID,
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-02-01T00:00:00.000Z",
      cursor: "cur",
      limit: "50",
    });
    expect(parsed.status).toBe("settling");
    expect(parsed.type).toBe("send");
    expect(parsed.userId).toBe(UUID);
    expect(parsed.limit).toBe(50);
  });

  it("rejects a non-uuid userId", () => {
    expect(() => AdminTxnSearchQuerySchema.parse({ userId: "nope" })).toThrow();
  });

  it("rejects a limit over 100", () => {
    expect(() => AdminTxnSearchQuerySchema.parse({ limit: "101" })).toThrow();
  });

  it("rejects an unknown status", () => {
    expect(() =>
      AdminTxnSearchQuerySchema.parse({ status: "weird" }),
    ).toThrow();
  });
});

describe("AdminTxnListItemSchema / AdminTxnListResponseSchema", () => {
  it("accepts a well-formed list item", () => {
    const item = {
      id: UUID,
      userId: UUID_2,
      type: "buy",
      status: "completed",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    expect(AdminTxnListItemSchema.parse(item)).toEqual(item);
  });

  it("rejects a non-uuid id", () => {
    expect(() =>
      AdminTxnListItemSchema.parse({
        id: "x",
        userId: UUID_2,
        type: "buy",
        status: "completed",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("accepts a response with items and a nullable cursor", () => {
    const res = AdminTxnListResponseSchema.parse({
      items: [
        {
          id: UUID,
          userId: UUID_2,
          type: "buy",
          status: "completed",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      nextCursor: null,
    });
    expect(res.items).toHaveLength(1);
    expect(res.nextCursor).toBeNull();
  });
});

describe("AdminTxnLedgerLegSchema", () => {
  it("accepts a well-formed leg", () => {
    const leg = {
      accountType: "user_wallet",
      accountId: "wallet-1",
      currency: "USDT",
      amount: "10.5",
      direction: "credit" as const,
      balanceAfter: "100.5",
      postedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(AdminTxnLedgerLegSchema.parse(leg)).toEqual(leg);
  });

  it("rejects an invalid direction", () => {
    expect(() =>
      AdminTxnLedgerLegSchema.parse({
        accountType: "user_wallet",
        accountId: "wallet-1",
        currency: "USDT",
        amount: "1",
        direction: "sideways",
        balanceAfter: "1",
        postedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow();
  });
});

describe("AdminTxnTimelineEntrySchema", () => {
  it("accepts a status + at pair", () => {
    const e = { status: "created", at: "2026-01-01T00:00:00.000Z" };
    expect(AdminTxnTimelineEntrySchema.parse(e)).toEqual(e);
  });
});

describe("AdminTxnDetailSchema", () => {
  const base = {
    id: UUID,
    userId: UUID_2,
    type: "send",
    status: "completed",
    idempotencyKey: "idem-key",
    processorTxRef: null,
    onChainTxHash: "0xabc",
    failureReason: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    executedAt: "2026-01-01T00:01:00.000Z",
    completedAt: "2026-01-01T00:02:00.000Z",
    failedAt: null,
    ledgerLegs: [
      {
        accountType: "user_wallet",
        accountId: "wallet-1",
        currency: "USDT",
        amount: "10",
        direction: "debit" as const,
        balanceAfter: "90",
        postedAt: "2026-01-01T00:01:30.000Z",
      },
    ],
    timeline: [
      { status: "created", at: "2026-01-01T00:00:00.000Z" },
      { status: "completed", at: "2026-01-01T00:02:00.000Z" },
    ],
  };

  it("accepts a full detail object", () => {
    expect(AdminTxnDetailSchema.parse(base)).toEqual(base);
  });

  it("accepts nullable optional timestamps and refs", () => {
    const parsed = AdminTxnDetailSchema.parse({
      ...base,
      processorTxRef: "flw-ref",
      onChainTxHash: null,
      executedAt: null,
      completedAt: null,
      failedAt: "2026-01-01T00:03:00.000Z",
      failureReason: "insufficient funds",
    });
    expect(parsed.onChainTxHash).toBeNull();
    expect(parsed.failedAt).toBe("2026-01-01T00:03:00.000Z");
    expect(parsed.failureReason).toBe("insufficient funds");
  });

  it("rejects a non-uuid id", () => {
    expect(() => AdminTxnDetailSchema.parse({ ...base, id: "x" })).toThrow();
  });
});
