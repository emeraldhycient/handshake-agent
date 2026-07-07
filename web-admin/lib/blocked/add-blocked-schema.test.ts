import { describe, expect, it } from "vitest"

import {
  ADD_BLOCKED_DEFAULTS,
  AddBlockedFormSchema,
} from "./add-blocked-schema"

function firstError(input: unknown): string | undefined {
  const result = AddBlockedFormSchema.safeParse(input)
  return result.success ? undefined : result.error.issues[0]?.message
}

describe("AddBlockedFormSchema", () => {
  it("accepts a value and trims it; reason is optional", () => {
    const parsed = AddBlockedFormSchema.parse({ value: "  0xABC  " })
    expect(parsed.value).toBe("0xABC")
  })

  it("requires a non-blank value", () => {
    expect(firstError({ value: "   " })).toBe("Enter an address or identifier")
  })

  it("caps the reason at 280 chars", () => {
    expect(
      AddBlockedFormSchema.safeParse({ value: "x", reason: "a".repeat(281) })
        .success
    ).toBe(false)
  })

  it("exposes an empty default that fails validation until filled", () => {
    expect(ADD_BLOCKED_DEFAULTS).toEqual({ value: "", reason: "" })
    expect(AddBlockedFormSchema.safeParse(ADD_BLOCKED_DEFAULTS).success).toBe(
      false
    )
  })
})
