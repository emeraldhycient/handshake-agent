import {
  KycTierLevelSchema,
  SetNameRequestSchema,
  SumsubReviewResultSchema,
  SumsubTokenRequestSchema,
  SumsubTokenResponseSchema,
  SumsubWebhookPayloadSchema,
} from "./kyc-onboarding.dto";

describe("KycTierLevelSchema", () => {
  it("accepts tier_2", () => {
    expect(KycTierLevelSchema.parse("tier_2")).toBe("tier_2");
  });

  it("accepts tier_3", () => {
    expect(KycTierLevelSchema.parse("tier_3")).toBe("tier_3");
  });

  it("rejects tier_1 (not upgradeable via this path)", () => {
    expect(KycTierLevelSchema.safeParse("tier_1").success).toBe(false);
  });

  it("rejects an arbitrary string", () => {
    expect(KycTierLevelSchema.safeParse("gold").success).toBe(false);
  });
});

describe("SetNameRequestSchema", () => {
  it("parses a valid first/last name pair", () => {
    const parsed = SetNameRequestSchema.parse({
      firstName: "Chidi",
      lastName: "Okeke",
    });
    expect(parsed.firstName).toBe("Chidi");
    expect(parsed.lastName).toBe("Okeke");
  });

  it("trims surrounding whitespace", () => {
    const parsed = SetNameRequestSchema.parse({
      firstName: "  Chidi  ",
      lastName: "  Okeke  ",
    });
    expect(parsed.firstName).toBe("Chidi");
    expect(parsed.lastName).toBe("Okeke");
  });

  it("rejects an empty firstName", () => {
    expect(
      SetNameRequestSchema.safeParse({ firstName: "", lastName: "Okeke" })
        .success,
    ).toBe(false);
  });

  it("rejects a firstName that is only whitespace", () => {
    expect(
      SetNameRequestSchema.safeParse({ firstName: "   ", lastName: "Okeke" })
        .success,
    ).toBe(false);
  });

  it("rejects an empty lastName", () => {
    expect(
      SetNameRequestSchema.safeParse({ firstName: "Chidi", lastName: "" })
        .success,
    ).toBe(false);
  });

  it("rejects a name longer than 80 characters", () => {
    const tooLong = "a".repeat(81);
    expect(
      SetNameRequestSchema.safeParse({ firstName: tooLong, lastName: "Okeke" })
        .success,
    ).toBe(false);
  });

  it("rejects a missing lastName", () => {
    expect(SetNameRequestSchema.safeParse({ firstName: "Chidi" }).success).toBe(
      false,
    );
  });
});

describe("SumsubTokenRequestSchema", () => {
  it("parses a valid tier_2 request", () => {
    expect(SumsubTokenRequestSchema.parse({ level: "tier_2" }).level).toBe(
      "tier_2",
    );
  });

  it("parses a valid tier_3 request", () => {
    expect(SumsubTokenRequestSchema.parse({ level: "tier_3" }).level).toBe(
      "tier_3",
    );
  });

  it("rejects an unsupported level", () => {
    expect(
      SumsubTokenRequestSchema.safeParse({ level: "tier_1" }).success,
    ).toBe(false);
  });

  it("rejects a missing level", () => {
    expect(SumsubTokenRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("SumsubTokenResponseSchema", () => {
  it("parses a valid token response", () => {
    const parsed = SumsubTokenResponseSchema.parse({
      token: "sbx:abc123",
      userId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    });
    expect(parsed.token).toBe("sbx:abc123");
    expect(parsed.userId).toBe("3fa85f64-5717-4562-b3fc-2c963f66afa6");
  });

  it("rejects a non-uuid userId", () => {
    expect(
      SumsubTokenResponseSchema.safeParse({
        token: "sbx:abc123",
        userId: "not-a-uuid",
      }).success,
    ).toBe(false);
  });

  it("rejects an empty token", () => {
    expect(
      SumsubTokenResponseSchema.safeParse({
        token: "",
        userId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      }).success,
    ).toBe(false);
  });
});

describe("SumsubReviewResultSchema", () => {
  it("parses a GREEN result with no reject fields", () => {
    const parsed = SumsubReviewResultSchema.parse({ reviewAnswer: "GREEN" });
    expect(parsed.reviewAnswer).toBe("GREEN");
    expect(parsed.reviewRejectType).toBeUndefined();
  });

  it("parses a RED result with reject type + labels", () => {
    const parsed = SumsubReviewResultSchema.parse({
      reviewAnswer: "RED",
      reviewRejectType: "FINAL",
      rejectLabels: ["FRAUDULENT_DOCUMENT"],
    });
    expect(parsed.reviewRejectType).toBe("FINAL");
    expect(parsed.rejectLabels).toEqual(["FRAUDULENT_DOCUMENT"]);
  });

  it("rejects an invalid reviewAnswer", () => {
    expect(
      SumsubReviewResultSchema.safeParse({ reviewAnswer: "YELLOW" }).success,
    ).toBe(false);
  });

  it("rejects an invalid reviewRejectType", () => {
    expect(
      SumsubReviewResultSchema.safeParse({
        reviewAnswer: "RED",
        reviewRejectType: "PERMANENT",
      }).success,
    ).toBe(false);
  });
});

describe("SumsubWebhookPayloadSchema", () => {
  it("parses a minimal payload with only type + externalUserId", () => {
    const parsed = SumsubWebhookPayloadSchema.parse({
      type: "applicantReviewed",
      externalUserId: "user-123",
    });
    expect(parsed.type).toBe("applicantReviewed");
    expect(parsed.externalUserId).toBe("user-123");
    expect(parsed.applicantId).toBeUndefined();
    expect(parsed.levelName).toBeUndefined();
    expect(parsed.reviewResult).toBeUndefined();
  });

  it("parses a full applicantReviewed payload", () => {
    const parsed = SumsubWebhookPayloadSchema.parse({
      type: "applicantReviewed",
      applicantId: "applicant-1",
      externalUserId: "user-123",
      levelName: "tier-2-liveness",
      reviewResult: { reviewAnswer: "GREEN" },
    });
    expect(parsed.applicantId).toBe("applicant-1");
    expect(parsed.levelName).toBe("tier-2-liveness");
    expect(parsed.reviewResult?.reviewAnswer).toBe("GREEN");
  });

  it("rejects a payload missing type", () => {
    expect(
      SumsubWebhookPayloadSchema.safeParse({ externalUserId: "user-123" })
        .success,
    ).toBe(false);
  });

  it("rejects a payload missing externalUserId", () => {
    expect(
      SumsubWebhookPayloadSchema.safeParse({ type: "applicantReviewed" })
        .success,
    ).toBe(false);
  });

  it("rejects a payload with an empty externalUserId", () => {
    expect(
      SumsubWebhookPayloadSchema.safeParse({
        type: "applicantReviewed",
        externalUserId: "",
      }).success,
    ).toBe(false);
  });

  it("ignores unrelated third-party fields it does not model", () => {
    const parsed = SumsubWebhookPayloadSchema.parse({
      type: "applicantPending",
      externalUserId: "user-123",
      someUnmodeledField: { nested: true },
    });
    expect(parsed.type).toBe("applicantPending");
  });
});
