import {
  AuditActionSchema,
  AuditLogEntrySchema,
  AuditLogQuerySchema,
  AuditLogListResponseSchema,
  AuditChainVerifyResponseSchema,
} from "./audit.dto";

const ID = "11111111-1111-1111-1111-111111111111";

const auditEntry = {
  id: ID,
  correlationId: "corr-123",
  actor: "admin@example.com",
  actorAdminId: ID,
  actorUserId: null,
  subject: "user:abc",
  action: "config_change" as const,
  details: { field: "fxSpread", from: "0.01", to: "0.02" },
  before: { fxSpread: "0.01" },
  after: { fxSpread: "0.02" },
  currentHash: "hash-current",
  prevHash: "hash-prev",
  createdAt: "2026-06-30T12:00:00.000Z",
};

describe("AuditActionSchema", () => {
  it("accepts a modelled action", () => {
    expect(AuditActionSchema.parse("audit_chain_check")).toBe(
      "audit_chain_check",
    );
  });

  it("rejects an unknown action", () => {
    expect(() => AuditActionSchema.parse("login")).toThrow();
  });
});

describe("AuditLogEntrySchema", () => {
  it("parses a full audit-log entry", () => {
    const parsed = AuditLogEntrySchema.parse(auditEntry);
    expect(parsed.action).toBe("config_change");
  });

  it("parses an entry with null before/after and null actor ids", () => {
    const parsed = AuditLogEntrySchema.parse({
      ...auditEntry,
      actorAdminId: null,
      actorUserId: ID,
      before: null,
      after: null,
    });
    expect(parsed.before).toBeNull();
  });

  it("rejects an entry with an unknown action", () => {
    expect(() =>
      AuditLogEntrySchema.parse({ ...auditEntry, action: "login" }),
    ).toThrow();
  });
});

describe("AuditLogQuerySchema", () => {
  it("coerces a string limit to a number", () => {
    const parsed = AuditLogQuerySchema.parse({ limit: "50" });
    expect(parsed.limit).toBe(50);
  });

  it("rejects a limit above the max of 200", () => {
    expect(() => AuditLogQuerySchema.parse({ limit: "201" })).toThrow();
  });
});

describe("AuditLogListResponseSchema", () => {
  it("parses a paginated audit-log list", () => {
    const parsed = AuditLogListResponseSchema.parse({
      items: [auditEntry],
      nextCursor: "cursor-abc",
    });
    expect(parsed.items).toHaveLength(1);
  });

  it("rejects a missing nextCursor field", () => {
    expect(() =>
      AuditLogListResponseSchema.parse({ items: [auditEntry] }),
    ).toThrow();
  });
});

describe("AuditChainVerifyResponseSchema", () => {
  it("parses an integrity-check result", () => {
    const parsed = AuditChainVerifyResponseSchema.parse({
      ok: true,
      checked: 42,
      brokenAt: null,
    });
    expect(parsed.ok).toBe(true);
  });

  it("rejects a negative checked count", () => {
    expect(() =>
      AuditChainVerifyResponseSchema.parse({
        ok: false,
        checked: -1,
        brokenAt: ID,
      }),
    ).toThrow();
  });
});
