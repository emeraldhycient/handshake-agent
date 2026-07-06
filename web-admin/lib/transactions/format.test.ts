import { describe, expect, it } from "vitest"
import { displayName, amountLines, buildQuery } from "./format"
import type { AdminTxnListItem } from "@handshake-agent/contracts"

describe("displayName", () => {
  it("titles the email local-part", () => {
    expect(displayName("amara.okeke@x.com", "u123456789")).toBe("Amara Okeke")
  })
  it("falls back to a short userId when no email", () => {
    expect(displayName(null, "u123456789")).toBe("u1234567")
  })
})

describe("amountLines", () => {
  it("formats crypto + fiat legs, em-dash when missing", () => {
    const t = {
      amount: "10.5",
      asset: "USDT",
      fiatAmount: "16500",
      fiatCurrency: "NGN",
    } as AdminTxnListItem
    const { crypto, fiat } = amountLines(t)
    expect(crypto).toContain("USDT")
    expect(fiat).toContain("₦")
    expect(amountLines({} as AdminTxnListItem).crypto).toBe("—")
  })
})

describe("buildQuery", () => {
  it("maps the view to a status + adds q + cursor", () => {
    const q = buildQuery("stuck", "  abc ", "cur1")
    expect(q.status).toBe("settling")
    expect(q.q).toBe("abc")
    expect(q.cursor).toBe("cur1")
    expect(q.limit).toBe(10)
  })
  it("adds a from bound only for the failed view", () => {
    expect(buildQuery("failed", "", undefined).from).toBeDefined()
    expect(buildQuery("all", "", undefined).from).toBeUndefined()
  })
})
