import { describe, expect, it } from "vitest";

import {
  BroadcastAudienceSchema,
  BroadcastScheduleSchema,
  BroadcastSendRequestSchema,
  BroadcastSendResponseSchema,
} from "./broadcast.dto";

describe("BroadcastAudienceSchema", () => {
  it("accepts the modeled cohorts", () => {
    for (const c of ["all", "verified", "tier_1", "lagos"]) {
      expect(BroadcastAudienceSchema.parse(c)).toBe(c);
    }
  });

  it("rejects an unknown cohort", () => {
    expect(() => BroadcastAudienceSchema.parse("everyone")).toThrow();
  });
});

describe("BroadcastScheduleSchema", () => {
  it("accepts an immediate send with no sendAt", () => {
    expect(BroadcastScheduleSchema.parse({ kind: "now" })).toEqual({
      kind: "now",
    });
  });

  it("accepts a scheduled send with an ISO sendAt", () => {
    const at = "2026-07-02T09:00:00.000Z";
    expect(
      BroadcastScheduleSchema.parse({ kind: "scheduled", sendAt: at })
    ).toEqual({ kind: "scheduled", sendAt: at });
  });

  it("rejects a scheduled send with a non-ISO sendAt", () => {
    expect(() =>
      BroadcastScheduleSchema.parse({ kind: "scheduled", sendAt: "tomorrow" })
    ).toThrow();
  });

  it("rejects a scheduled send missing sendAt", () => {
    expect(() =>
      BroadcastScheduleSchema.parse({ kind: "scheduled" })
    ).toThrow();
  });
});

describe("BroadcastSendRequestSchema", () => {
  const valid = {
    audience: "tier_1" as const,
    templateKey: "promo_ticketing",
    schedule: { kind: "now" as const },
    reason: "Launch promo",
  };

  it("parses a valid immediate broadcast request", () => {
    expect(BroadcastSendRequestSchema.parse(valid)).toEqual(valid);
  });

  it("requires a non-empty templateKey", () => {
    expect(() =>
      BroadcastSendRequestSchema.parse({ ...valid, templateKey: "" })
    ).toThrow();
  });

  it("requires a reason of at least 3 chars", () => {
    expect(() =>
      BroadcastSendRequestSchema.parse({ ...valid, reason: "no" })
    ).toThrow();
  });

  it("rejects an unknown audience", () => {
    expect(() =>
      BroadcastSendRequestSchema.parse({ ...valid, audience: "nobody" })
    ).toThrow();
  });
});

describe("BroadcastSendResponseSchema", () => {
  it("parses a dispatched outcome (no change request)", () => {
    const res = {
      outcome: "dispatched" as const,
      recipientCount: 2140,
      changeRequestId: null,
    };
    expect(BroadcastSendResponseSchema.parse(res)).toEqual(res);
  });

  it("parses a queued-for-approval outcome with a change-request id", () => {
    const res = {
      outcome: "queued_for_approval" as const,
      recipientCount: 31204,
      changeRequestId: "11111111-1111-4111-8111-111111111111",
    };
    expect(BroadcastSendResponseSchema.parse(res)).toEqual(res);
  });

  it("rejects a negative recipient count", () => {
    expect(() =>
      BroadcastSendResponseSchema.parse({
        outcome: "dispatched",
        recipientCount: -1,
        changeRequestId: null,
      })
    ).toThrow();
  });
});
