import { describe, expect, it } from "vitest"
import { mapNotifications } from "./notifications"
import type { NotificationListResponse } from "@handshake-agent/contracts"

const now = new Date("2026-06-29T12:05:00.000Z")

describe("mapNotifications", () => {
  it("maps eventType to a title, body, and relative time", () => {
    const res: NotificationListResponse = {
      items: [
        {
          id: "n1",
          eventType: "transaction_completed",
          eventRef: "tx1",
          createdAt: "2026-06-29T12:00:00.000Z",
          templateVars: { asset: "USDT", amount: "29.97" },
        },
      ],
    }
    const out = mapNotifications(res, now)
    expect(out[0]).toMatchObject({ title: "Purchase complete", time: "5m" })
    expect(out[0].sub).toBe("29.97 USDT")
  })

  it("falls back to a generic title for unknown event types", () => {
    const res: NotificationListResponse = {
      items: [
        {
          id: "n2",
          eventType: "something_new",
          eventRef: "ref2",
          createdAt: "2026-06-29T12:00:00.000Z",
          templateVars: {},
        },
      ],
    }
    const out = mapNotifications(res, now)
    expect(out[0].title).toBe("Notification")
    expect(out[0].sub).toBe("ref2")
  })
})
