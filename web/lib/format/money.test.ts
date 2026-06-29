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
})

describe("formatCryptoAmount", () => {
  it("appends the asset symbol", () => {
    expect(formatCryptoAmount("29.97", "USDT")).toBe("29.97 USDT")
  })
})
