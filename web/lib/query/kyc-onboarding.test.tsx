/**
 * Tests for the onboarding KYC hooks (useSetName / useSumsubToken).
 *
 * useSetName posts the display name and invalidates the cached `me` query so
 * a subsequent useMe() reflects the freshly set name. useSumsubToken is a
 * plain mutation — the token is one-shot and consumed by the Sumsub WebSDK,
 * never cached.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { qk } from "./keys"

const post = vi.fn()
vi.mock("@/lib/api/client", () => ({
  api: {
    post: (...a: unknown[]) => post(...a),
    get: vi.fn(),
  },
}))

import { useSetName, useSumsubToken } from "./kyc-onboarding"

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe("useSetName", () => {
  beforeEach(() => post.mockReset())

  it("posts firstName+lastName to /profile/name and invalidates 'me'", async () => {
    post.mockResolvedValue({ data: { firstName: "Ada", lastName: "Tester" } })
    const { client, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(client, "invalidateQueries")
    const { result } = renderHook(() => useSetName(), { wrapper })

    const res = await result.current.mutateAsync({
      firstName: "Ada",
      lastName: "Tester",
    })

    expect(post).toHaveBeenCalledWith("/profile/name", {
      firstName: "Ada",
      lastName: "Tester",
    })
    expect(res).toEqual({ firstName: "Ada", lastName: "Tester" })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: qk.me })
  })
})

describe("useSumsubToken", () => {
  beforeEach(() => post.mockReset())

  it("posts the level to /kyc/sumsub/token and returns the parsed token", async () => {
    post.mockResolvedValue({
      data: {
        token: "sumsub-sdk-token",
        userId: "00000000-0000-0000-0000-000000000001",
      },
    })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSumsubToken(), { wrapper })

    const res = await result.current.mutateAsync("tier_2")

    expect(post).toHaveBeenCalledWith("/kyc/sumsub/token", { level: "tier_2" })
    expect(res.token).toBe("sumsub-sdk-token")
  })
})
