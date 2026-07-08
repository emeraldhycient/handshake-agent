import { describe, it, expect } from "vitest";
import {
  ChangePinRequestSchema,
  ProfileResponseSchema,
  ProfileSessionListResponseSchema,
  ProfileSessionSchema,
  UpdateProfileRequestSchema,
} from "./profile.dto";

describe("ProfileResponseSchema", () => {
  it("parses a full verified profile", () => {
    const ok = {
      email: "a@b.com",
      fullName: "Amara Okeke",
      phone: "+2348011112222",
      kycStatus: "verified",
      kycTier: "tier_1",
      fiatCurrency: "NGN",
      limits: {
        perTxFiatMax: 50000,
        dailyFiatMax: 200000,
        dailyTxCountMax: 10,
      },
    };
    expect(ProfileResponseSchema.parse(ok)).toEqual(ok);
  });

  it("parses an unverified profile with nulls", () => {
    const ok = {
      email: "a@b.com",
      fullName: null,
      phone: null,
      kycStatus: "not_started",
      kycTier: "unverified",
      fiatCurrency: "NGN",
      limits: null,
    };
    expect(ProfileResponseSchema.parse(ok)).toEqual(ok);
  });

  it("rejects a missing email", () => {
    expect(() =>
      ProfileResponseSchema.parse({
        fullName: null,
        phone: null,
        kycStatus: "verified",
        kycTier: "tier_1",
        fiatCurrency: "NGN",
        limits: null,
      }),
    ).toThrow();
  });
});

describe("ChangePinRequestSchema", () => {
  it("parses a valid change request", () => {
    const ok = { currentPin: "8047", newPin: "9152" };
    expect(ChangePinRequestSchema.parse(ok)).toEqual(ok);
  });

  it("applies the TransactionPinSchema policy to the NEW pin only", () => {
    // A weak new PIN (all same digit / sequence) is rejected…
    expect(() =>
      ChangePinRequestSchema.parse({ currentPin: "8047", newPin: "1111" }),
    ).toThrow();
    expect(() =>
      ChangePinRequestSchema.parse({ currentPin: "8047", newPin: "123456" }),
    ).toThrow();
    // …but the CURRENT pin is opaque (only non-empty) — the server compares it.
    expect(
      ChangePinRequestSchema.parse({ currentPin: "1111", newPin: "9152" }),
    ).toEqual({ currentPin: "1111", newPin: "9152" });
  });

  it("rejects an empty currentPin", () => {
    expect(() =>
      ChangePinRequestSchema.parse({ currentPin: "", newPin: "9152" }),
    ).toThrow();
  });
});

describe("UpdateProfileRequestSchema", () => {
  it("parses phone-only, fiat-only and combined updates", () => {
    expect(
      UpdateProfileRequestSchema.parse({ phone: "+2348011112222" }),
    ).toEqual({ phone: "+2348011112222" });
    expect(UpdateProfileRequestSchema.parse({ fiatCurrency: "NGN" })).toEqual({
      fiatCurrency: "NGN",
    });
    expect(
      UpdateProfileRequestSchema.parse({
        phone: "08011112222",
        fiatCurrency: "GHS",
      }),
    ).toEqual({ phone: "08011112222", fiatCurrency: "GHS" });
  });

  it("rejects an empty update, a malformed phone and a lowercase currency", () => {
    expect(() => UpdateProfileRequestSchema.parse({})).toThrow();
    expect(() =>
      UpdateProfileRequestSchema.parse({ phone: "not-a-phone" }),
    ).toThrow();
    expect(() =>
      UpdateProfileRequestSchema.parse({ fiatCurrency: "ngn" }),
    ).toThrow();
  });

  it("never accepts KYC-owned identity fields", () => {
    expect(() =>
      UpdateProfileRequestSchema.parse({
        phone: "+2348011112222",
        fullName: "New Name",
      }),
    ).toThrow();
    expect(() =>
      UpdateProfileRequestSchema.parse({
        fiatCurrency: "NGN",
        nin: "12345678901",
      }),
    ).toThrow();
  });
});

describe("ProfileSessionSchema / ProfileSessionListResponseSchema", () => {
  const session = {
    id: "018f6b3a-0000-7000-8000-000000000001",
    channel: "web",
    userAgent: "Mozilla/5.0",
    createdAt: "2026-07-08T10:00:00.000Z",
    lastUsedAt: null,
    expiresAt: "2026-07-09T10:00:00.000Z",
    isCurrent: true,
  };

  it("parses a session row with nullable telemetry", () => {
    expect(ProfileSessionSchema.parse(session)).toEqual(session);
    expect(
      ProfileSessionSchema.parse({
        ...session,
        userAgent: null,
        isCurrent: false,
      }),
    ).toMatchObject({ userAgent: null, isCurrent: false });
  });

  it("parses the list envelope and rejects a missing isCurrent flag", () => {
    expect(
      ProfileSessionListResponseSchema.parse({ sessions: [session] }).sessions,
    ).toHaveLength(1);
    const { isCurrent: _isCurrent, ...withoutFlag } = session;
    expect(() => ProfileSessionSchema.parse(withoutFlag)).toThrow();
  });
});
