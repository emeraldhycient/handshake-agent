import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useDepositAddress, useInvalidateDepositAddress } from "./hooks"
import { qk } from "./keys"

// Fresh client per test so the cache never leaks between cases.
function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe("useDepositAddress (finding #10)", () => {
  it("loads the deposit address", async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useDepositAddress(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.kind).toBe("receive")
  })

  it("does not pin the query to staleTime: Infinity (a re-provisioned address must be able to refresh)", async () => {
    const { client, wrapper } = makeWrapper()
    const { result } = renderHook(() => useDepositAddress(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // The query options expose staleTime, but it isn't on the narrow public type
    // — read it through a local cast at this test boundary.
    const options = client.getQueryCache().find({ queryKey: qk.deposit })
      ?.options as { staleTime?: number } | undefined
    expect(options?.staleTime).toBeDefined()
    expect(Number.isFinite(options?.staleTime)).toBe(true)
  })

  it("exposes an invalidation path so a re-provisioned address can be refetched", async () => {
    const { client, wrapper } = makeWrapper()
    const { result: dep } = renderHook(() => useDepositAddress(), { wrapper })
    await waitFor(() => expect(dep.current.isSuccess).toBe(true))

    const spy = vi.spyOn(client, "invalidateQueries")
    const { result: invalidate } = renderHook(
      () => useInvalidateDepositAddress(),
      { wrapper }
    )
    invalidate.current()
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.deposit })
  })
})
