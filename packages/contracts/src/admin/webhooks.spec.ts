import { describe, expect, it } from "vitest";

import {
  WebhookDetailSchema,
  WebhookListItemSchema,
  WebhookListQuerySchema,
  WebhookListResponseSchema,
  WebhookMetricsSchema,
  WebhookRetryRequestSchema,
} from "./webhooks.dto";

describe("webhook admin DTOs", () => {
  const item = {
    id: "wh-1",
    provider: "blockradar",
    providerEventId: "evt_1",
    status: "succeeded",
    attempts: 1,
    lastError: null,
    receivedAt: "2026-07-04T06:00:00.000Z",
    processedAt: "2026-07-04T06:00:01.000Z",
  };

  it("parses a valid list item", () => {
    expect(WebhookListItemSchema.parse(item)).toEqual(item);
  });

  it("rejects an unknown provider", () => {
    expect(() =>
      WebhookListItemSchema.parse({ ...item, provider: "paystack" }),
    ).toThrow();
  });

  it("rejects an unknown status", () => {
    expect(() =>
      WebhookListItemSchema.parse({ ...item, status: "queued" }),
    ).toThrow();
  });

  it("parses a list response with a null cursor", () => {
    const res = WebhookListResponseSchema.parse({
      items: [item],
      nextCursor: null,
    });
    expect(res.items).toHaveLength(1);
    expect(res.nextCursor).toBeNull();
  });

  it("coerces + defaults the list-query limit and accepts filters", () => {
    const q = WebhookListQuerySchema.parse({
      provider: "flutterwave",
      status: "dead",
    });
    expect(q.limit).toBe(25);
    expect(q.provider).toBe("flutterwave");
    const coerced = WebhookListQuerySchema.parse({ limit: "10" });
    expect(coerced.limit).toBe(10);
  });

  it("rejects a list-query limit above 100", () => {
    expect(() => WebhookListQuerySchema.parse({ limit: 500 })).toThrow();
  });

  it("parses a detail with payload/headers/signature", () => {
    const detail = WebhookDetailSchema.parse({
      ...item,
      payload: { event: "deposit.success" },
      headers: { "x-blockradar-signature": "abc" },
      signature: "abc",
      lastAttemptAt: null,
      deadAt: null,
    });
    expect(detail.headers["x-blockradar-signature"]).toBe("abc");
  });

  it("requires a non-empty retry reason", () => {
    expect(WebhookRetryRequestSchema.parse({ reason: "redeliver" }).reason).toBe(
      "redeliver",
    );
    expect(() => WebhookRetryRequestSchema.parse({ reason: "" })).toThrow();
  });

  it("parses a metrics snapshot", () => {
    const m = WebhookMetricsSchema.parse({
      byStatus: { received: 2, processing: 0, succeeded: 5, failed: 1, dead: 1 },
      depth: 2,
      failed: 1,
      dead: 1,
    });
    expect(m.depth).toBe(2);
  });
});
