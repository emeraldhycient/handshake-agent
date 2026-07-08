import { describe, expect, it } from "vitest"

import { actionChip, displayValue, formatTime } from "./format"

describe("actionChip", () => {
  it("maps action keywords onto the design token pairs", () => {
    expect(actionChip("account_freeze")).toBe("bg-sdn text-tdn")
    expect(actionChip("pii_access")).toBe("bg-sdn text-tdn")
    expect(actionChip("config_update")).toBe("bg-swn text-twn")
    expect(actionChip("ledger_settle")).toBe("bg-sok text-tok")
    expect(actionChip("something_else")).toBe("bg-sif text-tif")
  })
})

describe("displayValue", () => {
  it("renders nullish as em-dash, primitives directly, objects as JSON", () => {
    expect(displayValue(null)).toBe("—")
    expect(displayValue(undefined)).toBe("—")
    expect(displayValue("x")).toBe("x")
    expect(displayValue(42)).toBe("42")
    expect(displayValue(true)).toBe("true")
    expect(displayValue({ a: 1 })).toBe('{"a":1}')
  })
})

describe("formatTime", () => {
  it("renders 'Mon D · HH:MM:SS', falling back to the raw string", () => {
    expect(formatTime("2026-07-01T09:42:07.000Z")).toMatch(
      /^[A-Z][a-z]{2} \d+ · \d{2}:\d{2}:\d{2}$/
    )
    expect(formatTime("not-a-date")).toBe("not-a-date")
  })
})
