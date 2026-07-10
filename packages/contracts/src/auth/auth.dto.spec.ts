import { describe, expect, it } from "vitest";
import {
  SignupRequestSchema,
  VerifyEmailRequestSchema,
  LoginRequestSchema,
  LoginVerifyRequestSchema,
  LoginVerifyResponseSchema,
  MeResponseSchema,
  RefreshRequestSchema,
  RefreshResponseSchema,
} from "./index";

describe("auth contracts", () => {
  it("accepts a valid signup body and lowercases nothing (server normalizes)", () => {
    const parsed = SignupRequestSchema.parse({
      email: "a@b.com",
      phone: "+2348012345678",
    });
    expect(parsed.email).toBe("a@b.com");
  });

  it("rejects a non-email signup", () => {
    expect(() =>
      SignupRequestSchema.parse({ email: "nope", phone: "+2348012345678" }),
    ).toThrow();
  });

  it("rejects a signup with a too-short phone", () => {
    expect(() =>
      SignupRequestSchema.parse({ email: "a@b.com", phone: "123" }),
    ).toThrow();
  });

  it("requires a non-empty verify-email token", () => {
    expect(() => VerifyEmailRequestSchema.parse({ token: "" })).toThrow();
    expect(VerifyEmailRequestSchema.parse({ token: "abc" }).token).toBe("abc");
  });

  it("login request requires an email", () => {
    expect(() => LoginRequestSchema.parse({})).toThrow();
    expect(LoginRequestSchema.parse({ email: "a@b.com" }).email).toBe(
      "a@b.com",
    );
  });

  it("login verify requires email, otp, deviceFingerprint", () => {
    expect(() =>
      LoginVerifyRequestSchema.parse({ email: "a@b.com", otp: "123456" }),
    ).toThrow();
    const ok = LoginVerifyRequestSchema.parse({
      email: "a@b.com",
      otp: "123456",
      deviceFingerprint: "fp-123456",
    });
    expect(ok.otp).toBe("123456");
    expect(ok.deviceFingerprint).toBe("fp-123456");
  });

  it("login verify response carries tokens and a user projection", () => {
    const v = LoginVerifyResponseSchema.parse({
      accessToken: "a",
      refreshToken: "r",
      user: {
        userId: "11111111-1111-1111-1111-111111111111",
        email: "a@b.com",
        kycStatus: "not_started",
        kycTier: "unverified",
        hasPin: false,
      },
    });
    expect(v.user.hasPin).toBe(false);
    expect(v.user.firstName).toBeUndefined();
  });

  it("me response shape — rejects missing required fields", () => {
    expect(() =>
      MeResponseSchema.parse({ userId: "x", email: "a@b.com" }),
    ).toThrow();
  });

  it("me response accepts firstName + lastName when present", () => {
    const v = MeResponseSchema.parse({
      userId: "11111111-1111-1111-1111-111111111111",
      email: "a@b.com",
      kycStatus: "not_started",
      kycTier: "unverified",
      hasPin: false,
      firstName: "Amara",
      lastName: "Okeke",
    });
    expect(v.firstName).toBe("Amara");
    expect(v.lastName).toBe("Okeke");
  });

  it("me response accepts null firstName/lastName (no KYC profile yet)", () => {
    const v = MeResponseSchema.parse({
      userId: "11111111-1111-1111-1111-111111111111",
      email: "a@b.com",
      kycStatus: "not_started",
      kycTier: "unverified",
      hasPin: false,
      firstName: null,
      lastName: null,
    });
    expect(v.firstName).toBeNull();
    expect(v.lastName).toBeNull();
  });

  it("me response accepts omitted firstName/lastName (optional)", () => {
    const v = MeResponseSchema.parse({
      userId: "11111111-1111-1111-1111-111111111111",
      email: "a@b.com",
      kycStatus: "not_started",
      kycTier: "unverified",
      hasPin: false,
    });
    expect(v.firstName).toBeUndefined();
    expect(v.lastName).toBeUndefined();
  });

  it("refresh request rejects an empty-string token but allows it omitted (cookie-primary)", () => {
    // An explicit empty string is still invalid...
    expect(() => RefreshRequestSchema.parse({ refreshToken: "" })).toThrow();
    // ...but omitting it entirely is valid: the token rides in the ha_refresh cookie.
    expect(RefreshRequestSchema.parse({}).refreshToken).toBeUndefined();
    expect(RefreshRequestSchema.parse({ refreshToken: "r" }).refreshToken).toBe(
      "r",
    );
  });

  it("refresh response carries the rotated tokens plus the user projection", () => {
    const v = RefreshResponseSchema.parse({
      accessToken: "a",
      refreshToken: "r",
      user: {
        userId: "11111111-1111-1111-1111-111111111111",
        email: "a@b.com",
        kycStatus: "verified",
        kycTier: "tier_1",
        hasPin: true,
      },
    });
    expect(v.accessToken).toBe("a");
    expect(v.user.email).toBe("a@b.com");
    // user is required on the refresh response (single round-trip boot rehydration).
    expect(() =>
      RefreshResponseSchema.parse({ accessToken: "a", refreshToken: "r" }),
    ).toThrow();
  });
});
