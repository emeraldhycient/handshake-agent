import { describe, expect, it } from "vitest";
import {
  SignupRequestSchema,
  VerifyEmailRequestSchema,
  LoginRequestSchema,
  LoginVerifyRequestSchema,
  LoginVerifyResponseSchema,
  MeResponseSchema,
  RefreshRequestSchema,
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
  });

  it("login verify requires email, otp, deviceFingerprint", () => {
    expect(() =>
      LoginVerifyRequestSchema.parse({ email: "a@b.com", otp: "123456" }),
    ).toThrow();
    const ok = LoginVerifyRequestSchema.parse({
      email: "a@b.com",
      otp: "123456",
      deviceFingerprint: "fp-1",
    });
    expect(ok.otp).toBe("123456");
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
  });

  it("me response shape", () => {
    expect(() =>
      MeResponseSchema.parse({ userId: "x", email: "a@b.com" }),
    ).toThrow();
  });

  it("refresh request requires a token", () => {
    expect(() => RefreshRequestSchema.parse({ refreshToken: "" })).toThrow();
  });
});
