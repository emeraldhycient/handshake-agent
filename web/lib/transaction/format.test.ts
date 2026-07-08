import { describe, expect, it } from "vitest"
import { toneFor, labelFor, titleCase, shortHash, shortAddress } from "./format"

describe("transaction format helpers", () => {
  it("toneFor maps status to pill tone", () => {
    expect(toneFor("completed")).toBe("success")
    expect(toneFor("failed")).toBe("danger")
    expect(toneFor("rolled_back")).toBe("danger")
    expect(toneFor("pending")).toBe("warn")
  })

  it("labelFor uses the map and falls back to Title-case", () => {
    expect(labelFor("buy")).toBe("Buy")
    expect(labelFor("ticket_purchase")).toBe("Ticket")
    expect(labelFor("mystery")).toBe("Mystery")
  })

  it("titleCase replaces underscores", () => {
    expect(titleCase("rolled_back")).toBe("Rolled back")
  })

  it("shortHash / shortAddress truncate long values only", () => {
    expect(shortHash("0x1234567890abcdef1234")).toBe("0x123456…cdef1234")
    expect(shortHash("short")).toBe("short")
    expect(shortAddress("TRabcdefghijklmn1234567")).toBe("TRabcd…234567")
    expect(shortAddress("TRshort")).toBe("TRshort")
  })
})
