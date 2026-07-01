import {
  KycQueueItemSchema,
  KycQueueQuerySchema,
  KycQueueResponseSchema,
  KycSubmissionDetailSchema,
  KycApproveRequestSchema,
  KycRejectRequestSchema,
} from "./kyc-review.dto";

const ID = "11111111-1111-1111-1111-111111111111";

const queueItem = {
  userId: ID,
  email: "user@example.com",
  displayName: "Ada Lovelace",
  requestedTier: "tier_1" as const,
  status: "pending_review" as const,
  submittedAt: "2026-06-30T12:00:00.000Z",
  slaAgeSeconds: 3600,
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
  it("parses an enriched queue item (displayName, requestedTier, slaAgeSeconds)", () => {
    const parsed = KycQueueItemSchema.parse(queueItem);
    expect(parsed.displayName).toBe("Ada Lovelace");
    expect(parsed.requestedTier).toBe("tier_1");
    expect(parsed.slaAgeSeconds).toBe(3600);
  });

  it("parses a queue item with a null email, submittedAt, displayName and requestedTier", () => {
    const parsed = KycQueueItemSchema.parse({
      ...queueItem,
      email: null,
      submittedAt: null,
      displayName: null,
      requestedTier: null,
    });
    expect(parsed.submittedAt).toBeNull();
    expect(parsed.displayName).toBeNull();
    expect(parsed.requestedTier).toBeNull();
  });

  it("rejects a non-uuid userId", () => {
    expect(() =>
      KycQueueItemSchema.parse({ ...queueItem, userId: "nope" }),
    ).toThrow();
  });

  it("rejects a non-integer slaAgeSeconds", () => {
    expect(() =>
      KycQueueItemSchema.parse({ ...queueItem, slaAgeSeconds: 1.5 }),
    ).toThrow();
  });

  it("rejects an unknown requestedTier", () => {
    expect(() =>
      KycQueueItemSchema.parse({ ...queueItem, requestedTier: "platinum" }),
    ).toThrow();
  });
});

describe("KycQueueQuerySchema", () => {
  it("parses an empty query (all fields optional)", () => {
    expect(KycQueueQuerySchema.parse({})).toEqual({});
  });

  it("parses a status filter and coerces a string limit", () => {
    const parsed = KycQueueQuerySchema.parse({
      status: "verified",
      limit: "25",
    });
    expect(parsed.status).toBe("verified");
    expect(parsed.limit).toBe(25);
  });

  it("rejects an unknown status", () => {
    expect(() => KycQueueQuerySchema.parse({ status: "escalated" })).toThrow();
  });

  it("rejects a limit over the cap", () => {
    expect(() => KycQueueQuerySchema.parse({ limit: 500 })).toThrow();
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
