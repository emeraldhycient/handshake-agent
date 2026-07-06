import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useOptionalRouter } from "./use-optional-router"

describe("useOptionalRouter", () => {
  it("returns null when rendered outside an app-router provider", () => {
    // No Next router context in the test env — useRouter throws, we swallow it.
    const { result } = renderHook(() => useOptionalRouter())
    expect(result.current).toBeNull()
  })
})
