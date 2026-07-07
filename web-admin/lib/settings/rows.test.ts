import { describe, expect, it } from "vitest"
import type { EffectiveSetting } from "@handshake-agent/contracts"

import {
  coerceValue,
  formatValue,
  seedInput,
  settingDiff,
  sourceTint,
  toRow,
} from "./rows"

function setting(overrides: Partial<EffectiveSetting>): EffectiveSetting {
  return {
    key: "crypto.buy.spreadBps",
    label: "Buy spread (bps)",
    description: "The buy-side spread in basis points",
    category: "Pricing",
    valueType: "number",
    editable: true,
    value: 150,
    scope: "global",
    scopeValue: null,
    source: "db",
    ...overrides,
  }
}

describe("formatValue", () => {
  it("groups numbers, joins arrays, stringifies bool/string, em-dashes nullish", () => {
    expect(formatValue(1250000)).toBe("1,250,000")
    expect(formatValue(true)).toBe("true")
    expect(formatValue(["a", "b"])).toBe("a, b")
    expect(formatValue([])).toBe("(empty)")
    expect(formatValue(null)).toBe("—")
    expect(formatValue("hello")).toBe("hello")
  })
})

describe("toRow", () => {
  it("marks a db override editable with the override chain", () => {
    const row = toRow(setting({ source: "db", value: 150 }))
    expect(row.src).toBe("DB")
    expect(row.editable).toBe(true)
    expect(row.chain[0]).toBe("DB override: 150")
  })
  it("marks a baseline row non-editable (locked) with the baseline chain", () => {
    const row = toRow(
      setting({ source: "default", editable: true, value: 150 })
    )
    expect(row.src).toBe("Baseline")
    expect(row.editable).toBe(false) // editable && isDb → false for a baseline
    expect(row.chain[1]).toBe("Baseline (ENV / JSON): 150")
  })
  it("never editable when the registry entry is not editable", () => {
    expect(toRow(setting({ source: "db", editable: false })).editable).toBe(
      false
    )
  })
})

describe("sourceTint + settingDiff", () => {
  it("tints DB vs baseline", () => {
    expect(sourceTint("DB")).toBe("bg-sif text-tif")
    expect(sourceTint("Baseline")).toBe("bg-card2 text-ink2")
  })
  it("builds the from→to diff", () => {
    const row = toRow(setting({ value: 150 }))
    expect(settingDiff(row, "200")).toEqual([
      { field: "crypto.buy.spreadBps", from: "150", to: "200" },
    ])
  })
})

describe("coerceValue", () => {
  it("coerces per valueType and rejects bad numbers", () => {
    expect(coerceValue("number", "42")).toEqual({ ok: true, value: 42 })
    expect(coerceValue("number", "x")).toEqual({
      ok: false,
      error: "Enter a valid number.",
    })
    expect(coerceValue("boolean", "true")).toEqual({ ok: true, value: true })
    expect(coerceValue("string[]", "a, b ,c")).toEqual({
      ok: true,
      value: ["a", "b", "c"],
    })
    expect(coerceValue("string", " raw ")).toEqual({ ok: true, value: " raw " })
  })
})

describe("seedInput", () => {
  it("seeds arrays as comma lists, nullish as empty, else String()", () => {
    expect(
      seedInput(toRow(setting({ value: ["x", "y"], valueType: "string[]" })))
    ).toBe("x, y")
    expect(seedInput(toRow(setting({ value: null })))).toBe("")
    expect(seedInput(toRow(setting({ value: 150 })))).toBe("150")
  })
})
