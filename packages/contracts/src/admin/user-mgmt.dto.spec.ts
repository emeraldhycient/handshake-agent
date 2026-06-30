import {
  AdminEndUserStatusSchema,
  KycTierSchema,
  KycStatusSchema,
  AdminEndUserSearchQuerySchema,
  AdminEndUserListItemSchema,
  AdminEndUserListResponseSchema,
  AdminEndUserDeviceSchema,
  AdminEndUserBalanceSchema,
  AdminEndUserTxnSchema,
  AdminEndUserBeneficiarySchema,
  AdminEndUserDetailSchema,
  AdminEndUserTierRequestSchema,
  AdminEndUserStatusRequestSchema,
} from "./user-mgmt.dto";

const ID = "11111111-1111-1111-1111-111111111111";
const DEVICE_ID = "22222222-2222-2222-2222-222222222222";

const listItem = {
  id: ID,
  email: "user@example.com",
  status: "active" as const,
  kycStatus: "verified" as const,
  kycTier: "tier_2" as const,
  simSwapFlagged: false,
  createdAt: "2026-06-30T12:00:00.000Z",
};

const device = {
  id: DEVICE_ID,
  trustState: "bound" as const,
  isPinned: true,
  lastUsedAt: "2026-06-30T12:00:00.000Z",
  boundAt: "2026-06-29T12:00:00.000Z",
};

const balance = {
  asset: "USDT",
  network: "TRON",
  amount: "100.50",
};

const txn = {
  id: ID,
  type: "buy",
  status: "settled",
  createdAt: "2026-06-30T12:00:00.000Z",
};

const beneficiary = {
  id: ID,
  type: "bank_account" as const,
  label: "GTBank ****1234",
  verificationStatus: "verified",
};

const detail = {
  id: ID,
  email: "user@example.com",
  status: "active" as const,
  kycStatus: "verified" as const,
  kycTier: "tier_2" as const,
  simSwapDetectedAt: null,
  createdAt: "2026-06-30T12:00:00.000Z",
  devices: [device],
  balances: [balance],
  recentTransactions: [txn],
  beneficiaries: [beneficiary],
};

describe("AdminEndUserStatusSchema", () => {
  it("accepts a modelled end-user status", () => {
    expect(AdminEndUserStatusSchema.parse("provisional")).toBe("provisional");
  });

  it("rejects an unknown status", () => {
    expect(() => AdminEndUserStatusSchema.parse("banned")).toThrow();
  });
});

describe("KycTierSchema", () => {
  it("accepts a modelled tier", () => {
    expect(KycTierSchema.parse("unverified")).toBe("unverified");
  });

  it("rejects an unknown tier", () => {
    expect(() => KycTierSchema.parse("tier_4")).toThrow();
  });
});

describe("KycStatusSchema", () => {
  it("accepts a modelled kyc status", () => {
    expect(KycStatusSchema.parse("pending_review")).toBe("pending_review");
  });

  it("rejects an unknown kyc status", () => {
    expect(() => KycStatusSchema.parse("approved")).toThrow();
  });
});

describe("AdminEndUserSearchQuerySchema", () => {
  it("coerces a string limit and parses optional filters", () => {
    const parsed = AdminEndUserSearchQuerySchema.parse({
      query: "alice",
      status: "active",
      kycTier: "tier_1",
      limit: "50",
    });
    expect(parsed.limit).toBe(50);
  });

  it("rejects a limit above the max of 100", () => {
    expect(() => AdminEndUserSearchQuerySchema.parse({ limit: "101" })).toThrow();
  });
});

describe("AdminEndUserListItemSchema", () => {
  it("parses a list item with a null email", () => {
    const parsed = AdminEndUserListItemSchema.parse({
      ...listItem,
      email: null,
    });
    expect(parsed.email).toBeNull();
  });

  it("rejects a non-uuid id", () => {
    expect(() =>
      AdminEndUserListItemSchema.parse({ ...listItem, id: "not-a-uuid" }),
    ).toThrow();
  });
});

describe("AdminEndUserListResponseSchema", () => {
  it("parses a paginated list", () => {
    const parsed = AdminEndUserListResponseSchema.parse({
      items: [listItem],
      nextCursor: "cursor-abc",
    });
    expect(parsed.items).toHaveLength(1);
  });

  it("rejects a missing nextCursor field", () => {
    expect(() =>
      AdminEndUserListResponseSchema.parse({ items: [listItem] }),
    ).toThrow();
  });
});

describe("AdminEndUserDeviceSchema", () => {
  it("parses a device with null timestamps", () => {
    const parsed = AdminEndUserDeviceSchema.parse({
      ...device,
      lastUsedAt: null,
      boundAt: null,
    });
    expect(parsed.boundAt).toBeNull();
  });

  it("rejects an unknown trust state", () => {
    expect(() =>
      AdminEndUserDeviceSchema.parse({ ...device, trustState: "trusted" }),
    ).toThrow();
  });
});

describe("AdminEndUserBalanceSchema", () => {
  it("parses a crypto balance", () => {
    const parsed = AdminEndUserBalanceSchema.parse(balance);
    expect(parsed.amount).toBe("100.50");
  });

  it("rejects a non-numeric amount", () => {
    expect(() =>
      AdminEndUserBalanceSchema.parse({ ...balance, amount: "abc" }),
    ).toThrow();
  });
});

describe("AdminEndUserTxnSchema", () => {
  it("parses a transaction summary", () => {
    expect(AdminEndUserTxnSchema.parse(txn).type).toBe("buy");
  });

  it("rejects a non-uuid id", () => {
    expect(() =>
      AdminEndUserTxnSchema.parse({ ...txn, id: "nope" }),
    ).toThrow();
  });
});

describe("AdminEndUserBeneficiarySchema", () => {
  it("parses a beneficiary", () => {
    expect(AdminEndUserBeneficiarySchema.parse(beneficiary).type).toBe(
      "bank_account",
    );
  });

  it("rejects an unknown beneficiary type", () => {
    expect(() =>
      AdminEndUserBeneficiarySchema.parse({ ...beneficiary, type: "card" }),
    ).toThrow();
  });
});

describe("AdminEndUserDetailSchema", () => {
  it("parses a full end-user detail aggregate", () => {
    const parsed = AdminEndUserDetailSchema.parse(detail);
    expect(parsed.devices).toHaveLength(1);
    expect(parsed.simSwapDetectedAt).toBeNull();
  });

  it("rejects a detail with a malformed nested device", () => {
    expect(() =>
      AdminEndUserDetailSchema.parse({
        ...detail,
        devices: [{ ...device, trustState: "trusted" }],
      }),
    ).toThrow();
  });
});

describe("AdminEndUserTierRequestSchema", () => {
  it("parses a tier-change request", () => {
    expect(AdminEndUserTierRequestSchema.parse({ tier: "tier_3" }).tier).toBe(
      "tier_3",
    );
  });

  it("rejects an unknown tier", () => {
    expect(() => AdminEndUserTierRequestSchema.parse({ tier: "tier_9" })).toThrow();
  });
});

describe("AdminEndUserStatusRequestSchema", () => {
  it("parses a status-change request", () => {
    expect(
      AdminEndUserStatusRequestSchema.parse({ status: "suspended" }).status,
    ).toBe("suspended");
  });

  it("rejects 'provisional' (not an admin-settable status)", () => {
    expect(() =>
      AdminEndUserStatusRequestSchema.parse({ status: "provisional" }),
    ).toThrow();
  });
});
