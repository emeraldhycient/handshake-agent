import {
  AdminLoginRequestSchema,
  AdminMeSchema,
  AdminLoginResponseSchema,
  AdminStepUpRequestSchema,
  AdminMfaEnrollResponseSchema,
  AdminMfaConfirmRequestSchema,
  AdminMfaVerifyRequestSchema,
} from "./auth.dto";

const ID = "11111111-1111-1111-1111-111111111111";
const ROLE_ID = "22222222-2222-2222-2222-222222222222";

const adminMe = {
  id: ID,
  email: "admin@example.com",
  role: { id: ROLE_ID, name: "super_admin" },
  status: "active" as const,
  mfaEnabled: true,
  permissions: ["api_route:GET /admin/admins:read"],
  menus: ["menu.access"],
  pages: ["/admin/admins"],
};

describe("AdminLoginRequestSchema", () => {
  it("parses a valid login request", () => {
    const parsed = AdminLoginRequestSchema.parse({
      email: "admin@example.com",
      password: "hunter2",
      totp: "123456",
    });
    expect(parsed.email).toBe("admin@example.com");
  });

  it("rejects a request with an empty password", () => {
    expect(() =>
      AdminLoginRequestSchema.parse({ email: "admin@example.com", password: "" }),
    ).toThrow();
  });
});

describe("AdminMeSchema", () => {
  it("parses an admin identity payload", () => {
    const parsed = AdminMeSchema.parse(adminMe);
    expect(parsed.role.name).toBe("super_admin");
  });

  it("rejects an unknown status", () => {
    expect(() =>
      AdminMeSchema.parse({ ...adminMe, status: "deleted" }),
    ).toThrow();
  });
});

describe("AdminLoginResponseSchema", () => {
  it("parses a login response", () => {
    const parsed = AdminLoginResponseSchema.parse({
      accessToken: "jwt.token.value",
      expiresAt: "2026-06-30T12:00:00.000Z",
      admin: adminMe,
    });
    expect(parsed.admin.email).toBe("admin@example.com");
  });

  it("rejects a response missing the admin field", () => {
    expect(() =>
      AdminLoginResponseSchema.parse({
        accessToken: "jwt.token.value",
        expiresAt: "2026-06-30T12:00:00.000Z",
      }),
    ).toThrow();
  });
});

describe("AdminStepUpRequestSchema", () => {
  it("parses an all-optional step-up payload", () => {
    const parsed = AdminStepUpRequestSchema.parse({ totp: "123456" });
    expect(parsed.totp).toBe("123456");
  });

  it("rejects a non-string totp", () => {
    expect(() => AdminStepUpRequestSchema.parse({ totp: 123456 })).toThrow();
  });
});

describe("AdminMfaEnrollResponseSchema", () => {
  it("parses an enrollment payload", () => {
    const parsed = AdminMfaEnrollResponseSchema.parse({
      otpauthUri: "otpauth://totp/Handshake:admin",
      qrSvg: "<svg></svg>",
      recoveryCodes: ["aaaa-bbbb", "cccc-dddd"],
    });
    expect(parsed.recoveryCodes).toHaveLength(2);
  });

  it("rejects a payload missing recoveryCodes", () => {
    expect(() =>
      AdminMfaEnrollResponseSchema.parse({
        otpauthUri: "otpauth://totp/Handshake:admin",
        qrSvg: "<svg></svg>",
      }),
    ).toThrow();
  });
});

describe("AdminMfaConfirmRequestSchema / AdminMfaVerifyRequestSchema", () => {
  it("parses a 6-digit totp confirm/verify", () => {
    expect(AdminMfaConfirmRequestSchema.parse({ totp: "123456" }).totp).toBe(
      "123456",
    );
    expect(AdminMfaVerifyRequestSchema.parse({ totp: "123456" }).totp).toBe(
      "123456",
    );
  });

  it("rejects a totp shorter than 6 characters", () => {
    expect(() => AdminMfaConfirmRequestSchema.parse({ totp: "123" })).toThrow();
    expect(() => AdminMfaVerifyRequestSchema.parse({ totp: "123" })).toThrow();
  });
});
