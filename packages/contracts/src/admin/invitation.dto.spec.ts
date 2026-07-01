import {
  AdminInvitationCreateRequestSchema,
  AdminInvitationCreateResponseSchema,
  AdminInvitationAcceptRequestSchema,
  AdminInvitationAcceptResponseSchema,
} from "./invitation.dto";

const ID = "11111111-1111-1111-1111-111111111111";
const ROLE_ID = "22222222-2222-2222-2222-222222222222";

describe("AdminInvitationCreateRequestSchema", () => {
  it("parses a valid invitation request", () => {
    const parsed = AdminInvitationCreateRequestSchema.parse({
      email: "new@example.com",
      roleId: ROLE_ID,
      reason: "Onboarding ops hire",
    });
    expect(parsed.roleId).toBe(ROLE_ID);
  });

  it("rejects a non-uuid roleId", () => {
    expect(() =>
      AdminInvitationCreateRequestSchema.parse({
        email: "new@example.com",
        roleId: "not-a-uuid",
      }),
    ).toThrow();
  });
});

describe("AdminInvitationCreateResponseSchema", () => {
  it("parses an invitation create response with a one-time token", () => {
    const parsed = AdminInvitationCreateResponseSchema.parse({
      id: ID,
      email: "new@example.com",
      expiresAt: "2026-07-07T12:00:00.000Z",
      invitationToken: "tok_abc123",
    });
    expect(parsed.invitationToken).toBe("tok_abc123");
  });

  it("rejects a response missing the invitationToken", () => {
    expect(() =>
      AdminInvitationCreateResponseSchema.parse({
        id: ID,
        email: "new@example.com",
        expiresAt: "2026-07-07T12:00:00.000Z",
      }),
    ).toThrow();
  });
});

describe("AdminInvitationAcceptRequestSchema", () => {
  it("parses a valid accept request", () => {
    const parsed = AdminInvitationAcceptRequestSchema.parse({
      token: "tok_abc123",
      password: "a-strong-password",
    });
    expect(parsed.token).toBe("tok_abc123");
  });

  it("rejects a password shorter than 12 characters", () => {
    expect(() =>
      AdminInvitationAcceptRequestSchema.parse({
        token: "tok_abc123",
        password: "short",
      }),
    ).toThrow();
  });
});

describe("AdminInvitationAcceptResponseSchema", () => {
  it("parses an accept response", () => {
    const parsed = AdminInvitationAcceptResponseSchema.parse({ adminId: ID });
    expect(parsed.adminId).toBe(ID);
  });

  it("rejects a non-uuid adminId", () => {
    expect(() =>
      AdminInvitationAcceptResponseSchema.parse({ adminId: "nope" }),
    ).toThrow();
  });
});
