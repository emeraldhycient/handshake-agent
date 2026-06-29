import { describe, it, expect } from "vitest";
import { NotificationListResponseSchema } from "./notification.dto";

describe("NotificationListResponseSchema", () => {
  it("parses notifications with templateVars", () => {
    const ok = {
      items: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          eventType: "transaction_completed",
          eventRef: "tx1",
          createdAt: "2026-06-29T12:00:00.000Z",
          templateVars: { asset: "USDT", amount: "29.97" },
        },
      ],
    };
    expect(NotificationListResponseSchema.parse(ok)).toEqual(ok);
  });
});
