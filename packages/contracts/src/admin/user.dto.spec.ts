import {
  AdminUserSchema,
  AdminUserListResponseSchema,
  AdminUserUpdateRoleRequestSchema,
  AdminUserStatusRequestSchema,
  AdminBootstrapRequestSchema,
  AdminBootstrapResponseSchema,
  AdminMfaResetRequestSchema,
} from "./user.dto";

const ID = "11111111-1111-1111-1111-111111111111";
const ROLE_ID = "22222222-2222-2222-2222-222222222222";

const adminUser = {
  id: ID,
  email: "admin@example.com",
  displayName: "Ops Admin",
  status: "active" as const,
  mfaEnabled: true,
  role: { id: ROLE_ID, name: "ops" },
  createdAt: "2026-06-30T12:00:00.000Z",
  lastLoginAt: null,
};

describe("AdminUserSchema", () => {
  it("parses an admin user with a null lastLoginAt", () => {
    const parsed = AdminUserSchema.parse(adminUser);
    expect(parsed.lastLoginAt).toBeNull();
  });

  it("carries a non-optional displayName", () => {
    const parsed = AdminUserSchema.parse(adminUser);
    expect(parsed.displayName).toBe("Ops Admin");
  });

  it("rejects a missing displayName", () => {
    const { displayName: _omit, ...withoutName } = adminUser;
    expect(() => AdminUserSchema.parse(withoutName)).toThrow();
  });

  it("rejects an unknown status", () => {
    expect(() =>
      AdminUserSchema.parse({ ...adminUser, status: "deleted" }),
    ).toThrow();
  });
});

describe("AdminMfaResetRequestSchema", () => {
  it("parses a valid reset-2FA reason", () => {
    const parsed = AdminMfaResetRequestSchema.parse({
      reason: "Lost authenticator device; resetting after identity check.",
    });
    expect(parsed.reason).toContain("authenticator");
  });

  it("rejects a reason shorter than 3 characters", () => {
    expect(() => AdminMfaResetRequestSchema.parse({ reason: "no" })).toThrow();
  });

  it("rejects a reason longer than 500 characters", () => {
    expect(() =>
      AdminMfaResetRequestSchema.parse({ reason: "x".repeat(501) }),
    ).toThrow();
  });
});

describe("AdminUserListResponseSchema", () => {
  it("parses a cursor-paginated list", () => {
    const parsed = AdminUserListResponseSchema.parse({
      items: [adminUser],
      nextCursor: null,
    });
    expect(parsed.items).toHaveLength(1);
  });

  it("rejects a missing nextCursor field", () => {
    expect(() =>
      AdminUserListResponseSchema.parse({ items: [adminUser] }),
    ).toThrow();
  });
});

describe("AdminUserUpdateRoleRequestSchema", () => {
  it("parses a role-change request", () => {
    const parsed = AdminUserUpdateRoleRequestSchema.parse({ roleId: ROLE_ID });
    expect(parsed.roleId).toBe(ROLE_ID);
  });

  it("rejects a non-uuid roleId", () => {
    expect(() =>
      AdminUserUpdateRoleRequestSchema.parse({ roleId: "nope" }),
    ).toThrow();
  });
});

describe("AdminUserStatusRequestSchema", () => {
  it("parses a status change to suspended", () => {
    const parsed = AdminUserStatusRequestSchema.parse({ status: "suspended" });
    expect(parsed.status).toBe("suspended");
  });

  it("rejects 'pending' (not a settable status)", () => {
    expect(() =>
      AdminUserStatusRequestSchema.parse({ status: "pending" }),
    ).toThrow();
  });
});

describe("AdminBootstrapRequestSchema", () => {
  it("parses a bootstrap request", () => {
    const parsed = AdminBootstrapRequestSchema.parse({
      token: "bootstrap-token",
      email: "founder@example.com",
    });
    expect(parsed.email).toBe("founder@example.com");
  });

  it("rejects an empty token", () => {
    expect(() =>
      AdminBootstrapRequestSchema.parse({
        token: "",
        email: "founder@example.com",
      }),
    ).toThrow();
  });
});

describe("AdminBootstrapResponseSchema", () => {
  it("parses a bootstrap response", () => {
    const parsed = AdminBootstrapResponseSchema.parse({
      invitationId: ID,
      invitationToken: "tok_abc123",
      expiresAt: "2026-07-07T12:00:00.000Z",
    });
    expect(parsed.invitationId).toBe(ID);
  });

  it("rejects a non-uuid invitationId", () => {
    expect(() =>
      AdminBootstrapResponseSchema.parse({
        invitationId: "nope",
        invitationToken: "tok_abc123",
        expiresAt: "2026-07-07T12:00:00.000Z",
      }),
    ).toThrow();
  });
});
