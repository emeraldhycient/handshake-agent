import {
  AdminEndUserStatusSchema,
  KycTierSchema,
  KycStatusSchema,
  AdminEndUserSearchQuerySchema,
  AdminEndUserBalanceSummarySchema,
  AdminEndUserListItemSchema,
  AdminEndUserListResponseSchema,
  AdminEndUserDeviceSchema,
  AdminEndUserBalanceSchema,
  AdminEndUserTxnSchema,
  AdminEndUserBeneficiarySchema,
  AdminEndUserDepositAddressSchema,
  AdminEndUserDetailSchema,
  AdminEndUserTierRequestSchema,
  AdminEndUserStatusRequestSchema,
  AdminEndUserSessionSchema,
  AdminEndUserSessionListResponseSchema,
  AdminEndUserLimitsResponseSchema,
  AdminEndUserTimelineEntrySchema,
  AdminEndUserTimelineResponseSchema,
} from "./user-mgmt.dto";

const ID = "11111111-1111-1111-1111-111111111111";
const DEVICE_ID = "22222222-2222-2222-2222-222222222222";

const listItem = {
  id: ID,
  email: "user@example.com",
  displayName: "Ada Lovelace",
  status: "active" as const,
  kycStatus: "verified" as const,
  kycTier: "tier_2" as const,
  simSwapFlagged: false,
  sanctionsFlagged: false,
  balances: [{ asset: "USDT", amount: "100.50" }],
  lastActiveAt: "2026-06-30T12:00:00.000Z",
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
  pending: null,
};

const depositAddress = {
  network: "TRON",
  address: "TXyz1234",
  status: "active",
};

const txn = {
  id: ID,
  type: "buy",
  status: "settled",
  asset: "USDT",
  amount: "100.00",
  fiatAmount: "150000.00",
  fiatCurrency: "NGN",
  createdAt: "2026-06-30T12:00:00.000Z",
};

const beneficiary = {
  id: ID,
  type: "bank_account" as const,
  label: "GTBank ****1234",
  verificationStatus: "verified",
};

const ledgerEntry = {
  id: ID,
  transactionId: ID,
  currency: "USDT",
  amount: "100.50",
  direction: "credit" as const,
  balanceAfter: "100.50",
  postedAt: "2026-06-30T12:00:00.000Z",
};

const detail = {
  id: ID,
  email: "user@example.com",
  status: "active" as const,
  kycStatus: "verified" as const,
  kycTier: "tier_2" as const,
  simSwapDetectedAt: null,
  phone: "+2348012345678",
  createdAt: "2026-06-30T12:00:00.000Z",
  devices: [device],
  balances: [balance],
  depositAddresses: [depositAddress],
  recentTransactions: [txn],
  recentLedger: [ledgerEntry],
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
  it("coerces a string limit and parses optional filters incl. kycStatus", () => {
    const parsed = AdminEndUserSearchQuerySchema.parse({
      query: "alice",
      status: "active",
      kycStatus: "pending_review",
      kycTier: "tier_1",
      limit: "50",
    });
    expect(parsed.limit).toBe(50);
    expect(parsed.kycStatus).toBe("pending_review");
  });

  it("rejects an unknown kycStatus", () => {
    expect(() =>
      AdminEndUserSearchQuerySchema.parse({ kycStatus: "approved" }),
    ).toThrow();
  });

  it("rejects a limit above the max of 100", () => {
    expect(() =>
      AdminEndUserSearchQuerySchema.parse({ limit: "101" }),
    ).toThrow();
  });
});

describe("AdminEndUserBalanceSummarySchema", () => {
  it("parses an aggregate crypto balance summary", () => {
    const parsed = AdminEndUserBalanceSummarySchema.parse({
      asset: "USDT",
      amount: "42.00",
    });
    expect(parsed.amount).toBe("42.00");
  });

  it("rejects a non-numeric amount", () => {
    expect(() =>
      AdminEndUserBalanceSummarySchema.parse({ asset: "USDT", amount: "abc" }),
    ).toThrow();
  });
});

describe("AdminEndUserListItemSchema", () => {
  it("parses a list item with a null email and a null lastActiveAt", () => {
    const parsed = AdminEndUserListItemSchema.parse({
      ...listItem,
      email: null,
      lastActiveAt: null,
    });
    expect(parsed.email).toBeNull();
    expect(parsed.lastActiveAt).toBeNull();
  });

  it("parses displayName, sanctionsFlagged and the balances array", () => {
    const parsed = AdminEndUserListItemSchema.parse(listItem);
    expect(parsed.displayName).toBe("Ada Lovelace");
    expect(parsed.sanctionsFlagged).toBe(false);
    expect(parsed.balances).toEqual([{ asset: "USDT", amount: "100.50" }]);
  });

  it("rejects a missing displayName field", () => {
    const { displayName: _omitted, ...rest } = listItem;
    expect(() => AdminEndUserListItemSchema.parse(rest)).toThrow();
  });

  it("rejects a non-uuid id", () => {
    expect(() =>
      AdminEndUserListItemSchema.parse({ ...listItem, id: "not-a-uuid" }),
    ).toThrow();
  });
});

describe("AdminEndUserListResponseSchema", () => {
  it("parses a paginated list with a total", () => {
    const parsed = AdminEndUserListResponseSchema.parse({
      items: [listItem],
      nextCursor: "cursor-abc",
      total: 128,
    });
    expect(parsed.items).toHaveLength(1);
    expect(parsed.total).toBe(128);
  });

  it("rejects a missing total field", () => {
    expect(() =>
      AdminEndUserListResponseSchema.parse({
        items: [listItem],
        nextCursor: null,
      }),
    ).toThrow();
  });

  it("rejects a missing nextCursor field", () => {
    expect(() =>
      AdminEndUserListResponseSchema.parse({ items: [listItem], total: 1 }),
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
    expect(() => AdminEndUserTxnSchema.parse({ ...txn, id: "nope" })).toThrow();
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
    expect(() =>
      AdminEndUserTierRequestSchema.parse({ tier: "tier_9" }),
    ).toThrow();
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

// ── Detail enrichment (deposit addresses, txn economics, balance pending) ─────

describe("AdminEndUserDepositAddressSchema", () => {
  it("parses a child deposit address", () => {
    expect(AdminEndUserDepositAddressSchema.parse(depositAddress).network).toBe(
      "TRON",
    );
  });

  it("rejects a missing address", () => {
    expect(() =>
      AdminEndUserDepositAddressSchema.parse({
        network: "TRON",
        status: "active",
      }),
    ).toThrow();
  });
});

describe("AdminEndUserBalanceSchema pending", () => {
  it("parses a balance with a pending amount", () => {
    const parsed = AdminEndUserBalanceSchema.parse({
      ...balance,
      pending: "5.00",
    });
    expect(parsed.pending).toBe("5.00");
  });

  it("rejects a non-numeric pending amount", () => {
    expect(() =>
      AdminEndUserBalanceSchema.parse({ ...balance, pending: "abc" }),
    ).toThrow();
  });
});

describe("AdminEndUserTxnSchema economics", () => {
  it("parses null economics for a legless row", () => {
    const parsed = AdminEndUserTxnSchema.parse({
      ...txn,
      asset: null,
      amount: null,
      fiatAmount: null,
      fiatCurrency: null,
    });
    expect(parsed.amount).toBeNull();
  });
});

// ── Security: active auth sessions ────────────────────────────────────────────

const session = {
  id: ID,
  channel: "web",
  deviceId: DEVICE_ID,
  userAgent: "Mozilla/5.0",
  ipAddress: "102.89.34.19",
  isActive: true,
  stepUpCompletedAt: null,
  issuedAt: "2026-06-30T12:00:00.000Z",
  expiresAt: "2026-07-01T12:00:00.000Z",
  lastActivityAt: "2026-06-30T12:30:00.000Z",
  revokedAt: null,
};

describe("AdminEndUserSessionSchema", () => {
  it("parses a session with null device/step-up", () => {
    const parsed = AdminEndUserSessionSchema.parse({
      ...session,
      deviceId: null,
      userAgent: null,
      ipAddress: null,
    });
    expect(parsed.deviceId).toBeNull();
    expect(parsed.isActive).toBe(true);
  });

  it("rejects a non-uuid id", () => {
    expect(() =>
      AdminEndUserSessionSchema.parse({ ...session, id: "nope" }),
    ).toThrow();
  });
});

describe("AdminEndUserSessionListResponseSchema", () => {
  it("parses a session list", () => {
    const parsed = AdminEndUserSessionListResponseSchema.parse({
      sessions: [session],
    });
    expect(parsed.sessions).toHaveLength(1);
  });

  it("rejects a missing sessions field", () => {
    expect(() => AdminEndUserSessionListResponseSchema.parse({})).toThrow();
  });
});

// ── Limits: effective caps + velocity usage ───────────────────────────────────

const limitsResponse = {
  effectiveLimits: {
    tier: "tier_2" as const,
    fiatCurrency: "NGN",
    perTxFiatMax: "5000000",
    dailyFiatMax: "50000000",
    dailyTxCountMax: 50,
  },
  velocity: {
    dailyFiatUsed: "252551.70",
    dailyTxCount: 6,
    windowStart: "2026-06-29T12:00:00.000Z",
    windowEnd: "2026-06-30T12:00:00.000Z",
  },
};

describe("AdminEndUserLimitsResponseSchema", () => {
  it("parses effective limits + velocity", () => {
    const parsed = AdminEndUserLimitsResponseSchema.parse(limitsResponse);
    expect(parsed.effectiveLimits?.dailyTxCountMax).toBe(50);
    expect(parsed.velocity.dailyTxCount).toBe(6);
  });

  it("parses a null effectiveLimits (unverified user)", () => {
    const parsed = AdminEndUserLimitsResponseSchema.parse({
      ...limitsResponse,
      effectiveLimits: null,
    });
    expect(parsed.effectiveLimits).toBeNull();
  });

  it("rejects a non-numeric dailyTxCount", () => {
    expect(() =>
      AdminEndUserLimitsResponseSchema.parse({
        ...limitsResponse,
        velocity: { ...limitsResponse.velocity, dailyTxCount: "six" },
      }),
    ).toThrow();
  });
});

// ── Timeline: admin-action history ────────────────────────────────────────────

const timelineEntry = {
  id: ID,
  action: "kyc_state_change",
  actor: "admin:99999999-9999-9999-9999-999999999999",
  actorAdminId: "99999999-9999-9999-9999-999999999999",
  createdAt: "2026-06-30T12:00:00.000Z",
};

describe("AdminEndUserTimelineEntrySchema", () => {
  it("parses a timeline entry with a null admin actor (system action)", () => {
    const parsed = AdminEndUserTimelineEntrySchema.parse({
      ...timelineEntry,
      actor: "system",
      actorAdminId: null,
    });
    expect(parsed.actorAdminId).toBeNull();
  });

  it("rejects a missing action", () => {
    expect(() =>
      AdminEndUserTimelineEntrySchema.parse({
        id: ID,
        actor: "system",
        actorAdminId: null,
        createdAt: "2026-06-30T12:00:00.000Z",
      }),
    ).toThrow();
  });
});

describe("AdminEndUserTimelineResponseSchema", () => {
  it("parses a timeline list", () => {
    expect(
      AdminEndUserTimelineResponseSchema.parse({ entries: [timelineEntry] })
        .entries,
    ).toHaveLength(1);
  });
});
