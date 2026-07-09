import {
  ChangeRequestKindSchema,
  ChangeRequestStatusSchema,
  CreateChangeRequestSchema,
  RejectChangeRequestSchema,
  ChangeRequestSchema,
  ChangeRequestInboxResponseSchema,
} from "./approvals.dto";

describe("approvals.dto", () => {
  describe("ChangeRequestKindSchema", () => {
    it("accepts every maker-checker kind", () => {
      for (const k of [
        "pricing_change",
        "capability_flip",
        "tier_override",
        "refund",
        "manual_credit",
        "notification_broadcast",
        "payout_release",
        "user_tier_override",
      ]) {
        expect(ChangeRequestKindSchema.parse(k)).toBe(k);
      }
    });

    it("accepts the per-user tier override kind (four-eyes on PATCH tier)", () => {
      expect(ChangeRequestKindSchema.parse("user_tier_override")).toBe(
        "user_tier_override",
      );
    });

    it("rejects an unknown kind", () => {
      expect(ChangeRequestKindSchema.safeParse("delete_user").success).toBe(
        false,
      );
    });
  });

  describe("ChangeRequestStatusSchema", () => {
    it("accepts pending / approved / rejected", () => {
      for (const s of ["pending", "approved", "rejected"]) {
        expect(ChangeRequestStatusSchema.parse(s)).toBe(s);
      }
    });
  });

  describe("CreateChangeRequestSchema", () => {
    const valid = {
      kind: "pricing_change" as const,
      resource: "pricing.assets.USDT.baseRates.NGN",
      payload: { key: "pricing.assets.USDT.baseRates.NGN", value: 1650 },
      reason: "Align USDT/NGN with market",
    };

    it("accepts a well-formed create input", () => {
      expect(CreateChangeRequestSchema.parse(valid)).toEqual(valid);
    });

    it("rejects an empty resource", () => {
      expect(
        CreateChangeRequestSchema.safeParse({ ...valid, resource: "" }).success,
      ).toBe(false);
    });

    it("rejects a too-short reason (maker must justify)", () => {
      expect(
        CreateChangeRequestSchema.safeParse({ ...valid, reason: "no" }).success,
      ).toBe(false);
    });

    it("rejects a non-object payload", () => {
      expect(
        CreateChangeRequestSchema.safeParse({ ...valid, payload: "raw" })
          .success,
      ).toBe(false);
    });
  });

  describe("RejectChangeRequestSchema", () => {
    it("requires a non-trivial reason", () => {
      expect(RejectChangeRequestSchema.safeParse({ reason: "no" }).success).toBe(
        false,
      );
      expect(
        RejectChangeRequestSchema.parse({ reason: "Rate is stale" }).reason,
      ).toBe("Rate is stale");
    });
  });

  describe("ChangeRequestSchema", () => {
    const base = {
      id: "11111111-1111-4111-8111-111111111111",
      kind: "refund" as const,
      resource: "Transaction:22222222-2222-4222-8222-222222222222",
      payload: { transactionId: "22222222-2222-4222-8222-222222222222" },
      status: "pending" as const,
      reason: "Duplicate charge",
      requestedByAdminId: "33333333-3333-4333-8333-333333333333",
      requestedByEmail: "ops@handshake.test",
      decidedByAdminId: null,
      decidedByEmail: null,
      decisionReason: null,
      decidedAt: null,
      createdAt: "2026-07-01T00:00:00.000Z",
    };

    it("accepts a pending request with null decision fields", () => {
      expect(ChangeRequestSchema.parse(base)).toEqual(base);
    });

    it("accepts a decided (approved) request", () => {
      const approved = {
        ...base,
        status: "approved" as const,
        decidedByAdminId: "44444444-4444-4444-8444-444444444444",
        decidedByEmail: "finance@handshake.test",
        decisionReason: "Verified against provider",
        decidedAt: "2026-07-01T01:00:00.000Z",
      };
      expect(ChangeRequestSchema.parse(approved)).toEqual(approved);
    });

    it("rejects a non-uuid id", () => {
      expect(ChangeRequestSchema.safeParse({ ...base, id: "abc" }).success).toBe(
        false,
      );
    });
  });

  describe("ChangeRequestInboxResponseSchema", () => {
    it("parses the two lanes + counts", () => {
      const res = ChangeRequestInboxResponseSchema.parse({
        awaitingMe: [],
        myRequests: [],
        counts: { awaitingMe: 2, myRequests: 5, myPending: 1 },
      });
      expect(res.counts.awaitingMe).toBe(2);
    });

    it("rejects a negative count", () => {
      expect(
        ChangeRequestInboxResponseSchema.safeParse({
          awaitingMe: [],
          myRequests: [],
          counts: { awaitingMe: -1, myRequests: 0, myPending: 0 },
        }).success,
      ).toBe(false);
    });
  });
});
