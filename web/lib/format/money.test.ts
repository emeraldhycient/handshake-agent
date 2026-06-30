import { describe, expect, it } from "vitest"
import { formatFiatAmount, formatCryptoAmount } from "./money"

describe("formatFiatAmount", () => {
  it("groups thousands and drops kobo by default", () => {
    expect(formatFiatAmount("72340.00", "₦")).toBe("₦72,340")
  })
  it("prefixes ≈ when approx", () => {
    expect(formatFiatAmount("72340", "₦", { approx: true })).toBe("≈ ₦72,340")
  })
  it("formats sub-thousand amounts without separators", () => {
    expect(formatFiatAmount("950.49", "₦")).toBe("₦950")
  })

  // Finding #6: a non-zero sub-unit amount must NOT collapse to "₦0" (which
  // reads as "no money"). Show the real value at 2dp instead of rounding it away.
  it("renders a sub-1 amount at 2dp instead of ₦0", () => {
    expect(formatFiatAmount("0.50", "₦")).toBe("₦0.50")
  })

  it("renders a tiny positive amount at 2dp, never ₦0", () => {
    expect(formatFiatAmount("0.01", "₦")).toBe("₦0.01")
  })

  it("keeps the approx prefix for sub-1 amounts", () => {
    expect(formatFiatAmount("0.50", "₦", { approx: true })).toBe("≈ ₦0.50")
  })

  it("renders a genuine zero as ₦0 (not 2dp)", () => {
    expect(formatFiatAmount("0", "₦")).toBe("₦0")
  })

  it("shows 2dp for any value below 1", () => {
    expect(formatFiatAmount("0.99", "₦")).toBe("₦0.99")
  })

  it("rounds amounts >= 1 to whole units as before", () => {
    expect(formatFiatAmount("1.4", "₦")).toBe("₦1")
    expect(formatFiatAmount("1.6", "₦")).toBe("₦2")
  })
})

describe("formatCryptoAmount", () => {
  it("appends the asset symbol", () => {
    expect(formatCryptoAmount("29.97", "USDT")).toBe("29.97 USDT")
  })
})
