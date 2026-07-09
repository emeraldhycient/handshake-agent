import { describe, expect, it } from "vitest"
import type { EffectiveSetting } from "@handshake-agent/contracts"

import {
  availableCurrencies,
  buildTiers,
  fieldLabelFor,
  formatLeaf,
  humanizeSeconds,
  leafRow,
  parseCap,
} from "./rows"

function s(key: string, value: unknown): EffectiveSetting {
  return {
    key,
    label: key,
    description: "",
    category: "KYC",
    valueType: "number",
    editable: true,
    value,
    scope: "global",
    scopeValue: null,
    source: "db",
  }
}

describe("humanizeSeconds + formatLeaf + fieldLabelFor", () => {
  it("humanizes durations", () => {
    expect(humanizeSeconds(0)).toBe("None")
    expect(humanizeSeconds(86400)).toBe("1d")
    expect(humanizeSeconds(3600)).toBe("1h")
    expect(humanizeSeconds(120)).toBe("2m")
    expect(humanizeSeconds(45)).toBe("45s")
  })
  it("formats a leaf by kind", () => {
    expect(formatLeaf("amount", 50000, "NGN")).toBe("₦50,000.00")
    expect(formatLeaf("amount", 500, "GHS")).toBe("GH₵500.00")
    expect(formatLeaf("count", 1000, "NGN")).toBe("1,000")
    expect(formatLeaf("seconds", 3600, "NGN")).toBe("1h")
  })
  it("labels the edit field with units", () => {
    expect(fieldLabelFor("amount", "NGN")).toBe("New value (NGN)")
    expect(fieldLabelFor("count", "NGN")).toBe("New value (count)")
    expect(fieldLabelFor("seconds", "NGN")).toBe("New value (seconds)")
  })
})

describe("leafRow", () => {
  it("renders '—' with no editor for an absent key (§3.6)", () => {
    const row = leafRow("Per-tx max", undefined, "amount", "NGN")
    expect(row.v).toBe("—")
    expect(row.edit).toBeUndefined()
  })
  it("renders 'Not set' but stays editable for a present-but-unset key", () => {
    const row = leafRow(
      "Per-tx max",
      s("limits.NGN.tier_1.perTxFiatMax", null),
      "amount",
      "NGN"
    )
    expect(row.v).toBe("Not set")
    expect(row.edit?.key).toBe("limits.NGN.tier_1.perTxFiatMax")
  })
  it("formats a present numeric value", () => {
    const row = leafRow(
      "Per-tx max",
      s("limits.NGN.tier_1.perTxFiatMax", 50000),
      "amount",
      "NGN"
    )
    expect(row.v).toBe("₦50,000.00")
  })
})

describe("buildTiers + availableCurrencies", () => {
  const settings = [
    s("limits.NGN.tier_1.perTxFiatMax", 50000),
    s("limits.GHS.tier_1.perTxFiatMax", 500),
    s("beneficiary.cryptoCoolingOffSeconds", 86400),
  ]
  it("builds 3 tiers with amount + velocity rows", () => {
    const tiers = buildTiers(settings, "NGN")
    expect(tiers.map((t) => t.id)).toEqual(["tier_1", "tier_2", "tier_3"])
    expect(tiers[0].amountCaps[0].v).toBe("₦50,000.00")
    // The global new-beneficiary hold appears on every tier card.
    expect(tiers[0].velocity.at(-1)?.v).toBe("1d")
  })
  it("lists currencies with NGN first", () => {
    expect(availableCurrencies(settings)).toEqual(["NGN", "GHS"])
  })
})

describe("parseCap", () => {
  it("accepts non-negative integers, rejects the rest", () => {
    expect(parseCap("100")).toBe(100)
    expect(parseCap("0")).toBe(0)
    expect(parseCap("")).toBe(null)
    expect(parseCap("-1")).toBe(null)
    expect(parseCap("1.5")).toBe(null)
    expect(parseCap("x")).toBe(null)
  })
})
