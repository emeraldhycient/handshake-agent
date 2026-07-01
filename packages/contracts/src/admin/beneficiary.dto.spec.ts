import {
  AdminBeneficiarySchema,
  AdminBeneficiaryListResponseSchema,
} from "./beneficiary.dto";

const UUID = "11111111-1111-1111-1111-111111111111";
const USER_UUID = "22222222-2222-2222-2222-222222222222";

describe("AdminBeneficiarySchema", () => {
  it("parses a crypto beneficiary with an active cooling-off lock", () => {
    const parsed = AdminBeneficiarySchema.parse({
      id: UUID,
      userId: USER_UUID,
      type: "crypto_address",
      label: "Cold wallet",
      verificationStatus: "pending",
      firstUseLockedUntil: "2099-01-01T00:00:00.000Z",
      coolingOffActive: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(parsed.type).toBe("crypto_address");
    expect(parsed.coolingOffActive).toBe(true);
  });

  it("parses a bank beneficiary with no cooling-off (null lock)", () => {
    const parsed = AdminBeneficiarySchema.parse({
      id: UUID,
      userId: USER_UUID,
      type: "bank_account",
      label: "GTBank",
      verificationStatus: "verified",
      firstUseLockedUntil: null,
      coolingOffActive: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(parsed.firstUseLockedUntil).toBeNull();
    expect(parsed.coolingOffActive).toBe(false);
  });

  it("rejects an out-of-vocabulary type", () => {
    expect(() =>
      AdminBeneficiarySchema.parse({
        id: UUID,
        userId: USER_UUID,
        type: "paypal",
        label: "x",
        verificationStatus: "pending",
        firstUseLockedUntil: null,
        coolingOffActive: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("wraps beneficiaries in { items }", () => {
    const res = AdminBeneficiaryListResponseSchema.parse({ items: [] });
    expect(res.items).toEqual([]);
  });
});
