import {
  AdminEndUsersExportQuerySchema,
  AdminLedgerExportQuerySchema,
  AuditLogExportQuerySchema,
} from "./export.dto";

const ID = "11111111-1111-1111-1111-111111111111";

describe("AdminEndUsersExportQuerySchema", () => {
  it("parses the end-user list filters plus includedIds and reason", () => {
    const parsed = AdminEndUsersExportQuerySchema.parse({
      query: "ada",
      status: "active",
      kycStatus: "verified",
      kycTier: "tier_2",
      includedIds: [ID],
      reason: "Quarterly compliance export",
    });
    expect(parsed.status).toBe("active");
    expect(parsed.includedIds).toEqual([ID]);
    expect(parsed.reason).toContain("compliance");
  });

  it("accepts an empty query (export ALL rows matching no filters)", () => {
    expect(AdminEndUsersExportQuerySchema.parse({})).toEqual({});
  });

  it("rejects a cursor field (paging is stripped from exports)", () => {
    const parsed = AdminEndUsersExportQuerySchema.parse({
      cursor: "should-be-ignored",
    });
    // .omit strips cursor/limit — strict parse would keep unknowns out; here we
    // assert the field is not carried through onto the parsed shape.
    expect("cursor" in parsed).toBe(false);
  });

  it("rejects a non-uuid includedIds entry", () => {
    expect(() =>
      AdminEndUsersExportQuerySchema.parse({ includedIds: ["not-a-uuid"] }),
    ).toThrow();
  });

  it("rejects a reason longer than 500 characters", () => {
    expect(() =>
      AdminEndUsersExportQuerySchema.parse({ reason: "x".repeat(501) }),
    ).toThrow();
  });
});

describe("AdminLedgerExportQuerySchema", () => {
  it("parses the ledger list filters plus an optional reason", () => {
    const parsed = AdminLedgerExportQuerySchema.parse({
      accountType: "user_wallet",
      currency: "USDT",
      reason: "Audit support",
    });
    expect(parsed.accountType).toBe("user_wallet");
    expect(parsed.currency).toBe("USDT");
    expect(parsed.reason).toBe("Audit support");
  });

  it("accepts no filters (export the whole ledger)", () => {
    expect(AdminLedgerExportQuerySchema.parse({})).toEqual({});
  });

  it("rejects a reason longer than 500 characters", () => {
    expect(() =>
      AdminLedgerExportQuerySchema.parse({ reason: "x".repeat(501) }),
    ).toThrow();
  });
});

describe("AuditLogExportQuerySchema", () => {
  it("parses the audit-log filters plus an optional reason", () => {
    const parsed = AuditLogExportQuerySchema.parse({
      actorAdminId: ID,
      action: "config_change",
      from: "2026-06-01",
      to: "2026-06-30",
      reason: "Regulator request",
    });
    expect(parsed.actorAdminId).toBe(ID);
    expect(parsed.action).toBe("config_change");
    expect(parsed.reason).toBe("Regulator request");
  });

  it("rejects an unknown audit action", () => {
    expect(() =>
      AuditLogExportQuerySchema.parse({ action: "not_a_real_action" }),
    ).toThrow();
  });

  it("rejects a reason longer than 500 characters", () => {
    expect(() =>
      AuditLogExportQuerySchema.parse({ reason: "x".repeat(501) }),
    ).toThrow();
  });
});
