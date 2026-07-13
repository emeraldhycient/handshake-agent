/**
 * Tests for the useSetPin hook (POST /kyc/pin) — pre-KYC transaction-PIN
 * setup for a verified-but-PIN-less session. Invalidates the cached `me`
 * query so a subsequent useMe() reflects hasPin: true immediately.
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

import { useSetPin } from "./kyc"

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe("useSetPin", () => {
  beforeEach(() => post.mockReset())

  it("posts the pin to /kyc/pin and invalidates 'me'", async () => {
    post.mockResolvedValue({ data: { hasPin: true } })
    const { client, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(client, "invalidateQueries")
    const { result } = renderHook(() => useSetPin(), { wrapper })

    const res = await result.current.mutateAsync("1357")

    expect(post).toHaveBeenCalledWith("/kyc/pin", { pin: "1357" })
    expect(res).toEqual({ hasPin: true })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: qk.me })
  })
})
