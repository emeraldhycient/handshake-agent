import { describe, it, expect } from "vitest";
import {
  ChangePinRequestSchema,
  ClaimPayIdSchema,
  CreatePublicNicknameSchema,
  ProfileResponseSchema,
  ProfileSessionListResponseSchema,
  ProfileSessionSchema,
  PublicNicknameSchema,
  PublicNicknamesResponseSchema,
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
        dailyFiatUsed: 32000,
        dailyTxCountUsed: 3,
      },
      memberSince: "2026-07-01T00:00:00.000Z",
      security: { score: 3, label: "good" },
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
      memberSince: null,
      security: { score: 0, label: "weak" },
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

  it("parses a profile with a payId present (Spec 2 @-handle)", () => {
    const ok = {
      email: "a@b.com",
      fullName: "Amara Okeke",
      phone: "+2348011112222",
      kycStatus: "verified",
      kycTier: "tier_1",
      fiatCurrency: "NGN",
      limits: null,
      payId: "ada",
      memberSince: "2026-07-01T00:00:00.000Z",
      security: { score: 2, label: "fair" },
    };
    expect(ProfileResponseSchema.parse(ok)).toEqual(ok);
  });

  it("parses a profile with an omitted payId (optional — not yet claimed)", () => {
    const ok = {
      email: "a@b.com",
      fullName: null,
      phone: null,
      kycStatus: "not_started",
      kycTier: "unverified",
      fiatCurrency: "NGN",
      limits: null,
      memberSince: null,
      security: { score: 0, label: "weak" },
    };
    expect(ProfileResponseSchema.parse(ok).payId).toBeUndefined();
  });

  it("folds live usage into limits and requires those fields", () => {
    const withUsage = {
      email: "a@b.com",
      fullName: "Ada",
      phone: "+2348011112222",
      kycStatus: "verified",
      kycTier: "tier_2",
      fiatCurrency: "NGN",
      limits: {
        perTxFiatMax: 500000,
        dailyFiatMax: 2000000,
        dailyTxCountMax: 20,
        dailyFiatUsed: 320000,
        dailyTxCountUsed: 3,
      },
      memberSince: "2026-07-01T00:00:00.000Z",
      security: { score: 4, label: "strong" },
    };
    expect(ProfileResponseSchema.parse(withUsage).limits?.dailyFiatUsed).toBe(320000);
    const { dailyFiatUsed: _drop, ...noUsage } = withUsage.limits;
    expect(
      ProfileResponseSchema.safeParse({ ...withUsage, limits: noUsage }).success,
    ).toBe(false);
  });

  it("requires the security field and bounds the score to 0..4", () => {
    const base = {
      email: "a@b.com",
      fullName: null,
      phone: null,
      kycStatus: "not_started",
      kycTier: "unverified",
      fiatCurrency: "NGN",
      limits: null,
      memberSince: null,
    };
    expect(ProfileResponseSchema.safeParse(base).success).toBe(false);
    expect(
      ProfileResponseSchema.safeParse({
        ...base,
        security: { score: 5, label: "strong" },
      }).success,
    ).toBe(false);
    expect(
      ProfileResponseSchema.safeParse({
        ...base,
        security: { score: 3, label: "nope" },
      }).success,
    ).toBe(false);
  });
});

describe("ClaimPayIdSchema", () => {
  it("parses a valid PayId claim", () => {
    expect(ClaimPayIdSchema.parse({ payId: "ada" })).toEqual({ payId: "ada" });
  });

  it("rejects an unknown key (.strict())", () => {
    expect(() =>
      ClaimPayIdSchema.parse({ payId: "ada", extra: 1 }),
    ).toThrow();
  });

  it("rejects a reserved / malformed handle (PayIdSchema policy)", () => {
    expect(() => ClaimPayIdSchema.parse({ payId: "admin" })).toThrow();
    expect(() => ClaimPayIdSchema.parse({ payId: "Bad-Char" })).toThrow();
  });
});

describe("CreatePublicNicknameSchema", () => {
  it("parses a valid nickname alias", () => {
    expect(CreatePublicNicknameSchema.parse({ alias: "ada" })).toEqual({
      alias: "ada",
    });
  });

  it("rejects an unknown key (.strict())", () => {
    expect(() =>
      CreatePublicNicknameSchema.parse({ alias: "ada", extra: 1 }),
    ).toThrow();
  });

  it("rejects a reserved / malformed alias (PayIdSchema policy)", () => {
    expect(() => CreatePublicNicknameSchema.parse({ alias: "support" })).toThrow();
    expect(() => CreatePublicNicknameSchema.parse({ alias: "no" })).toThrow();
  });
});

describe("PublicNicknameSchema / PublicNicknamesResponseSchema", () => {
  const nickname = {
    id: "018f6b3a-0000-7000-8000-000000000001",
    alias: "ada",
  };

  it("parses a public nickname row", () => {
    expect(PublicNicknameSchema.parse(nickname)).toEqual(nickname);
  });

  it("rejects a non-uuid id", () => {
    expect(() =>
      PublicNicknameSchema.parse({ id: "not-a-uuid", alias: "ada" }),
    ).toThrow();
  });

  it("parses the list envelope", () => {
    expect(
      PublicNicknamesResponseSchema.parse({ nicknames: [nickname] }).nicknames,
    ).toHaveLength(1);
    expect(
      PublicNicknamesResponseSchema.parse({ nicknames: [] }).nicknames,
    ).toHaveLength(0);
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
