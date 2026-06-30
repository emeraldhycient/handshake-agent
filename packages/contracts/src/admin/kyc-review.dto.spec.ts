import {
  KycQueueItemSchema,
  KycQueueResponseSchema,
  KycSubmissionDetailSchema,
  KycApproveRequestSchema,
  KycRejectRequestSchema,
} from "./kyc-review.dto";

const ID = "11111111-1111-1111-1111-111111111111";

const queueItem = {
  userId: ID,
  email: "user@example.com",
  status: "pending_review" as const,
  submittedAt: "2026-06-30T12:00:00.000Z",
};

const submission = {
  userId: ID,
  firstName: "Ada",
  lastName: "Lovelace",
  dateOfBirth: "1990-12-10",
  ninLast4: "1234",
  bvnLast4: "5678",
  idDocumentType: "passport",
  livenessResult: "passed",
  status: "pending_review" as const,
  tier: "tier_1" as const,
  rejectionReason: null,
};

describe("KycQueueItemSchema", () => {
  it("parses a queue item with a null email and submittedAt", () => {
    const parsed = KycQueueItemSchema.parse({
      ...queueItem,
      email: null,
      submittedAt: null,
    });
    expect(parsed.submittedAt).toBeNull();
  });

  it("rejects a non-uuid userId", () => {
    expect(() =>
      KycQueueItemSchema.parse({ ...queueItem, userId: "nope" }),
    ).toThrow();
  });
});

describe("KycQueueResponseSchema", () => {
  it("parses a paginated queue", () => {
    const parsed = KycQueueResponseSchema.parse({
      items: [queueItem],
      nextCursor: null,
    });
    expect(parsed.items).toHaveLength(1);
  });

  it("rejects a missing nextCursor field", () => {
    expect(() =>
      KycQueueResponseSchema.parse({ items: [queueItem] }),
    ).toThrow();
  });
});

describe("KycSubmissionDetailSchema", () => {
  it("parses a submission with last-4 NIN/BVN and nullable fields", () => {
    const parsed = KycSubmissionDetailSchema.parse(submission);
    expect(parsed.ninLast4).toBe("1234");
    expect(parsed.rejectionReason).toBeNull();
  });

  it("rejects an unknown kyc status", () => {
    expect(() =>
      KycSubmissionDetailSchema.parse({ ...submission, status: "approved" }),
    ).toThrow();
  });
});

describe("KycApproveRequestSchema", () => {
  it("parses an approve request with a verified tier", () => {
    expect(KycApproveRequestSchema.parse({ tier: "tier_2" }).tier).toBe(
      "tier_2",
    );
  });

  it("rejects 'unverified' (not an approvable tier)", () => {
    expect(() =>
      KycApproveRequestSchema.parse({ tier: "unverified" }),
    ).toThrow();
  });
});

describe("KycRejectRequestSchema", () => {
  it("parses a reject request with a reason", () => {
    expect(
      KycRejectRequestSchema.parse({ reason: "Blurry document" }).reason,
    ).toBe("Blurry document");
  });

  it("rejects an empty reason", () => {
    expect(() => KycRejectRequestSchema.parse({ reason: "" })).toThrow();
  });
});
