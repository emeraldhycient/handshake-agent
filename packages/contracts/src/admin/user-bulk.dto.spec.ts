import { describe, expect, it } from "vitest";

import {
  ApplyUserTagsRequestSchema,
  ApplyUserTagsResponseSchema,
  BulkMessageRequestSchema,
  BulkMessageResponseSchema,
  BULK_USER_IDS_MAX,
} from "./user-bulk.dto";

const UUID = "11111111-1111-1111-1111-111111111111";
const UUID2 = "22222222-2222-2222-2222-222222222222";

describe("ApplyUserTagsRequestSchema", () => {
  it("accepts a valid selection + tag + reason", () => {
    const parsed = ApplyUserTagsRequestSchema.parse({
      userIds: [UUID, UUID2],
      tag: "vip",
      reason: "high-value cohort review",
    });
    expect(parsed.userIds).toEqual([UUID, UUID2]);
    expect(parsed.tag).toBe("vip");
  });

  it("de-duplicates repeated ids so counts/keys are stable", () => {
    const parsed = ApplyUserTagsRequestSchema.parse({
      userIds: [UUID, UUID, UUID2],
      tag: "vip",
      reason: "dedup",
    });
    expect(parsed.userIds).toEqual([UUID, UUID2]);
  });

  it("rejects an empty selection", () => {
    expect(() =>
      ApplyUserTagsRequestSchema.parse({ userIds: [], tag: "x", reason: "r" }),
    ).toThrow();
  });

  it("rejects a selection over the max", () => {
    const many = Array.from({ length: BULK_USER_IDS_MAX + 1 }, () => UUID);
    expect(() =>
      ApplyUserTagsRequestSchema.parse({ userIds: many, tag: "x", reason: "r" }),
    ).toThrow();
  });

  it("rejects a non-uuid id", () => {
    expect(() =>
      ApplyUserTagsRequestSchema.parse({
        userIds: ["not-a-uuid"],
        tag: "x",
        reason: "r",
      }),
    ).toThrow();
  });

  it("rejects a tag with disallowed characters", () => {
    expect(() =>
      ApplyUserTagsRequestSchema.parse({
        userIds: [UUID],
        tag: "bad/tag",
        reason: "r",
      }),
    ).toThrow();
  });

  it("requires a non-empty reason", () => {
    expect(() =>
      ApplyUserTagsRequestSchema.parse({
        userIds: [UUID],
        tag: "vip",
        reason: "",
      }),
    ).toThrow();
  });
});

describe("ApplyUserTagsResponseSchema", () => {
  it("parses the applied/requested counts", () => {
    const parsed = ApplyUserTagsResponseSchema.parse({
      tag: "vip",
      requested: 3,
      applied: 2,
    });
    expect(parsed.applied).toBe(2);
  });
});

describe("BulkMessageRequestSchema", () => {
  it("accepts a templated broadcast and defaults variables + confirmLargeSet", () => {
    const parsed = BulkMessageRequestSchema.parse({
      userIds: [UUID],
      eventType: "balance_update",
      templateKey: "ops.balance_notice",
      reason: "quarterly balance nudge",
    });
    expect(parsed.variables).toEqual({});
    expect(parsed.confirmLargeSet).toBe(false);
  });

  it("rejects an event type outside the operator allow-list", () => {
    expect(() =>
      BulkMessageRequestSchema.parse({
        userIds: [UUID],
        eventType: "transaction_completed",
        templateKey: "k",
        reason: "r",
      }),
    ).toThrow();
  });

  it("rejects an empty template key (no free-text authoring)", () => {
    expect(() =>
      BulkMessageRequestSchema.parse({
        userIds: [UUID],
        eventType: "balance_update",
        templateKey: "",
        reason: "r",
      }),
    ).toThrow();
  });
});

describe("BulkMessageResponseSchema", () => {
  it("parses the outbox result", () => {
    const parsed = BulkMessageResponseSchema.parse({
      broadcastRef: "bcast_abc",
      eventType: "balance_update",
      requested: 5,
      queued: 5,
    });
    expect(parsed.queued).toBe(5);
  });
});
