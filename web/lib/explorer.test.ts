import { describe, expect, it } from "vitest"
import { explorerTxUrl } from "./explorer"

describe("explorerTxUrl", () => {
  it("builds a tronscan URL for the TRON network", () => {
    expect(explorerTxUrl("tron", "abc123")).toBe(
      "https://tronscan.org/#/transaction/abc123"
    )
  })

  it("is case-insensitive on the network key", () => {
    expect(explorerTxUrl("TRON", "abc123")).toBe(
      "https://tronscan.org/#/transaction/abc123"
    )
  })

  it("URL-encodes the hash", () => {
    expect(explorerTxUrl("tron", "a/b?c")).toBe(
      "https://tronscan.org/#/transaction/a%2Fb%3Fc"
    )
  })

  it("returns null for an unknown network (no link rendered)", () => {
    expect(explorerTxUrl("ethereum", "abc123")).toBeNull()
    expect(explorerTxUrl("", "abc123")).toBeNull()
  })

  it("returns null when the hash is empty", () => {
    expect(explorerTxUrl("tron", "")).toBeNull()
  })
})
