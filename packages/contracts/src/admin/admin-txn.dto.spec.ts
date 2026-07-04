import {
  AdminTxnStatusSchema,
  AdminTxnSearchQuerySchema,
  AdminTxnListItemSchema,
  AdminTxnViewCountsSchema,
  AdminTxnListResponseSchema,
  AdminTxnLedgerLegSchema,
  AdminTxnEconomicsSchema,
  AdminTxnProviderReferenceSchema,
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

  it("accepts a full query (with free-text q) and coerces limit to an int", () => {
    const parsed = AdminTxnSearchQuerySchema.parse({
      status: "settling",
      type: "send",
      userId: UUID,
      q: "0xabc",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-02-01T00:00:00.000Z",
      cursor: "cur",
      limit: "50",
    });
    expect(parsed.status).toBe("settling");
    expect(parsed.type).toBe("send");
    expect(parsed.userId).toBe(UUID);
    expect(parsed.q).toBe("0xabc");
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
  const listItem = {
    id: UUID,
    userId: UUID_2,
    userEmail: "amara@example.com",
    type: "buy",
    status: "completed" as const,
    asset: "USDT",
    amount: "10.5",
    fiatAmount: "16500.00",
    fiatCurrency: "NGN",
    idempotencyKey: "idem-1",
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("accepts a well-formed list item with the enriched amount + user + idem fields", () => {
    expect(AdminTxnListItemSchema.parse(listItem)).toEqual(listItem);
  });

  it("accepts nullable money/email fields (unpopulated metadata)", () => {
    const parsed = AdminTxnListItemSchema.parse({
      ...listItem,
      userEmail: null,
      asset: null,
      amount: null,
      fiatAmount: null,
      fiatCurrency: null,
    });
    expect(parsed.asset).toBeNull();
    expect(parsed.userEmail).toBeNull();
    // idempotencyKey is never nullable — it is the at-most-once execution key.
    expect(parsed.idempotencyKey).toBe("idem-1");
  });

  it("rejects a missing idempotencyKey", () => {
    const { idempotencyKey: _omit, ...withoutIdem } = listItem;
    expect(() => AdminTxnListItemSchema.parse(withoutIdem)).toThrow();
  });

  it("rejects a non-uuid id", () => {
    expect(() =>
      AdminTxnListItemSchema.parse({ ...listItem, id: "x" }),
    ).toThrow();
  });

  it("accepts a response with items, a nullable cursor and view counts", () => {
    const res = AdminTxnListResponseSchema.parse({
      items: [listItem],
      nextCursor: null,
      counts: { all: 42, stuck: 3, failed: 1, refunds: 0 },
    });
    expect(res.items).toHaveLength(1);
    expect(res.nextCursor).toBeNull();
    expect(res.counts.all).toBe(42);
  });

  it("rejects a response missing the view counts", () => {
    expect(() =>
      AdminTxnListResponseSchema.parse({ items: [], nextCursor: null }),
    ).toThrow();
  });
});

describe("AdminTxnViewCountsSchema", () => {
  it("accepts non-negative integer counts", () => {
    const counts = { all: 10, stuck: 2, failed: 1, refunds: 4 };
    expect(AdminTxnViewCountsSchema.parse(counts)).toEqual(counts);
  });

  it("rejects a negative count", () => {
    expect(() =>
      AdminTxnViewCountsSchema.parse({
        all: -1,
        stuck: 0,
        failed: 0,
        refunds: 0,
      }),
    ).toThrow();
  });
});

describe("AdminTxnLedgerLegSchema", () => {
  it("accepts a well-formed leg including its sequence", () => {
    const leg = {
      accountType: "user_wallet",
      accountId: "wallet-1",
      currency: "USDT",
      amount: "10.5",
      direction: "credit" as const,
      balanceAfter: "100.5",
      sequence: 7,
      postedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(AdminTxnLedgerLegSchema.parse(leg)).toEqual(leg);
  });

  it("rejects a missing sequence", () => {
    expect(() =>
      AdminTxnLedgerLegSchema.parse({
        accountType: "user_wallet",
        accountId: "wallet-1",
        currency: "USDT",
        amount: "1",
        direction: "credit",
        balanceAfter: "1",
        postedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow();
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
        sequence: 1,
        postedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow();
  });
});

describe("AdminTxnEconomicsSchema", () => {
  const econ = {
    asset: "USDT",
    amount: "10.5",
    fiatAmount: "16500.00",
    fiatCurrency: "NGN",
    rate: "1571.43",
    processingFee: "82.50",
    fxSpreadBps: "150",
    internalMargin: "247.50",
    realizedFee: "82.50",
    realizedSpread: "165",
    realizedProfit: "247.50",
  };

  it("accepts a fully-populated economics block", () => {
    expect(AdminTxnEconomicsSchema.parse(econ)).toEqual(econ);
  });

  it("accepts an all-null economics block (nothing recorded in metadata)", () => {
    const empty = {
      asset: null,
      amount: null,
      fiatAmount: null,
      fiatCurrency: null,
      rate: null,
      processingFee: null,
      fxSpreadBps: null,
      internalMargin: null,
      realizedFee: null,
      realizedSpread: null,
      realizedProfit: null,
    };
    expect(AdminTxnEconomicsSchema.parse(empty)).toEqual(empty);
  });

  it("rejects a numeric amount (decimals are canonical strings)", () => {
    expect(() =>
      AdminTxnEconomicsSchema.parse({ ...econ, amount: 10.5 }),
    ).toThrow();
  });
});

describe("AdminTxnProviderReferenceSchema", () => {
  it("accepts a provider + reference pair", () => {
    const r = { provider: "blockradar", reference: "wd_abc123" };
    expect(AdminTxnProviderReferenceSchema.parse(r)).toEqual(r);
  });

  it("rejects a missing reference", () => {
    expect(() =>
      AdminTxnProviderReferenceSchema.parse({ provider: "tron" }),
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
    userEmail: "amara@example.com",
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
    economics: {
      asset: "USDT",
      amount: "10",
      fiatAmount: null,
      fiatCurrency: null,
      rate: null,
      processingFee: null,
      fxSpreadBps: null,
      internalMargin: null,
      realizedFee: null,
      realizedSpread: null,
      realizedProfit: null,
    },
    ledgerLegs: [
      {
        accountType: "user_wallet",
        accountId: "wallet-1",
        currency: "USDT",
        amount: "10",
        direction: "debit" as const,
        balanceAfter: "90",
        sequence: 1,
        postedAt: "2026-01-01T00:01:30.000Z",
      },
    ],
    timeline: [
      { status: "created", at: "2026-01-01T00:00:00.000Z" },
      { status: "completed", at: "2026-01-01T00:02:00.000Z" },
    ],
    providerReferences: [{ provider: "tron", reference: "0xabc" }],
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
